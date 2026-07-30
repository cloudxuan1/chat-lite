// Worker 纯函数测试：跑 `node worker/cache.test.mjs`。
import assert from "node:assert/strict";
import {
  applyPromptCache,
  buildUpstreamBody,
  normalizeModel,
  normalizeTitle,
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

test("buildUpstreamBody：显式开启并返回推理，同时使用新联网搜索工具", () => {
  const body = buildUpstreamBody({
    messages: [{ role: "user", content: "hello" }],
    model: "anthropic/claude-opus-5",
    reasoningEffort: "high",
    reasoning: false,
    session_id: "session-123",
    webSearch: true,
    maxCompletionTokens: 16384,
  });

  assert.deepStrictEqual(body.reasoning, {
    enabled: true,
    effort: "high",
    exclude: false,
  });
  assert.strictEqual(body.include_reasoning, undefined);
  assert.strictEqual(body.session_id, "session-123");
  assert.strictEqual(body.max_completion_tokens, 16384);
  assert.strictEqual(body.plugins, undefined);
  assert.deepStrictEqual(body.tools, [{
    type: "openrouter:web_search",
    parameters: {
      max_results: 5,
      max_uses: 1,
    },
  }]);
});

test("buildUpstreamBody：关闭推理用 none，旧布尔开启使用显式开关", () => {
  const offBody = buildUpstreamBody({
    messages: [{ role: "user", content: "hello" }],
    reasoningEffort: "off",
  });
  assert.deepStrictEqual(offBody.reasoning, { effort: "none" });
  assert.strictEqual(offBody.tools, undefined);

  const legacyBody = buildUpstreamBody({
    messages: [{ role: "user", content: "hello" }],
    reasoning: true,
  });
  assert.deepStrictEqual(legacyBody.reasoning, {
    enabled: true,
    effort: "medium",
    exclude: false,
  });
  assert.strictEqual(legacyBody.include_reasoning, undefined);
  assert.strictEqual(legacyBody.max_completion_tokens, undefined);
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
    top_provider: { max_completion_tokens: 128000 },
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
    maxCompletionTokens: 128000,
    pricing: { prompt: "0.000005", completion: "0.000025" },
    reasoning,
    supportedParameters: ["reasoning", "tools"],
  });
  assert.strictEqual(normalizeModel({ name: "missing id" }), null);
});

test("normalizeTitle：保留必要标点和空格，去掉包裹引号与 Emoji", () => {
  assert.strictEqual(
    normalizeTitle("“多会话 功能规划✨！！额外内容”"),
    "多会话 功能规划！！额外内容",
  );
  assert.strictEqual(
    normalizeTitle("  GPT-5 settings, session 1 😼 "),
    "GPT-5 settings, session 1",
  );
  assert.strictEqual(normalizeTitle("A".repeat(60)), "A".repeat(48));
  assert.strictEqual(normalizeTitle(null), "");
});

