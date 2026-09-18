// No dependencies or network: node --test tests/memory.test.mjs
// 记忆库接入（js/memory.js + prompts/images/stream 里的接线）：从生产源码提取真实函数在 VM 里跑。
// DOM 和网络都是替身，不等于浏览器验收；工具循环本身（send.js）靠分支预览页真请求验收。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { source as script } from "./source.mjs";

// VM 里造出来的对象和测试进程的 Object/Array 原型不同，比较前先 JSON 展平
const plain = (value) => JSON.parse(JSON.stringify(value));
const deepEq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `production source extraction must be unique: ${pattern}`);
  return matches[0][0];
}

const functions = [
  "formatMemoryBriefing", "normalizeMemoryContext", "memoryBriefingEntries", "normalizeToolCalls",
  "normalizeReasoningDetailsList", "normalizeMemorySteps", "normalizeVariantSteps", "normalizeVariantReasoning", "mergeToolCallDeltas",
  "finalizeToolCalls", "mergeReasoningDetails", "finalizeReasoningDetails", "parseToolArguments",
  "withMemoryContext", "expandMemorySteps", "memoryStepEntries", "memoryStepsSummary", "accumulateUsage",
  "normalizeMessageAttachments", "normalizeStoredMessages", "messageForOpenRouter", "baseMessageForOpenRouter",
  "messagesForOpenRouter", "textFromResponseValue", "textFromReasoningDelta", "appendAnnotations", "readStream",
].map((name) => extract(new RegExp(`^(?:async )?function ${name}\\([^]*?^}$`, "gm"))).join("\n");
const constants = ["MEMORY_CONTEXT_MAX_CHARS", "MEMORY_TOOL_NAMES", "MAX_IMAGES_PER_MESSAGE", "SUPPORTED_IMAGE_TYPES"]
  .map((name) => extract(new RegExp(`^const ${name} = [^]*?;$`, "gm"))).join("\n");

function harness() {
  const context = {
    console,
    TextDecoder,
    getImageRecords: async () => { throw new Error("测试消息不带图片，不应读图"); },
    blobToDataUrl: async () => "",
  };
  vm.createContext(context);
  vm.runInContext(`${constants}\n${functions}`, context);
  return context;
}

const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

test("开场小抄：格式固定、带使用说明、超长截断；空列表不产出", () => {
  const h = harness();
  assert.equal(h.formatMemoryBriefing([]), "");
  assert.equal(h.formatMemoryBriefing([{ id: 1, content: "   " }]), "");
  const text = h.formatMemoryBriefing([
    { id: 7, date: "2026-09-01", reason: "最近的事", content: "在准备欧洲行" },
    { id: 8, content: "没有日期也行" },
  ]);
  assert.match(text, /^〔记忆库开场小抄，仅供背景参考〕\n/);
  assert.match(text, /不覆盖系统提示词/);
  assert.match(text, /\n- \[#7 · 2026-09-01 · 最近的事\] 在准备欧洲行\n- \[#8\] 没有日期也行$/);
  deepEq(h.memoryBriefingEntries(text), ["[#7 · 2026-09-01 · 最近的事] 在准备欧洲行", "[#8] 没有日期也行"]);
  // 内容里的换行/多余空白压成一行，界面拆回条目时条数才对
  const multiline = h.formatMemoryBriefing([{ id: 1, content: "欧洲行计划：\n- 巴黎 3 天\n- 罗马 2 天" }]);
  deepEq(h.memoryBriefingEntries(multiline), ["[#1] 欧洲行计划： - 巴黎 3 天 - 罗马 2 天"]);
  const long = h.formatMemoryBriefing([{ id: 1, content: "字".repeat(10000) }]);
  assert.equal(Array.from(long).length, 6000);  // = MEMORY_CONTEXT_MAX_CHARS（VM 里的 const 拿不到）
  assert.equal(h.normalizeMemoryContext(`  ${long}  `), long);
  assert.equal(h.normalizeMemoryContext(42), "");
});

test("流式增量：tool_calls 参数按 index 分片拼接，reasoning_details 文本拼接、签名后到覆盖", () => {
  const h = harness();
  const acc = [];
  h.mergeToolCallDeltas(acc, [{ index: 0, id: "c1", type: "function", function: { name: "memory_search", arguments: "" } }]);
  h.mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: "{\"que" } }, { index: 1, id: "c2", function: { name: "memory_recall", arguments: "{\"id\":" } }]);
  h.mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: "ry\":\"欧洲\"}" } }, { index: 1, function: { arguments: "3}" } }]);
  h.mergeToolCallDeltas(acc, [{ index: 5, function: { arguments: "孤儿分片没有 id" } }]);
  deepEq(h.finalizeToolCalls(acc), [
    call("c1", "memory_search", { query: "欧洲" }),
    call("c2", "memory_recall", { id: 3 }),
  ]);
  deepEq(h.parseToolArguments(h.finalizeToolCalls(acc)[0]), { query: "欧洲" });
  deepEq(h.parseToolArguments({ function: { arguments: "{坏 json" } }), {});

  const reasoning = [];
  h.mergeReasoningDetails(reasoning, [{ type: "reasoning.text", text: "先想", id: "r1" }]);                      // 第一片没 index
  h.mergeReasoningDetails(reasoning, [{ type: "reasoning.text", index: 0, text: "一想", signature: "sig" }]);   // 后到的补 index/签名
  h.mergeReasoningDetails(reasoning, [{ type: "reasoning.encrypted", index: 1, data: "abc" }, { type: "reasoning.encrypted", index: 1, data: "def" }]);
  h.mergeReasoningDetails(reasoning, [{ type: "reasoning.encrypted", index: 2, data: "xyz" }]);                 // 不同 index 的密文块各自独立
  h.mergeReasoningDetails(reasoning, [{ type: "reasoning.text", text: "再" }, { type: "reasoning.text", text: "想" }]); // 新的一段文字
  deepEq(h.finalizeReasoningDetails(reasoning), [
    { type: "reasoning.text", index: 0, text: "先想一想", id: "r1", signature: "sig" },
    { type: "reasoning.encrypted", index: 1, data: "abcdef" },
    { type: "reasoning.encrypted", index: 2, data: "xyz" },
    { type: "reasoning.text", text: "再想" },
  ]);
});

