import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../js/send.js", import.meta.url), "utf8");

async function runLoop({ memory = true, rounds = 6, ignoresStop = false } = {}) {
  const requests = [];
  let executions = 0;
  const conversation = { messages: [{ role: "user", content: "测试问题" }] };
  const bubble = { classList: { add() {}, remove() {} }, closest: () => null };
  const context = {
    MEMORY_MAX_TOOL_ROUNDS: 6, memoryEnabled: memory, WORKER_URL: "https://mock.invalid",
    accessPw: "mock", webSearchEnabled: false, webSearchMaxUses: null,
    webSearchMaxResults: null, maxCompletionTokens: null,
    conversationStore: { activeId: "other" },
    addBubble: () => bubble, setBubbleText: (b, text) => { b.textContent = text; },
    conversationById: () => conversation, messagesForOpenRouter: async (x) => x,
    effectiveSystemPrompt: () => "", expandMemorySteps: (x) => x,
    fetch: async (_, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: {} };
    },
    readStream: async () => {
      const wantsTool = memory && (requests.length <= rounds || ignoresStop);
      return {
        full: wantsTool ? "" : "根据已有记忆给出的最终回答",
        annotations: [], usage: {}, reasoningDetails: [],
        toolCalls: wantsTool ? [{ id: `c${requests.length}`, type: "function", function: { name: "memory_search", arguments: "{}" } }] : [],
      };
    },
    runMemoryTool: async () => { executions++; return '{"ok":true}'; },
    cloneConversationStore: () => ({}), persistConversationStore() {}, renderConversationList() {},
    setPending() {}, scrollToBottom() {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.streamAssistantReply({ conversationId: "test", sessionId: "test", model: "mock", effort: "off", assistantIndex: 1 });
  return { requests, executions, conversation, bubble };
}

test("six tool rounds end with a tools-disabled answer and persist all results", async () => {
  const { requests, executions, conversation } = await runLoop();
  assert.equal(requests.length, 7);
  assert.equal(executions, 6);
  assert.ok(requests.slice(0, 6).every((r) => r.memoryToolsExhausted === undefined));
  assert.equal(requests[6].memoryToolsExhausted, true);
  assert.equal(requests[6].memoryTools, true);
  assert.equal(requests[6].messages.filter((m) => m.role === "tool").length, 6);
  assert.equal(conversation.messages[1].content, "根据已有记忆给出的最终回答");
  assert.equal(conversation.messages[1].steps.length, 12);
});

test("early final answer does not force a closing request", async () => {
  const { requests, executions } = await runLoop({ rounds: 1 });
  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.ok(requests.every((r) => r.memoryToolsExhausted === undefined));
});

test("memory off keeps the ordinary single-request path", async () => {
  const { requests, executions } = await runLoop({ memory: false });
  assert.equal(requests.length, 1);
  assert.equal(executions, 0);
  assert.equal(requests[0].memoryTools, undefined);
});

test("provider ignoring tool_choice cannot loop forever or discard completed searches", async () => {
  const { requests, executions, conversation } = await runLoop({ ignoresStop: true });
  assert.equal(requests.length, 7);
  assert.equal(executions, 6);
  assert.match(conversation.messages[1].content, /查询记录已保留/);
  assert.equal(conversation.messages[1].steps.length, 12);
});
