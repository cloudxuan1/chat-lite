// 切后台续传：真实的 js/reply-resume.js（断了按字节数续、等回到前台、中转站说中断/过期就停）
// 和 send.js 的「续不上就留下半截、标回复中断」。网络、页面可见性是替身，不代表 iPhone 真机验收。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { scripts } from "./source.mjs";

const resumeSource = scripts.find((script) => script.path === "js/reply-resume.js").source;
const encoder = new TextEncoder();

// 像网络一样：先一段段交字，交完再断（或正常结束）
function streamOf(parts, { failAfter = false } = {}) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < parts.length) controller.enqueue(encoder.encode(parts[index++]));
      else if (failAfter) controller.error(new TypeError("Load failed"));
      else controller.close();
    },
  });
}

function setup(resumeHandler) {
  const listeners = new Set();
  const resumes = [];
  const document = {
    visibilityState: "visible",
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  const context = vm.createContext({
    document, crypto, ReadableStream, Response, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval,
    WORKER_URL: "https://worker.invalid", accessPw: "pw",
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "reply-resume") {
        resumes.push(body);
        return resumeHandler(body);
      }
      return new Response(null, { status: 204 });
    },
  });
  vm.runInContext(resumeSource, context);
  const setVisibility = (state) => {
    document.visibilityState = state;
    for (const fn of [...listeners]) fn();
  };
  return { context, resumes, setVisibility, listeners };
}

const first = (parts, options) => new Response(streamOf(parts, options), {
  headers: { "Content-Type": "text/event-stream", "X-Reply-Status": "running" },
});

test("断线后按已收到的字节数续，接上的内容不漏不重", async () => {
  const { context, resumes, listeners } = setup(() => new Response(streamOf(["data: b\n\n", "data: [DONE]\n\n"]), {
    headers: { "X-Reply-Status": "done" },
  }));
  const body = context.resumableReplyBody(first(["data: a\n\n"], { failAfter: true }), "reply-0000000000000001");
  assert.equal(await new Response(body).text(), "data: a\n\ndata: b\n\ndata: [DONE]\n\n");
  assert.deepEqual(resumes, [{ action: "reply-resume", password: "pw", replyId: "reply-0000000000000001", offset: 9 }]);
  assert.equal(listeners.size, 0);   // 收完把可见性监听也收掉了
});

test("切到后台时断的：等回到前台才去续", async () => {
  const { context, resumes, setVisibility } = setup(() => new Response(streamOf(["data: [DONE]\n\n"]), {
    headers: { "X-Reply-Status": "done" },
  }));
  setVisibility("hidden");
  const text = new Response(context.resumableReplyBody(first(["data: a\n\n"], { failAfter: true }), "reply-0000000000000002")).text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resumes.length, 0);
  setVisibility("visible");
  assert.equal(await text, "data: a\n\ndata: [DONE]\n\n");
  assert.equal(resumes.length, 1);
});

test("中转站说上游中途断了 / 回复已过期：不再续，交给上层按中断处理", async () => {
  const failed = setup(() => new Response(streamOf(["data: b\n\n"]), { headers: { "X-Reply-Status": "failed" } }));
  await assert.rejects(
    new Response(failed.context.resumableReplyBody(first(["data: a\n\n"], { failAfter: true }), "reply-0000000000000003")).text(),
    (error) => error.replyFinal === true,
  );
  const expired = setup(() => new Response('{"error":"找不到这条回复，可能已经过期"}', { status: 404 }));
  await assert.rejects(
    new Response(expired.context.resumableReplyBody(first([], { failAfter: true }), "reply-0000000000000004")).text(),
    /已经过期/,
  );
  assert.equal(expired.resumes.length, 1);
});

test("续不上时：这一轮已经出来的字照常存档，结尾标「回复中断」", async () => {
  const conversation = { messages: [{ role: "user", content: "写一段长的" }] };
  const bubble = { classList: { add() {}, remove() {} }, closest: () => null };
  const acks = [];
  const context = vm.createContext({
    memoryEnabled: false, memoryMaxToolRounds: 6, WORKER_URL: "https://mock.invalid", accessPw: "pw",
    webSearchEnabled: false, webSearchMaxUses: null, webSearchMaxResults: null, maxCompletionTokens: null,
    conversationStore: { activeId: "other" },
    addBubble: () => bubble, setBubbleText() {}, requestAnimationFrame: (fn) => fn(),
    conversationById: () => conversation, messagesForOpenRouter: async (x) => x,
    effectiveSystemPrompt: () => "", expandMemorySteps: (x) => x, accumulateUsage: (total, usage) => usage,
    findMemoryStepsTrace: () => null, cloneConversationStore: () => ({}), persistConversationStore() { return true; },
    renderConversationList() {}, setPending() {}, scrollToBottom() {}, followToBottom() {},
    newReplyId: () => "reply-0000000000000005", resumableReplyBody: (res) => res.body, ackReply: (id) => acks.push(id),
    fetchReplyStart: async () => ({ ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: {} }),
    readStream: async (_, callbacks) => {
      callbacks.onContent("从前有座山，");
      throw Object.assign(new Error("回复在服务器那边断了"), { replyFinal: true });
    },
  });
  vm.runInContext(readFileSync(new URL("../js/send.js", import.meta.url), "utf8"), context);
  await context.streamAssistantReply({ conversationId: "c", sessionId: "s", model: "m", effort: "off", assistantIndex: 1 });
  assert.equal(conversation.messages[1].role, "assistant");
  assert.equal(conversation.messages[1].content, "从前有座山，\n\n（回复中断）");
  assert.deepEqual(acks, ["reply-0000000000000005"]);
});
