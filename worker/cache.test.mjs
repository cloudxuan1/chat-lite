// Worker 纯函数测试：跑 `node worker/cache.test.mjs`。
import assert from "node:assert/strict";
import {
  applyPromptCache,
  buildUpstreamBody,
  normalizeModel,
} from "./worker.js";
import worker from "./worker.js";

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function cacheControlAt(message) {
  if (!Array.isArray(message.content)) return undefined;
  return message.content.at(-1)?.cache_control;
}

test("Claude：断点打在首条 system、当前问题前一条和当前问题", () => {
  const messages = [
    { role: "system", content: "系统提示词" },
    { role: "user", content: "旧问题" },
    { role: "assistant", content: "旧回答" },
    { role: "assistant", content: "当前问题前一条" },
    { role: "user", content: "当前问题" },
  ];
  const result = applyPromptCache(messages, "anthropic/claude-opus-4.6");

  assert.deepStrictEqual(cacheControlAt(result[0]), { type: "ephemeral" });
  assert.strictEqual(typeof result[1].content, "string");
  assert.strictEqual(typeof result[2].content, "string");
  assert.deepStrictEqual(cacheControlAt(result[3]), { type: "ephemeral" });
  assert.deepStrictEqual(cacheControlAt(result[4]), { type: "ephemeral" });
});

test("没有 system：只标记 messages[-2] 和 messages[-1]", () => {
  const messages = [
    { role: "user", content: "m0" },
    { role: "assistant", content: "m1" },
    { role: "assistant", content: "m2" },
    { role: "user", content: "m3" },
  ];
  const result = applyPromptCache(messages, "anthropic/claude-sonnet-4.6");

  assert.strictEqual(typeof result[0].content, "string");
  assert.strictEqual(typeof result[1].content, "string");
  assert.deepStrictEqual(cacheControlAt(result[2]), { type: "ephemeral" });
  assert.deepStrictEqual(cacheControlAt(result[3]), { type: "ephemeral" });
});

test("短数组：重叠的语义位置去重，不会重复包装", () => {
  const oneMessage = [{ role: "system", content: "唯一一条" }];
  const oneResult = applyPromptCache(oneMessage, "anthropic/claude-opus-4.6");
  assert.strictEqual(oneResult[0].content.length, 1);
  assert.strictEqual(oneResult[0].content[0].text, "唯一一条");

  const twoMessages = [
    { role: "system", content: "系统" },
    { role: "user", content: "问题" },
  ];
  const twoResult = applyPromptCache(twoMessages, "anthropic/claude-opus-4.6");
  assert.strictEqual(twoResult[0].content.length, 1);
  assert.strictEqual(twoResult[1].content.length, 1);
});

test("数组 content：标记最后一个块，重复调用保持幂等", () => {
  const messages = [
    {
      role: "system",
      content: [
        { type: "text", text: "规则一" },
        { type: "text", text: "规则二" },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "上一条" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "当前问题" }],
    },
  ];

  const first = applyPromptCache(messages, "anthropic/claude-opus-4.6");
  const second = applyPromptCache(first, "anthropic/claude-opus-4.6");

  assert.deepStrictEqual(second, first);
  assert.strictEqual(first[0].content[0].cache_control, undefined);
  assert.deepStrictEqual(first[0].content[1].cache_control, { type: "ephemeral" });
  assert.deepStrictEqual(first[1].content[0].cache_control, { type: "ephemeral" });
  assert.deepStrictEqual(first[2].content[0].cache_control, { type: "ephemeral" });
});

test("非 Claude 模型：消息数组和对象均原样返回", () => {
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: "hello" },
  ];
  const result = applyPromptCache(messages, "openai/gpt-5.5");

  assert.strictEqual(result, messages);
  assert.strictEqual(result[0], messages[0]);
  assert.strictEqual(typeof result[0].content, "string");
});

