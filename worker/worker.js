// ember 代理 Worker
// 作用：给前端请求偷偷加上 OpenRouter 的 API key，并把流式回复原样转回前端。
// API key 存在 Cloudflare 的 Secret 里（变量名 OPENROUTER_API_KEY），不写进代码、不暴露给前端。
//
// 提示词缓存（applyPromptCache）：给消息打上 cache_control 标记，命中时这部分内容
// 不用按全价重新计费（读缓存约 0.1x 价格），代价是首次写入贵 1.25x。只有前缀字节完全
// 一致才会命中，门槛是约 4096 token，不满门槛就悄悄跳过、不报错也不多收钱。
// 怎么验证命中：连续发两轮消息后，看浏览器 Network 面板里最后一个 SSE chunk，
// 字段 usage.prompt_tokens_details.cached_tokens > 0 就是命中了。

// 只允许这个来源的网页调用（你的 GitHub Pages 域名）。换域名就改这一行。
const ALLOWED_ORIGIN = "https://cloudxuan1.github.io";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-opus-4.6";

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

    const { messages, model, password, reasoning, webSearch } = payload;
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages 必须是非空数组" }, 400);
    }

    // 访问密码校验：挡住公开网址被陌生人直接调用、白嫖你的 API key。
    // 密码存在 Cloudflare Secret（ACCESS_PASSWORD）里；没设或不匹配一律拒绝，绝不调用 OpenRouter。
    if (!env.ACCESS_PASSWORD || password !== env.ACCESS_PASSWORD) {
      return json({ error: "访问密码错误" }, 401);
    }

    let upstream;
    try {
      const body = {
        model: model || DEFAULT_MODEL,
        messages: applyPromptCache(messages, model),
        stream: true,
        usage: { include: true },
      };
      if (reasoning) {
        body.include_reasoning = true;
        body.reasoning = { effort: "medium" };
      }
      if (webSearch) {
        body.plugins = [{ id: "web", max_results: 5 }];
      }

      upstream = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": ALLOWED_ORIGIN,
          "X-Title": "ember",
        },
        body: JSON.stringify(body),
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

// 给消息数组打提示词缓存断点，返回新数组，不改入参 messages。
// 规则：只处理 anthropic/claude 开头的模型（其它供应商可能不认 cache_control，原样放行避免多扣费）；
// 滚动双断点打在“最后一条”和“倒数第三条”（存在的话，即上一轮的 user 消息）上，
// 这样前一轮已经写过缓存的前缀这一轮还能命中；不足 3 条消息时只打最后一条。
// 只把选中的消息 content 从字符串转成块数组，其余消息原样保留字符串，
// 保证同一条消息在相邻两轮里的字节前缀不变（这是命中缓存的前提）。
// content 已经不是字符串的（比如已经是数组）原样跳过，防御未来格式变化。
export function applyPromptCache(messages, model) {
  const effectiveModel = model || DEFAULT_MODEL;
  if (typeof effectiveModel !== "string" || !effectiveModel.startsWith("anthropic/claude")) {
    return messages;
  }

  const cacheIndexes = new Set();
  const lastIndex = messages.length - 1;
  if (lastIndex >= 0) cacheIndexes.add(lastIndex);
  if (messages.length >= 3) cacheIndexes.add(messages.length - 3);

  return messages.map((msg, i) => {
    if (!cacheIndexes.has(i) || typeof msg.content !== "string") {
      return msg;
    }
    return {
      ...msg,
      content: [
        {
          type: "text",
          text: msg.content,
          cache_control: { type: "ephemeral" },
        },
      ],
    };
  });
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
