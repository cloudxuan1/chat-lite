// ember 代理 Worker
// 作用：给前端请求偷偷加上 OpenRouter 的 API key，并把流式回复原样转回前端。
// API key 存在 Cloudflare 的 Secret 里（变量名 OPENROUTER_API_KEY），不写进代码、不暴露给前端。
//
// 提示词缓存（applyPromptCache）：给消息打上 cache_control 标记，命中时这部分内容
// 不用按全价重新计费（读缓存约 0.1x 价格），代价是首次写入贵 1.25x。只有前缀字节完全
// 一致且达到当前模型的缓存门槛才会命中；不满门槛会跳过，不影响正常回复。
// 怎么验证命中：连续发两轮消息后，看浏览器 Network 面板里最后一个 SSE chunk，
// 字段 usage.prompt_tokens_details.cached_tokens > 0 就是命中了。

// 正式来源（你的 GitHub Pages 域名）。换域名就改这一行；它也是没带/不认识 Origin 时的默认回复值。
const ALLOWED_ORIGIN = "https://cloudxuan1.github.io";
// 预览来源：Cloudflare Pages 项目 chat-lite 的正式域名 chat-lite.pages.dev，
// 以及每个分支 / PR 自动生成的预览域名 <hash>.chat-lite.pages.dev。密码门禁照旧，只是多放行这些域名。
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)?chat-lite\.pages\.dev$/;

export function isAllowedOrigin(origin) {
  return origin === ALLOWED_ORIGIN || PREVIEW_ORIGIN_PATTERN.test(String(origin || ""));
}

// 请求的 Origin 在白名单里就把 CORS 头改成它（并加 Vary: Origin）；否则原样返回，浏览器会拦。
function applyCorsOrigin(response, request) {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin) || origin === ALLOWED_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-opus-4.6";
const DEEPSEEK_TITLE_MODEL = "deepseek-v4-flash";
const TITLE_INPUT_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 48;
const TITLE_REQUEST_TIMEOUT_MS = 8000;
const REASONING_EFFORTS = new Set(["off", "low", "medium", "high"]);
const WEB_SEARCH_MAX_USES = 30;
const WEB_SEARCH_MAX_RESULTS = 25;
const MAX_IMAGES_PER_MESSAGE = 8;
const MAX_IMAGE_BYTES_PER_MESSAGE = 6 * 1024 * 1024;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;

// ember 记忆库（只读）：Secrets EMBER_URL（根地址，如 https://ember.example.com）+ EMBER_TOKEN（= ember 的 EMBER_READ_TOKEN）。
// 超时 2 秒、任何失败都软处理：开场小抄拿不到就不带，工具调用失败就把错误说明当结果还给模型，聊天照常。
const EMBER_TIMEOUT_MS = 2000;
const MEMORY_QUERY_MAX_CHARS = 500;
const MEMORY_SPACE_MAX_CHARS = 40;
const MEMORY_LIMIT_MAX = 8;
// 挂给模型的两个 function tool（OpenAI 格式，OpenRouter 通吃）。说明文字就是模型的使用说明书，改行为要同步改。
export const MEMORY_TOOLS = [
  {
    type: "function",
    function: {
      name: "memory_search",
      description: [
        "搜索用户的长期记忆库（语义 + 关键词），返回目录条目（短内容 + id），不含全文。",
        "用户提到过去的事、人物、约定、偏好、近况时先调用；用自然的词直接搜即可。",
        "不传 space 只搜个人层（关系与个人）；聊项目/技术话题显式传对应空间名；要跨全库传 \"all\"。",
        "需要某条的完整内容和来源时再用 memory_recall(id)。",
      ].join(""),
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "要搜的内容，自然语言即可" },
          space: { type: "string", description: "记忆空间；不传 = personal，\"all\" = 全库" },
          limit: { type: "integer", minimum: 1, maximum: MEMORY_LIMIT_MAX, description: "最多返回几条，默认 8" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_recall",
      description: "按 id 取一条记忆的完整内容、来源片段和关系边（边自带对方记忆的一行摘要）。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", minimum: 1, description: "memory_search 返回的记忆 id" },
        },
        required: ["id"],
      },
    },
  },
];

export default {
  async fetch(request, env) {
    return applyCorsOrigin(await handleRequest(request, env), request);
  },
};