test("applyPromptCache 不修改原数组、消息对象或 content 块", () => {
  const messages = [
    {
      role: "system",
      content: [{ type: "text", text: "system" }],
    },
    { role: "assistant", content: "answer" },
    { role: "user", content: "question" },
  ];
  const snapshot = structuredClone(messages);

  applyPromptCache(messages, "anthropic/claude-opus-4.6");

  assert.deepStrictEqual(messages, snapshot);
  assert.strictEqual(messages[0].content[0].cache_control, undefined);
  assert.strictEqual(typeof messages[1].content, "string");
});

test("buildUpstreamBody：新推理档位是单一真相，并转发 session_id", () => {
  const body = buildUpstreamBody({
    messages: [{ role: "user", content: "hello" }],
    model: "openai/gpt-5.5",
    reasoningEffort: "high",
    reasoning: false,
    session_id: "session-123",
    webSearch: true,
  });

  assert.deepStrictEqual(body.reasoning, { effort: "high" });
  assert.strictEqual(body.include_reasoning, undefined);
  assert.strictEqual(body.session_id, "session-123");
  assert.deepStrictEqual(body.plugins, [{ id: "web", max_results: 5 }]);
});

test("buildUpstreamBody：off 映射为 none，旧布尔字段仅作兼容", () => {
  const offBody = buildUpstreamBody({
    messages: [{ role: "user", content: "hello" }],
    reasoningEffort: "off",
  });
  assert.deepStrictEqual(offBody.reasoning, { effort: "none" });

  const legacyBody = buildUpstreamBody({
    messages: [{ role: "user", content: "hello" }],
    reasoning: true,
  });
  assert.deepStrictEqual(legacyBody.reasoning, { effort: "medium" });
  assert.strictEqual(legacyBody.include_reasoning, undefined);
});

test("normalizeModel：只输出前端需要的模型目录字段", () => {
  const reasoning = {
    supported_efforts: ["low", "medium", "high"],
    default_effort: "medium",
    default_enabled: true,
    mandatory: false,
    supports_max_tokens: true,
  };
  const result = normalizeModel({
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    description: "desc",
    context_length: 200000,
    pricing: { prompt: "0.000005", completion: "0.000025" },
    reasoning,
    supported_parameters: ["reasoning", "tools", 123],
    architecture: { tokenizer: "Claude" },
  });

  assert.deepStrictEqual(result, {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    description: "desc",
    contextLength: 200000,
    pricing: { prompt: "0.000005", completion: "0.000025" },
    reasoning,
    supportedParameters: ["reasoning", "tools"],
  });
  assert.strictEqual(normalizeModel({ name: "missing id" }), null);
});

await testAsync("请求先校验密码：未授权的模型目录请求不会调用 OpenRouter", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error("不应调用");
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({ action: "models", password: "wrong" }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        OPENROUTER_API_KEY: "test-key",
      },
    );
    assert.strictEqual(response.status, 401);
    assert.strictEqual(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("模型目录请求无需 messages，返回精简字段", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.strictEqual(url, "https://openrouter.ai/api/v1/models");
    assert.strictEqual(options.headers.Authorization, "Bearer test-key");
    return new Response(JSON.stringify({
      data: [
        {
          id: "openai/gpt-5.5",
          name: "GPT 5.5",
          description: "desc",
          context_length: 128000,
          pricing: { prompt: "1" },
          reasoning: { supported_efforts: ["low", "high"] },
          supported_parameters: ["reasoning"],
          extra: "不应转发",
        },
      ],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({ action: "models", password: "correct" }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        OPENROUTER_API_KEY: "test-key",
      },
    );
    const result = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(result.models.length, 1);
    assert.strictEqual(result.models[0].id, "openai/gpt-5.5");
    assert.strictEqual(result.models[0].extra, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("OpenRouter 模型目录失败时统一返回 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream error", { status: 503 });

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({ action: "models", password: "correct" }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        OPENROUTER_API_KEY: "test-key",
      },
    );
    assert.strictEqual(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
