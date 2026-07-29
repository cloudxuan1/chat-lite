// ember 代理 Worker
// 作用：给前端请求偷偷加上 OpenRouter 的 API key，并把流式回复原样转回前端。
// API key 存在 Cloudflare 的 Secret 里（变量名 OPENROUTER_API_KEY），不写进代码、不暴露给前端。
//
// 提示词缓存（applyPromptCache）：给消息打上 cache_control 标记，命中时这部分内容
// 不用按全价重新计费（读缓存约 0.1x 价格），代价是首次写入贵 1.25x。只有前缀字节完全
// 一致且达到当前模型的缓存门槛才会命中；不满门槛会跳过，不影响正常回复。
// 怎么验证命中：连续发两轮消息后，看浏览器 Network 面板里最后一个 SSE chunk，
// 字段 usage.prompt_tokens_details.cached_tokens > 0 就是命中了。

// 只允许这个来源的网页调用（你的 GitHub Pages 域名）。换域名就改这一行。
const ALLOWED_ORIGIN = "https://cloudxuan1.github.io";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-opus-4.6";
const DEEPSEEK_TITLE_MODEL = "deepseek-v4-flash";
const TITLE_INPUT_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 10;
const TITLE_REQUEST_TIMEOUT_MS = 8000;
const REASONING_EFFORTS = new Set(["off", "low", "medium", "high"]);

export default {
  async fetch(request, env) {
    // 浏览器发真正请求前会先发一个 OPTIONS 预检，这里直接放行。
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "只接受 POST 请求" }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "请求体不是合法 JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "请求体必须是对象" }, 400);
    }

    // 访问密码校验：挡住公开网址被陌生人直接调用、白嫖你的 API key。
    // 密码存在 Cloudflare Secret（ACCESS_PASSWORD）里；没设或不匹配一律拒绝，绝不调用 OpenRouter。
    if (!env.ACCESS_PASSWORD || payload.password !== env.ACCESS_PASSWORD) {
      return json({ error: "访问密码错误" }, 401);
    }

    if (payload.action === "models") {
      return fetchModels(env);
    }
    if (payload.action === "title") {
      return generateTitle(payload, env);
    }

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return json({ error: "messages 必须是非空数组" }, 400);
    }
    if (
      payload.reasoningEffort !== undefined
      && !REASONING_EFFORTS.has(payload.reasoningEffort)
    ) {
      return json({ error: "reasoningEffort 必须是 off、low、medium 或 high" }, 400);
    }
    if (
      payload.session_id !== undefined
      && (
        typeof payload.session_id !== "string"
        || payload.session_id.trim().length === 0
        || payload.session_id.length > 256
      )
    ) {
      return json({ error: "session_id 必须是 1 到 256 个字符" }, 400);
    }
    if (
      payload.maxCompletionTokens !== undefined
      && (
        !Number.isSafeInteger(payload.maxCompletionTokens)
        || payload.maxCompletionTokens < 1
      )
    ) {
      return json({ error: "maxCompletionTokens 必须是大于 0 的整数" }, 400);
    }

    let upstream;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": ALLOWED_ORIGIN,
          "X-Title": "ember",
        },
        body: JSON.stringify(buildUpstreamBody(payload)),
      });
    } catch (err) {
      return json({ error: "连接 OpenRouter 失败：" + err.message }, 502);
    }

    // 把上游响应原样透传：成功时是 SSE 流，失败时是 JSON 错误体。再补上 CORS。
    const headers = corsHeaders();
    const ct = upstream.headers.get("Content-Type");
    if (ct) headers["Content-Type"] = ct;
    headers["Cache-Control"] = "no-cache";

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

async function generateTitle(payload, env) {
  if (!env.DEEPSEEK_API_KEY) {
    return json({ error: "标题服务尚未配置" }, 503);
  }
  if (typeof payload.text !== "string" || payload.text.trim().length === 0) {
    return json({ error: "text 必须是非空字符串" }, 400);
  }

  const text = Array.from(payload.text.trim())
    .slice(0, TITLE_INPUT_MAX_CHARS)
    .join("");

  let upstream;
  try {
    const requestOptions = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_TITLE_MODEL,
        messages: [
          {
            role: "system",
            content: [
              "你是会话标题生成器。",
              "根据用户第一条消息生成准确的中文短标题。",
              "标题必须是 2 到 10 个可见字符。",
              "只输出标题，不要引号、标点、空格或 Emoji。",
            ].join(""),
          },
          { role: "user", content: text },
        ],
        thinking: { type: "disabled" },
        stream: false,
        max_tokens: 32,
      }),
    };
    if (typeof globalThis.AbortSignal?.timeout === "function") {
      requestOptions.signal = globalThis.AbortSignal.timeout(TITLE_REQUEST_TIMEOUT_MS);
    }
    upstream = await fetch(DEEPSEEK_URL, requestOptions);
  } catch {
    return json({ error: "连接 DeepSeek 标题服务失败" }, 502);
  }

  if (!upstream.ok) {
    return json({ error: "DeepSeek 标题服务请求失败" }, 502);
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return json({ error: "DeepSeek 标题服务返回格式异常" }, 502);
  }

  const title = normalizeTitle(result?.choices?.[0]?.message?.content);
  if (Array.from(title).length < 2) {
    return json({ error: "DeepSeek 标题服务未返回有效标题" }, 502);
  }
  return json({ title });
}

