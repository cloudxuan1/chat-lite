// 回复流：思考块、引用、缓存徽章、SSE 解析、自动起标题。
function addReasoningBlock({ webSearch }) {
  if (hintEl) hintEl.remove();
  const root = document.createElement("div");
  root.className = "reasoning is-open";

  const toggle = document.createElement("button");
  toggle.className = "reasoning-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");

  const mark = document.createElement("span");
  mark.className = "reasoning-mark";
  mark.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "reasoning-title";
  title.textContent = webSearch ? "策划并搜索相关资料。" : "正在思考。";

  const done = document.createElement("span");
  done.className = "reasoning-done";
  done.textContent = "Done";

  const chevron = document.createElement("span");
  chevron.className = "reasoning-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";

  const body = document.createElement("div");
  body.className = "reasoning-body";

  toggle.append(mark, title, done, chevron);
  root.append(toggle, body);

  if (webSearch) {
    const tools = document.createElement("div");
    tools.className = "reasoning-tools";
    const item = document.createElement("div");
    item.textContent = "联网搜索已开启";
    tools.appendChild(item);
    root.appendChild(tools);
  }

  toggle.addEventListener("click", () => {
    const open = !root.classList.contains("is-open");
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  messagesEl.appendChild(root);
  scrollToBottom();

  let hasReasoning = false;
  return {
    root,
    append(delta) {
      hasReasoning = true;
      if (title.textContent === "正在思考。" || title.textContent === "策划并搜索相关资料。") {
        title.textContent = webSearch ? "策划并搜索相关资料。" : "整理思路。";
      }
      body.textContent += delta;
    },
    finish() {
      root.classList.add("is-done");
      root.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      title.textContent = hasReasoning ? "思考完成" : "思考完成";
    },
  };
}

function addCitations(annotations) {
  const seenUrls = new Set();
  const links = (annotations || [])
    .map((item) => item?.url_citation || item)
    .filter((item) => item?.url)
    .filter((item) => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    })
    .slice(0, 10);
  if (!links.length) return;

  const root = document.createElement("div");
  root.className = "citations";

  const toggle = document.createElement("button");
  toggle.className = "citations-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");

  const summary = document.createElement("span");
  summary.textContent = `联网搜索 · 来源 ${links.length} 条`;

  const chevron = document.createElement("span");
  chevron.className = "citations-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";

  const list = document.createElement("div");
  list.className = "citations-list";
  links.forEach((item) => {
    const a = document.createElement("a");
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = item.title || new URL(item.url).hostname;
    list.appendChild(a);
  });

  toggle.append(summary, chevron);
  root.append(toggle, list);
  toggle.addEventListener("click", () => {
    const open = !root.classList.contains("is-open");
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) scrollToBottom();
  });

  messagesEl.appendChild(root);
  scrollToBottom();
}

// 缓存状态小徽章：优先显示读取命中，其次显示本轮新写入；门槛由所选模型决定。
function addCacheBadge(usage, modelId) {
  const details = usage?.prompt_tokens_details;
  const promptTokens = Number(usage?.prompt_tokens || 0);
  const cached = Number(details?.cached_tokens || 0);
  const written = Number(details?.cache_write_tokens || usage?.cache_write_tokens || 0);
  const isClaude = String(modelId || "").startsWith("anthropic/claude");
  if (!promptTokens || (!isClaude && !cached && !written)) return;

  const el = document.createElement("div");
  el.className = "cache-badge";
  el.title = "缓存是否生效取决于模型门槛和前缀是否保持一致";
  const num = document.createElement("span");
  num.className = "num";
  if (cached > 0) {
    el.classList.add("hit");
    num.textContent = `${cached.toLocaleString()} / ${promptTokens.toLocaleString()}`;
    el.append("缓存命中 ", num);
  } else if (written > 0) {
    el.classList.add("write");
    num.textContent = written.toLocaleString();
    el.append("缓存写入 ", num);
  } else {
    num.textContent = promptTokens.toLocaleString();
    el.append("本轮未命中 · 输入 ", num);
  }
  messagesEl.appendChild(el);
}

function textFromResponseValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(textFromResponseValue).filter(Boolean).join("");
  }
  if (!value || typeof value !== "object" || value.type === "reasoning.encrypted") {
    return "";
  }
  return textFromResponseValue(value.text) ||
    textFromResponseValue(value.summary) ||
    textFromResponseValue(value.content);
}

function textFromReasoningDelta(delta) {
  return textFromResponseValue(delta?.reasoning) ||
    textFromResponseValue(delta?.reasoning_content) ||
    textFromResponseValue(delta?.reasoning_details);
}

function appendAnnotations(target, ...groups) {
  groups.forEach((group) => {
    if (Array.isArray(group)) target.push(...group);
  });
}

// 解析 SSE 流，每收到一段文字就回调 callbacks，返回完整正文和来源
async function readStream(body, callbacks) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  const annotations = [];
  let usage = null;                             // OpenRouter 在最后一个数据块里附带 token 账单
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();                       // 最后一行可能不完整，留到下次
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith(":")) continue;    // 跳过空行和注释（如 OpenRouter 的心跳）
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") return { full, annotations, usage };
      try {
        const obj = JSON.parse(data);
        if (obj.usage) usage = obj.usage;
        const choice = obj.choices?.[0] || {};
        const delta = choice.delta || choice.message || {};
        const reasoning = textFromReasoningDelta(delta);
        if (reasoning) callbacks.onReasoning(reasoning);
        appendAnnotations(
          annotations,
          delta.annotations,
          choice.annotations,
          choice.message && choice.message !== delta ? choice.message.annotations : null,
          obj.annotations,
        );
        const content = textFromResponseValue(delta.content);
        if (content) {
          full += content;
          callbacks.onContent(content);
        }
      } catch { /* 半截 JSON，忽略 */ }
    }
  }
  return { full, annotations, usage };
}

async function requestConversationTitle(conversationId, firstMessage) {
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "title",
        password: accessPw,
        text: firstMessage,
      }),
    });
    if (!response.ok) return;
    const data = await response.json().catch(() => null);
    const title = normalizeConversationTitle(data?.title);
    if ((title.match(/[\p{L}\p{N}]/gu) || []).length < 2) return;

    const draft = cloneConversationStore();
    const target = conversationById(conversationId, draft);
    const firstUserMessage = target?.messages.find((item) => item.role === "user");
    if (!target || target.titleSource !== "fallback" || firstUserMessage?.content !== firstMessage) return;
    target.title = title;
    target.titleSource = "deepseek";
    if (!persistConversationStore(draft)) return;
    if (!renamingConversationId) renderConversationList();
  } catch {
    // 自动标题失败时保留本地标题，不打断聊天。
  }
}