test("readStream：一次流里同时收正文、tool_calls、reasoning_details 和 finish_reason", async () => {
  const h = harness();
  const chunks = [
    `data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","index":0,"text":"要查"}]}}]}\n\n`,
    `data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","index":0,"text":"记忆","signature":"s"}],"content":"我看看"}}]}\n\n`,
    `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"memory_search","arguments":"{\\"query\\":"}}]}}]}\n\n`,
    `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"猫\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n`,
    `data: {"choices":[],"usage":{"prompt_tokens":10}}\n\ndata: [DONE]\n`,
  ];
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  const seen = { reasoning: "", content: "" };
  const result = await h.readStream(body, {
    onReasoning(delta) { seen.reasoning += delta; },
    onContent(delta) { seen.content += delta; },
  });
  assert.equal(seen.reasoning, "要查记忆");
  assert.equal(seen.content, "我看看");
  assert.equal(result.full, "我看看");
  assert.equal(result.finishReason, "tool_calls");
  deepEq(result.usage, { prompt_tokens: 10 });
  deepEq(result.toolCalls, [call("c1", "memory_search", { query: "猫" })]);
  deepEq(result.reasoningDetails, [{ type: "reasoning.text", index: 0, text: "要查记忆", signature: "s" }]);
});

test("步骤归一化：只认两个工具、必须成对、悬空调用整段丢弃；reroll 版本各带各的步骤", () => {
  const h = harness();
  const good = [
    { role: "assistant", content: "", tool_calls: [call("c1", "memory_search", { query: "x" })], reasoning_details: [{ type: "reasoning.text", text: "t" }] },
    { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" },
  ];
  deepEq(h.normalizeMemorySteps(good), good);
  deepEq(h.normalizeMemorySteps([
    { role: "assistant", content: "", tool_calls: [call("c1", "memory_delete", {})] },
    { role: "tool", tool_call_id: "c1", content: "x" },
  ]), []);
  deepEq(h.normalizeMemorySteps([good[0]]), [], "没有结果的调用不能回放");
  deepEq(h.normalizeMemorySteps([
    { role: "assistant", content: "", tool_calls: [call("c1", "memory_search", { query: "x" })] },
    { role: "assistant", content: "", tool_calls: [call("c2", "memory_search", { query: "y" })] },
    { role: "tool", tool_call_id: "c2", content: "{}" },
  ]), [], "中间悬空的调用也让整段作废");
  deepEq(h.normalizeMemorySteps([good[1], ...good]), good, "先到的孤儿结果被丢掉");
  deepEq(h.normalizeMemorySteps("nope"), []);

  assert.equal(h.normalizeVariantSteps([good, null], 1), null);
  deepEq(h.normalizeVariantSteps([null, good], 2), [null, good]);
  assert.equal(h.normalizeVariantSteps([null, [good[0]]], 2), null);

  const stored = h.normalizeStoredMessages([
    { role: "user", content: "问", memoryContext: "〔记忆库开场小抄，仅供背景参考〕\n- [#1] 事" },
    { role: "assistant", content: "旧", variants: ["旧", "新"], activeVariant: 1, variantSteps: [good, null], steps: good },
    { role: "assistant", content: "答", steps: good },
    { role: "assistant", content: "答", steps: [good[0]] },
  ]);
  assert.equal(stored[0].memoryContext, "〔记忆库开场小抄，仅供背景参考〕\n- [#1] 事");
  assert.equal(stored[1].content, "新");
  assert.equal(stored[1].steps, undefined, "当前版本没有步骤就不带 steps");
  deepEq(stored[1].variantSteps, [good, null]);
  deepEq(stored[2].steps, good);
  assert.equal(stored[3].steps, undefined);
});

test("请求组装：小抄作为第二个文本块跟在原话后，步骤展开在最终回复之前，其它消息原样", async () => {
  const h = harness();
  const steps = [
    { role: "assistant", content: "先查", tool_calls: [call("c1", "memory_search", { query: "x" })], reasoning_details: [{ type: "reasoning.text", text: "t" }] },
    { role: "tool", tool_call_id: "c1", content: "{\"ok\":true,\"result\":{\"count\":0,\"results\":[]}}" },
  ];
  const messages = await h.messagesForOpenRouter([
    { role: "user", content: "你好", memoryContext: "小抄" },
    { role: "assistant", content: "答", steps },
    { role: "user", content: "再问" },
  ]);
  deepEq(messages, [
    { role: "user", content: [{ type: "text", text: "你好" }, { type: "text", text: "小抄" }] },
    { role: "assistant", content: "先查", tool_calls: steps[0].tool_calls, reasoning_details: steps[0].reasoning_details },
    { role: "tool", tool_call_id: "c1", content: steps[1].content },
    { role: "assistant", content: "答" },
    { role: "user", content: "再问" },
  ]);
  // 带图片的消息：小抄插在原话之后、图片之前
  const withImages = h.withMemoryContext(
    { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "data:x" } }] },
    { role: "user", memoryContext: "小抄" },
  );
  deepEq(withImages.content.map((block) => block.type), ["text", "text", "image_url"]);
  deepEq(h.expandMemorySteps(undefined), []);
});