await testAsync("标题请求沿用密码鉴权，未授权时不会调用 DeepSeek", async () => {
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
        body: JSON.stringify({
          action: "title",
          password: "wrong",
          text: "帮我规划多个会话",
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        DEEPSEEK_API_KEY: "deepseek-test-key",
      },
    );

    assert.strictEqual(response.status, 401);
    assert.strictEqual(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("标题服务缺少 Secret 时明确报错且不会调用上游", async () => {
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
        body: JSON.stringify({
          action: "title",
          password: "correct",
          text: "帮我规划多个会话",
        }),
      }),
      { ACCESS_PASSWORD: "correct" },
    );
    const result = await response.json();

    assert.strictEqual(response.status, 503);
    assert.strictEqual(result.error, "标题服务尚未配置");
    assert.strictEqual(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("标题请求拒绝空文本，并在调用上游前截断长输入", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async (url, options) => {
    upstreamCalled = true;
    const body = JSON.parse(options.body);
    assert.strictEqual(Array.from(body.messages[1].content).length, 500);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "长文本标题" } }],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    for (const invalid of [undefined, null, "", "   ", 123]) {
      const response = await worker.fetch(
        new Request("https://worker.example", {
          method: "POST",
          body: JSON.stringify({
            action: "title",
            password: "correct",
            text: invalid,
          }),
        }),
        {
          ACCESS_PASSWORD: "correct",
          DEEPSEEK_API_KEY: "deepseek-test-key",
        },
      );
      assert.strictEqual(response.status, 400);
    }
    assert.strictEqual(upstreamCalled, false);

    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({
          action: "title",
          password: "correct",
          text: "甲".repeat(600),
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        DEEPSEEK_API_KEY: "deepseek-test-key",
      },
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(upstreamCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("标题请求关闭 thinking、限制输出，并规范化 DeepSeek 结果", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.AbortSignal?.timeout;
  if (globalThis.AbortSignal) {
    globalThis.AbortSignal.timeout = (milliseconds) => {
      assert.strictEqual(milliseconds, 8000);
      return new AbortController().signal;
    };
  }
  globalThis.fetch = async (url, options) => {
    assert.strictEqual(url, "https://api.deepseek.com/chat/completions");
    assert.strictEqual(options.method, "POST");
    assert.strictEqual(
      options.headers.Authorization,
      "Bearer deepseek-test-key",
    );

    const body = JSON.parse(options.body);
    assert.strictEqual(body.model, "deepseek-v4-flash");
    assert.deepStrictEqual(body.thinking, { type: "disabled" });
    assert.strictEqual(body.stream, false);
    assert.strictEqual(body.max_tokens, 32);
    assert.strictEqual(body.messages[1].content, "帮我规划多个会话");
    if (typeof globalThis.AbortSignal?.timeout === "function") {
      assert.ok(options.signal instanceof globalThis.AbortSignal);
      assert.strictEqual(options.signal.aborted, false);
    }

    return new Response(JSON.stringify({
      choices: [{
        message: { content: "“多会话 功能规划✨！！额外内容”" },
      }],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({
          action: "title",
          password: "correct",
          text: "帮我规划多个会话",
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        DEEPSEEK_API_KEY: "deepseek-test-key",
      },
    );
    const result = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(result.title, "多会话 功能规划！！额外内容");
    assert.ok(Array.from(result.title).length <= 48);
    assert.strictEqual(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://cloudxuan1.github.io",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (globalThis.AbortSignal) {
      globalThis.AbortSignal.timeout = originalTimeout;
    }
  }
});

await testAsync("环境不支持 AbortSignal.timeout 时标题请求仍可用", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.AbortSignal?.timeout;
  if (globalThis.AbortSignal) {
    globalThis.AbortSignal.timeout = undefined;
  }
  globalThis.fetch = async (url, options) => {
    assert.strictEqual(options.signal, undefined);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "会话标题" } }],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({
          action: "title",
          password: "correct",
          text: "帮我规划多个会话",
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        DEEPSEEK_API_KEY: "deepseek-test-key",
      },
    );

    assert.strictEqual(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (globalThis.AbortSignal) {
      globalThis.AbortSignal.timeout = originalTimeout;
    }
  }
});

await testAsync("DeepSeek 上游失败统一返回不泄露详情的 502", async () => {
  const originalFetch = globalThis.fetch;
  const leakedDetail = "upstream-secret-detail";
  globalThis.fetch = async () => new Response(leakedDetail, { status: 429 });

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({
          action: "title",
          password: "correct",
          text: "帮我规划多个会话",
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        DEEPSEEK_API_KEY: "deepseek-test-key",
      },
    );
    const result = await response.json();

    assert.strictEqual(response.status, 502);
    assert.strictEqual(result.error, "DeepSeek 标题服务请求失败");
    assert.strictEqual(JSON.stringify(result).includes(leakedDetail), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("DeepSeek 返回无效标题时统一返回 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: "✨！！" } }],
  }), {
    headers: { "Content-Type": "application/json" },
  });

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({
          action: "title",
          password: "correct",
          text: "帮我规划多个会话",
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        DEEPSEEK_API_KEY: "deepseek-test-key",
      },
    );

    assert.strictEqual(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("聊天请求把显式推理和新联网搜索工具发给 OpenRouter", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.strictEqual(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.strictEqual(options.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.deepStrictEqual(body.reasoning, {
      enabled: true,
      effort: "high",
      exclude: false,
    });
    assert.deepStrictEqual(body.tools, [{
      type: "openrouter:web_search",
      parameters: {
        max_results: 5,
        max_uses: 1,
      },
    }]);
    assert.strictEqual(body.plugins, undefined);
    return new Response("data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "请联网搜索" }],
          model: "anthropic/claude-opus-5",
          password: "correct",
          reasoningEffort: "high",
          webSearch: true,
        }),
      }),
      {
        ACCESS_PASSWORD: "correct",
        OPENROUTER_API_KEY: "test-key",
      },
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("Content-Type"), "text/event-stream");
    assert.strictEqual(await response.text(), "data: [DONE]\n\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("请求拒绝非法最大生成量且不会调用 OpenRouter", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error("不应调用");
  };

  try {
    for (const invalid of [0, -1, 1.5, "1024"]) {
      const response = await worker.fetch(
        new Request("https://worker.example", {
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
            password: "correct",
            maxCompletionTokens: invalid,
          }),
        }),
        {
          ACCESS_PASSWORD: "correct",
          OPENROUTER_API_KEY: "test-key",
        },
      );
      assert.strictEqual(response.status, 400);
    }
    assert.strictEqual(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
          top_provider: { max_completion_tokens: 32768 },
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
    assert.strictEqual(result.models[0].maxCompletionTokens, 32768);
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
