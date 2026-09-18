// No dependencies or network: node --test tests/reasoning.test.mjs
// 思考链落盘：存档归一化认 reasoning / variantReasoning，send.js 回复完成后把攒下的思考文字存进消息。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { source as script } from "./source.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const deepEq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `production source extraction must be unique: ${pattern}`);
  return matches[0][0];
}

const functions = [
  "normalizeMemoryContext", "normalizeToolCalls", "normalizeReasoningDetailsList", "normalizeMemorySteps",
  "normalizeVariantSteps", "normalizeVariantReasoning", "normalizeMessageAttachments", "normalizeStoredMessages",
].map((name) => extract(new RegExp(`^(?:async )?function ${name}\\([^]*?^}$`, "gm"))).join("\n");
const constants = ["MEMORY_CONTEXT_MAX_CHARS", "MEMORY_TOOL_NAMES", "MAX_IMAGES_PER_MESSAGE", "SUPPORTED_IMAGE_TYPES"]
  .map((name) => extract(new RegExp(`^const ${name} = [^]*?;$`, "gm"))).join("\n");

function storeHarness() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${constants}\n${functions}`, context);
  return context;
}

test("存档归一化：reasoning 只认非空字符串，老存档不多出键", () => {
  const h = storeHarness();
  const stored = h.normalizeStoredMessages([
    { role: "user", content: "问", reasoning: "用户消息不该有" },
    { role: "assistant", content: "答", reasoning: "先想想" },
    { role: "assistant", content: "答", reasoning: 123 },
    { role: "assistant", content: "答" },
  ]);
  deepEq(stored[0], { role: "user", content: "问" });
  deepEq(stored[1], { role: "assistant", content: "答", reasoning: "先想想" });
  deepEq(stored[2], { role: "assistant", content: "答" });
  deepEq(stored[3], { role: "assistant", content: "答" });
});

test("存档归一化：有 reroll 版本时 reasoning 跟着 activeVariant 走，全空则不存 variantReasoning", () => {
  const h = storeHarness();
  assert.equal(h.normalizeVariantReasoning(["a", null], 1), null);
  deepEq(h.normalizeVariantReasoning([null, "b"], 2), [null, "b"]);
  deepEq(h.normalizeVariantReasoning(["a"], 2), ["a", null], "短了补 null");
  assert.equal(h.normalizeVariantReasoning([null, ""], 2), null);
  assert.equal(h.normalizeVariantReasoning("nope", 2), null);

  const stored = h.normalizeStoredMessages([
    { role: "assistant", content: "旧", variants: ["旧", "新"], activeVariant: 0, variantReasoning: [null, "新想法"], reasoning: "新想法" },
    { role: "assistant", content: "新", variants: ["旧", "新"], activeVariant: 1, variantReasoning: ["旧想法", "新想法"] },
    { role: "assistant", content: "新", variants: ["旧", "新"], activeVariant: 1, variantReasoning: [null, null] },
  ]);
  assert.equal(stored[0].reasoning, undefined, "当前版本没有思考就不带 reasoning，哪怕存档里残留了");
  deepEq(stored[0].variantReasoning, [null, "新想法"]);
  assert.equal(stored[1].reasoning, "新想法");
  assert.equal(stored[2].reasoning, undefined);
  assert.equal(stored[2].variantReasoning, undefined);
});

// ---- send.js：回复完成后落盘 ----
const sendSource = readFileSync(new URL("../js/send.js", import.meta.url), "utf8");

async function runReply({ existing = false, reasoning = "先想想", effort = "high" } = {}) {
  const conversation = { messages: [{ role: "user", content: "测试问题" }] };
  if (existing) conversation.messages.push({ role: "assistant", content: "旧回答", reasoning: "旧想法" });
  const bubble = { classList: { add() {}, remove() {} }, closest: () => null };
  const context = {
    memoryMaxToolRounds: 6, memoryEnabled: false, WORKER_URL: "https://mock.invalid",
    accessPw: "mock", webSearchEnabled: false, webSearchMaxUses: null,
    webSearchMaxResults: null, maxCompletionTokens: null,
    conversationStore: { activeId: "other" },
    addBubble: () => bubble, setBubbleText: (b, text) => { b.textContent = text; },
    addReasoningBlock: () => ({ root: {}, append() {}, finish() {} }),
    findMemoryStepsTrace: () => null, findReasoningTrace: () => null,
    conversationById: () => conversation, messagesForOpenRouter: async (x) => x,
    effectiveSystemPrompt: () => "", expandMemorySteps: (x) => x,
    accumulateUsage: (total, usage) => usage,
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: {} }),
    readStream: async (_, callbacks) => {
      if (reasoning) callbacks.onReasoning(reasoning);
      callbacks.onContent("新回答");
      return { full: "新回答", annotations: [], usage: {}, reasoningDetails: [], toolCalls: [] };
    },
    requestAnimationFrame: (fn) => fn(),
    cloneConversationStore: () => ({}), persistConversationStore() {}, renderConversationList() {},
    setPending() {}, scrollToBottom() {},
  };
  vm.createContext(context);
  vm.runInContext(sendSource, context);
  await context.streamAssistantReply({
    conversationId: "test", sessionId: "test", model: "mock", effort, assistantIndex: 1,
    existingBubble: existing ? bubble : undefined,
  });
  return conversation.messages[1];
}

test("新回复：思考文字随消息落盘；关闭思考或没有思考就不带 reasoning", async () => {
  deepEq(await runReply(), { role: "assistant", content: "新回答", reasoning: "先想想" });
  deepEq(await runReply({ reasoning: "" }), { role: "assistant", content: "新回答" });
  deepEq(await runReply({ effort: "off" }), { role: "assistant", content: "新回答" }, "思考关闭时不存流里冒出来的思考");
});

test("reroll：旧版本的思考保留在 variantReasoning，新版本成为当前 reasoning", async () => {
  const message = await runReply({ existing: true });
  deepEq(message, {
    role: "assistant", content: "新回答", reasoning: "先想想",
    variants: ["旧回答", "新回答"], activeVariant: 1, variantReasoning: ["旧想法", "先想想"],
  });
  const noReasoning = await runReply({ existing: true, reasoning: "" });
  assert.equal(noReasoning.reasoning, undefined);
  deepEq(noReasoning.variantReasoning, ["旧想法", null]);
});