async function handleRequest(request, env) {
  {
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
    if (payload.action === "memory-briefing") {
      return memoryBriefing(payload, env);
    }
    if (payload.action === "memory-tool") {
      return memoryTool(payload, env);
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
    if (!optionalIntegerInRange(payload.webSearchMaxUses, 1, WEB_SEARCH_MAX_USES)) {
      return json({ error: `webSearchMaxUses 必须是 1 到 ${WEB_SEARCH_MAX_USES} 的整数` }, 400);
    }
    if (!optionalIntegerInRange(payload.webSearchMaxResults, 1, WEB_SEARCH_MAX_RESULTS)) {
      return json({ error: `webSearchMaxResults 必须是 1 到 ${WEB_SEARCH_MAX_RESULTS} 的整数` }, 400);
    }
    if (payload.memoryTools !== undefined && typeof payload.memoryTools !== "boolean") {
      return json({ error: "memoryTools 必须是布尔值" }, 400);
    }
    if (payload.memoryToolsExhausted !== undefined && typeof payload.memoryToolsExhausted !== "boolean") {
      return json({ error: "memoryToolsExhausted 必须是布尔值" }, 400);
    }
    const imageValidationError = validateImageMessages(payload.messages);
    if (imageValidationError) {
      return json({ error: imageValidationError }, 400);
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
  }
}

// ---- ember 记忆库 ----

function emberConfigured(env) {
  return typeof env.EMBER_URL === "string" && env.EMBER_URL.trim() !== ""
    && typeof env.EMBER_TOKEN === "string" && env.EMBER_TOKEN !== "";
}

// 调 ember 的只读接口；返回 { status, data } 或抛错（超时/断网）。
async function emberPost(env, path, body) {
  const base = env.EMBER_URL.trim().replace(/\/+$/, "");
  const requestOptions = {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.EMBER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
  if (typeof globalThis.AbortSignal?.timeout === "function") {
    requestOptions.signal = globalThis.AbortSignal.timeout(EMBER_TIMEOUT_MS);
  }
  const upstream = await fetch(`${base}/internal/memory/${path}`, requestOptions);
  let data = null;
  try {
    data = await upstream.json();
  } catch {
    data = null;
  }
  return { status: upstream.status, data };
}

// 只把模型需要的字段带回来，控制体积（目录条目本来就短）。
function compactMemoryItem(item) {
  if (!item || typeof item !== "object") return null;
  const out = {};
  for (const key of ["id", "date", "content", "topic", "tags", "tier", "space", "reason", "interval_status", "superseded_by", "start_date", "end_date"]) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") out[key] = item[key];
  }
  return typeof out.id === "number" && typeof out.content === "string" ? out : null;
}

// 开场小抄：新会话第一句话时前端调一次，拿不到就不带（前端按任何非 200 处理成空）。
export async function memoryBriefing(payload, env) {
  if (!emberConfigured(env)) {
    return json({ error: "记忆库未配置" }, 503);
  }
  if (payload.topic !== undefined && typeof payload.topic !== "string") {
    return json({ error: "topic 必须是字符串" }, 400);
  }
  const topic = typeof payload.topic === "string"
    ? Array.from(payload.topic.trim()).slice(0, MEMORY_QUERY_MAX_CHARS).join("")
    : "";
  let upstream;
  try {
    upstream = await emberPost(env, "briefing", topic ? { topic } : {});
  } catch {
    return json({ error: "记忆库连接失败或超时" }, 502);
  }
  if (upstream.status !== 200 || !Array.isArray(upstream.data?.items)) {
    return json({ error: `记忆库返回 ${upstream.status}` }, 502);
  }
  return json({ items: upstream.data.items.map(compactMemoryItem).filter(Boolean) });
}

// 模型调用的工具由前端转到这里代执行。参数错误、未配置、超时都回 200 + ok:false，
// 错误说明会当作工具结果还给模型，让它知道这次没查到、可以换法子或直接回答。
export async function memoryTool(payload, env) {
  const name = payload.name;
  const args = payload.arguments && typeof payload.arguments === "object" && !Array.isArray(payload.arguments)
    ? payload.arguments
    : {};
  if (name !== "memory_search" && name !== "memory_recall") {
    return json({ ok: false, error: `没有叫 ${String(name)} 的工具` });
  }
  if (!emberConfigured(env)) {
    return json({ ok: false, error: "记忆库未配置，这次查不了，请直接回答" });
  }

  let path;
  let body;
  if (name === "memory_search") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return json({ ok: false, error: "参数错误：query 不能为空" });
    body = { query: Array.from(query).slice(0, MEMORY_QUERY_MAX_CHARS).join("") };
    if (args.space !== undefined && args.space !== null && args.space !== "") {
      if (typeof args.space !== "string" || Array.from(args.space).length > MEMORY_SPACE_MAX_CHARS) {
        return json({ ok: false, error: "参数错误：space 必须是不超过 40 字的字符串" });
      }
      body.space = args.space;
    }
    if (args.limit !== undefined && args.limit !== null) {
      if (!Number.isSafeInteger(args.limit) || args.limit < 1) {
        return json({ ok: false, error: `参数错误：limit 必须是 1 到 ${MEMORY_LIMIT_MAX} 的整数` });
      }
      body.limit = Math.min(args.limit, MEMORY_LIMIT_MAX);
    }
    path = "search";
  } else {
    const id = typeof args.id === "string" && /^\d+$/.test(args.id) ? Number(args.id) : args.id;
    if (!Number.isSafeInteger(id) || id < 1) {
      return json({ ok: false, error: "参数错误：id 必须是正整数" });
    }
    body = { id };
    path = "recall";
  }

  let upstream;
  try {
    upstream = await emberPost(env, path, body);
  } catch {
    return json({ ok: false, error: "记忆库连接失败或超时（2 秒），这次查不了" });
  }
  if (upstream.status === 404) {
    return json({ ok: false, error: `记忆 ${body.id} 不存在` });
  }
  if (upstream.status === 401 || upstream.status === 503) {
    return json({ ok: false, error: "记忆库拒绝了这次查询（钥匙或配置问题），请直接回答" });
  }
  if (upstream.status !== 200 || !upstream.data || typeof upstream.data !== "object") {
    return json({ ok: false, error: `记忆库返回 ${upstream.status}，这次查不了` });
  }
  if (name === "memory_search") {
    const results = Array.isArray(upstream.data.results)
      ? upstream.data.results.map(compactMemoryItem).filter(Boolean)
      : [];
    return json({ ok: true, result: { count: results.length, results } });
  }
  return json({ ok: true, result: upstream.data });
}

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
              "根据用户第一条消息生成准确、自然的会话标题。",
              "中文通常 8 到 18 个汉字，英文可以更长；不要为了凑短删掉关键信息。",
              "允许必要的空格、逗号、句号和连字符。",
              "只输出一行标题，不要用引号包裹，不要 Emoji。",
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
  if ((title.match(/[\p{L}\p{N}]/gu) || []).length < 2) {
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
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D]/gu, "")
    .replace(/^[\s"'“”‘’「」『』《》【】]+|[\s"'“”‘’「」『』《》【】]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = Array.from(visibleCharacters)
    .slice(0, TITLE_MAX_CHARS)
    .join("")
    .trim();
  return /[\p{L}\p{N}]/u.test(title) ? title : "";
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
    inputModalities: Array.isArray(model.architecture?.input_modalities)
      ? model.architecture.input_modalities.filter((modality) => typeof modality === "string")
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
  if (reasoningEffort === "none") {
    body.reasoning = { effort: "none" };
  } else if (reasoningEffort) {
    body.reasoning = {
      enabled: true,
      effort: reasoningEffort,
      exclude: false,
    };
  }
  if (payload.webSearch) {
    const parameters = {};
    if (payload.webSearchMaxUses !== undefined) {
      parameters.max_uses = payload.webSearchMaxUses;
    }
    if (payload.webSearchMaxResults !== undefined) {
      parameters.max_results = payload.webSearchMaxResults;
    }
    const tool = { type: "openrouter:web_search" };
    if (Object.keys(parameters).length) tool.parameters = parameters;
    body.tools = [tool];
  }
  if (payload.memoryTools) {
    body.tools = [...(body.tools || []), ...MEMORY_TOOLS];
    // 保留工具定义和历史；本轮只根据已有结果回答，不再调用工具。
    if (payload.memoryToolsExhausted) body.tool_choice = "none";
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

function optionalIntegerInRange(value, min, max) {
  return value === undefined || (
    Number.isSafeInteger(value)
    && value >= min
    && value <= max
  );
}

function base64DataUrlBytes(url) {
  const payload = url.slice(url.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor(payload.length * 3 / 4) - padding;
}

function validateImageMessages(messages) {
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    let imageCount = 0;
    let imageBytes = 0;
    for (const block of message.content) {
      if (block?.type !== "image_url") continue;
      const url = block.image_url?.url;
      if (typeof url !== "string" || !IMAGE_DATA_URL_PATTERN.test(url)) {
        return "图片格式只支持 PNG、JPEG、WebP 或 GIF";
      }
      imageCount += 1;
      imageBytes += base64DataUrlBytes(url);
      if (imageCount > MAX_IMAGES_PER_MESSAGE) {
        return `每条消息最多发送 ${MAX_IMAGES_PER_MESSAGE} 张图片`;
      }
      if (imageBytes > MAX_IMAGE_BYTES_PER_MESSAGE) {
        return "每条消息的图片合计不能超过 6MB";
      }
    }
  }
  return "";
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
    // 工具结果消息（role: tool）和只带 tool_calls 的空正文消息不打断点：
    // 空文本块会被 Anthropic 拒绝，tool 结果块加 cache_control 经 OpenRouter 转译不保证被接受。
    if (!cacheIndexes.has(i) || msg.role === "tool") {
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
    if (content.length === 0) return content;
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
    if (
      content[i]
      && typeof content[i] === "object"
      && !Array.isArray(content[i])
      && content[i].type === "text"
    ) {
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