test("账单累加：多轮工具请求的 prompt/cached/写入 token 求和，其它字段取最后一轮", () => {
  const h = harness();
  let total = null;
  total = h.accumulateUsage(total, { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 50 } });
  total = h.accumulateUsage(total, { prompt_tokens: 1100, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 1000 }, cost: 0.01 });
  total = h.accumulateUsage(total, null);
  deepEq(total, {
    prompt_tokens: 2100, completion_tokens: 220, total_tokens: 0, cost: 0.01,
    prompt_tokens_details: { cached_tokens: 1900, cache_write_tokens: 50 },
  });
});

test("界面摘要：每次调用一行，命中条数 / 取全文 / 失败原因 / 查询中", () => {
  const h = harness();
  const steps = [
    { role: "assistant", content: "", tool_calls: [call("c1", "memory_search", { query: "欧洲行", space: "all" }), call("c2", "memory_recall", { id: 9 }), call("c3", "memory_search", { query: "猫" })] },
    { role: "tool", tool_call_id: "c1", content: JSON.stringify({ ok: true, result: { count: 2, results: [{ id: 1, content: "A" }, { id: 2, content: "B" }] } }) },
    { role: "tool", tool_call_id: "c2", content: JSON.stringify({ ok: false, error: "记忆 9 不存在" }) },
  ];
  assert.equal(h.memoryStepsSummary(steps), "查了记忆 · 3 次");
  const entries = h.memoryStepEntries(steps);
  deepEq(entries.map((entry) => entry.label), [
    "搜索「欧洲行」 · all · 命中 2 条",
    "取全文 #9 · 失败：记忆 9 不存在",
    "搜索「猫」 · 查询中…",
  ]);
  deepEq(entries[0].details, ["#1 A", "#2 B"]);
});