async function fetchModels(env) {
  let upstream;
  try {
    upstream = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": ALLOWED_ORIGIN,
        "X-Title": "ember",
      },
    });
    if (!upstream.ok) {
      return json({ error: "拉取模型列表失败" }, 502);
    }

    const result = await upstream.json();
    if (!Array.isArray(result.data)) {
      return json({ error: "模型列表格式异常" }, 502);
    }
    return json({ models: result.data.map(normalizeModel).filter(Boolean) });
  } catch {
    return json({ error: "连接 OpenRouter 模型列表失败" }, 502);
  }
}

export function normalizeTitle(value) {
  if (typeof value !== "string") return "";
  const visibleCharacters = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return Array.from(visibleCharacters).slice(0, TITLE_MAX_CHARS).join("");
}

export function normalizeModel(model) {
  if (!model || typeof model.id !== "string" || !model.id) {
    return null;
  }
  const providerMax = model.top_provider?.max_completion_tokens;
  return {
    id: model.id,
    name: typeof model.name === "string" && model.name ? model.name : model.id,
    description: typeof model.description === "string" ? model.description : "",
    contextLength: Number.isFinite(model.context_length) ? model.context_length : null,
    maxCompletionTokens: Number.isFinite(providerMax) && providerMax > 0
      ? Math.floor(providerMax)
      : null,
    pricing: model.pricing && typeof model.pricing === "object" ? model.pricing : null,
    reasoning: model.reasoning && typeof model.reasoning === "object"
      ? model.reasoning
      : null,
    supportedParameters: Array.isArray(model.supported_parameters)
      ? model.supported_parameters.filter((parameter) => typeof parameter === "string")
      : [],
  };
}

export function buildUpstreamBody(payload) {
  const body = {
    model: payload.model || DEFAULT_MODEL,
    messages: applyPromptCache(payload.messages, payload.model),
    stream: true,
    usage: { include: true },
  };

  const reasoningEffort = normalizeReasoningEffort(payload);
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }
  if (payload.webSearch) {
    body.plugins = [{ id: "web", max_results: 5 }];
  }
  if (payload.session_id !== undefined) {
    body.session_id = payload.session_id;
  }
  if (payload.maxCompletionTokens !== undefined) {
    body.max_completion_tokens = payload.maxCompletionTokens;
  }

  return body;
}

function normalizeReasoningEffort(payload) {
  if (payload.reasoningEffort !== undefined) {
    return payload.reasoningEffort === "off" ? "none" : payload.reasoningEffort;
  }
  if (typeof payload.reasoning === "boolean") {
    return payload.reasoning ? "medium" : "none";
  }
  return undefined;
}

// 给消息数组打提示词缓存断点，返回新数组，不改入参 messages。
// 规则：只处理 anthropic/claude 开头的模型（其它供应商可能不认 cache_control，原样放行避免多扣费）；
// 最多打三个语义断点：首条 system、当前问题前一条、当前问题。
// content 为字符串时转成文本块；已经是块数组时给最后一个块打标。重复调用不会二次包装。
export function applyPromptCache(messages, model) {
  const effectiveModel = model || DEFAULT_MODEL;
  if (typeof effectiveModel !== "string" || !effectiveModel.startsWith("anthropic/claude")) {
    return messages;
  }

  const cacheIndexes = new Set();
  const lastIndex = messages.length - 1;
  if (messages[0]?.role === "system") cacheIndexes.add(0);
  if (lastIndex >= 1) cacheIndexes.add(lastIndex - 1);
  if (lastIndex >= 0) cacheIndexes.add(lastIndex);

  return messages.map((msg, i) => {
    if (!cacheIndexes.has(i)) {
      return msg;
    }
    const content = addCacheControl(msg.content);
    if (content === msg.content) return msg;
    return {
      ...msg,
      content,
    };
  });
}

function addCacheControl(content) {
  if (typeof content === "string") {
    return [
      {
        type: "text",
        text: content,
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  if (!Array.isArray(content) || content.length === 0) {
    return content;
  }

  let targetIndex = -1;
  for (let i = content.length - 1; i >= 0; i -= 1) {
    if (content[i] && typeof content[i] === "object" && !Array.isArray(content[i])) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return content;

  const target = content[targetIndex];
  if (target.cache_control?.type === "ephemeral") {
    return content;
  }
  return content.map((block, i) => (
    i === targetIndex
      ? { ...block, cache_control: { type: "ephemeral" } }
      : block
  ));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status = 200) {
  const headers = corsHeaders();
  headers["Content-Type"] = "application/json";
  return new Response(JSON.stringify(obj), { status, headers });
}
