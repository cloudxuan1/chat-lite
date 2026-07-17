// 测试 applyPromptCache：跑 `node worker/cache.test.mjs`，全过时无输出异常、进程退出码 0。
import assert from "node:assert/strict";
import { applyPromptCache } from "./worker.js";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("非 Claude 模型：原样返回，不打任何断点", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "how are you" },
  ];
  const result = applyPromptCache(messages, "openai/gpt-4o");
  assert.deepStrictEqual(result, messages);
  // 确认没有被打上 cache_control（不是只是 deepEqual 巧合）
  for (const msg of result) {
    assert.strictEqual(typeof msg.content, "string");
  }
});

test("未传 model（走 DEFAULT_MODEL 是 anthropic/claude-opus-4.6）：按 Claude 规则处理", () => {
  const messages = [{ role: "user", content: "hello" }];
  const result = applyPromptCache(messages, undefined);
  assert.ok(Array.isArray(result[0].content));
  assert.strictEqual(result[0].content[0].text, "hello");
  assert.deepStrictEqual(result[0].content[0].cache_control, { type: "ephemeral" });
});

test("1 条消息：只打最后一条（也是唯一一条）的断点", () => {
  const messages = [{ role: "user", content: "只有一条" }];
  const result = applyPromptCache(messages, "anthropic/claude-opus-4.6");
  assert.strictEqual(result.length, 1);
  assert.ok(Array.isArray(result[0].content));
  assert.strictEqual(result[0].content[0].text, "只有一条");
  assert.deepStrictEqual(result[0].content[0].cache_control, { type: "ephemeral" });
});

test("2 条消息：不足 3 条，只打最后一条", () => {
  const messages = [
    { role: "user", content: "第一条" },
    { role: "assistant", content: "第二条" },
  ];
  const result = applyPromptCache(messages, "anthropic/claude-opus-4.6");
  assert.strictEqual(typeof result[0].content, "string", "第 0 条应保持字符串");
  assert.ok(Array.isArray(result[1].content), "最后一条应打断点");
});

test("5 条消息：打最后一条（index 4）和倒数第三条（index 2），其余保持字符串", () => {
  const messages = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "user", content: "m2" },
    { role: "assistant", content: "m3" },
    { role: "user", content: "m4" },
  ];
  const result = applyPromptCache(messages, "anthropic/claude-opus-4.6");

  assert.strictEqual(typeof result[0].content, "string");
  assert.strictEqual(typeof result[1].content, "string");
  assert.ok(Array.isArray(result[2].content), "倒数第三条（index 2）应打断点");
  assert.strictEqual(typeof result[3].content, "string");
  assert.ok(Array.isArray(result[4].content), "最后一条（index 4）应打断点");

  assert.strictEqual(result[2].content[0].text, "m2");
  assert.strictEqual(result[4].content[0].text, "m4");
  assert.deepStrictEqual(result[2].content[0].cache_control, { type: "ephemeral" });
  assert.deepStrictEqual(result[4].content[0].cache_control, { type: "ephemeral" });
});

test("入参 messages 不被修改（深比较原数组和原对象）", () => {
  const original = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "user", content: "m2" },
    { role: "assistant", content: "m3" },
    { role: "user", content: "m4" },
  ];
  const snapshot = JSON.parse(JSON.stringify(original));

  applyPromptCache(original, "anthropic/claude-opus-4.6");

  assert.deepStrictEqual(original, snapshot, "原数组内容不应被改动");
  for (const msg of original) {
    assert.strictEqual(typeof msg.content, "string", "原消息 content 应仍是字符串");
  }
});

test("非字符串 content（已经是数组）原样跳过，不二次包装", () => {
  const weirdContent = [{ type: "text", text: "已经是块了" }];
  const messages = [
    { role: "user", content: "m0" },
    { role: "assistant", content: weirdContent },
  ];
  const result = applyPromptCache(messages, "anthropic/claude-opus-4.6");
  // 最后一条 content 本来就不是字符串，应原样跳过（不加 cache_control）
  assert.strictEqual(result[1].content, weirdContent);
  assert.strictEqual(result[1].content.length, 1);
  assert.strictEqual(result[1].content[0].text, "已经是块了");
});

test("model 前缀不是 anthropic/claude 的（比如 anthropic 家族但拼写不对）不处理", () => {
  const messages = [{ role: "user", content: "hello" }];
  const result = applyPromptCache(messages, "anthropic/claude-instant-not-real");
  // 这个例子其实是以 anthropic/claude 开头的，应该处理——用来确认前缀匹配逻辑本身没写反
  assert.ok(Array.isArray(result[0].content));

  const result2 = applyPromptCache(messages, "anthropic/other-model");
  assert.strictEqual(typeof result2[0].content, "string", "非 claude 系列应原样跳过");
});
