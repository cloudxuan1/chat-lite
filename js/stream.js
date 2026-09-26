// 回复流：思考块、引用、缓存徽章、SSE 解析、自动起标题。
// 思考图标是一只麻薯团子：身体是绕中心 16 个锚点、每段一条二次曲线的软椭圆，
// 所有帧结构相同，SVG <animate> 才能在它们之间平滑变形（iOS Safari 不支持 CSS 的 d 动画）。
const round2 = (n) => +n.toFixed(2);
function mochiPath({ rx, ry, bottom = 21.5, lean = 0 }) {
  const cy = bottom - ry;
  const point = (deg, k = 1) => {
    const a = deg * Math.PI / 180;
    const s = Math.sin(a);
    const y = cy + ry * k * (s > 0 ? Math.pow(s, 0.6) : s); // 下半边压平：团子是坐在地上的
    const x = 12 + rx * k * Math.cos(a) + lean * (bottom - y); // lean：越往上越歪，像果冻晃
    return `${round2(x)} ${round2(y)}`;
  };
  let d = `M${point(0)}`;
  for (let i = 0; i < 16; i++) d += `Q${point(i * 22.5 + 11.25, 1.02)} ${point((i + 1) * 22.5)}`;
  return `${d}Z`;
}
// 眼睛跟着身体走：身体压扁眼睛也压扁
function mochiEyes({ rx, ry, bottom = 21.5, lean = 0 }) {
  const y = bottom - ry * 1.08;
  const shift = lean * (bottom - y);
  return {
    left: round2(12 - rx * 0.36 + shift),
    right: round2(12 + rx * 0.36 + shift),
    y: round2(y),
    rx: round2(1.1 * Math.min(1.15, rx / 9.2)),
    ry: round2(1.4 * Math.min(1.15, ry / 8.2)),
  };
}
const MOCHI_REST = { rx: 9.2, ry: 8.2 };
// 一轮 2.4 秒：停一下 → 往下压蓄力 → 拉长弹起 → 最高点 → 落地压扁 → 左右晃 → 回原形
const MOCHI_FRAMES = [
  { t: 0, ...MOCHI_REST },
  { t: 0.1, ...MOCHI_REST },
  { t: 0.24, rx: 11, ry: 6.2 },
  { t: 0.42, rx: 7.8, ry: 9.5, bottom: 18.8 },
  { t: 0.56, rx: 8.6, ry: 8.6, bottom: 17 },
  { t: 0.72, rx: 11.4, ry: 6 },
  { t: 0.83, rx: 8.7, ry: 8.7, lean: 0.14 },
  { t: 0.92, rx: 9.3, ry: 8.1, lean: -0.08 },
  { t: 1, ...MOCHI_REST },
];
const MOCHI_SPLINES = ["0 0 1 1", ".45 0 .55 1", ".23 1 .32 1", ".25 .6 .5 1", ".5 0 .9 .5", ".23 1 .32 1", ".45 0 .55 1", ".45 0 .55 1"];
function mochiAnimate(attr, values) {
  return `<animate attributeName="${attr}" dur="2.4s" repeatCount="indefinite" calcMode="spline" keyTimes="${MOCHI_FRAMES.map((f) => f.t).join(";")}" keySplines="${MOCHI_SPLINES.join(";")}" values="${values.join(";")}"></animate>`;
}
function mochiMarkup(animated) {
  const rest = mochiEyes(MOCHI_REST);
  const frames = MOCHI_FRAMES.map(mochiEyes);
  const eye = (side) => `<ellipse class="mochi-eye" cx="${rest[side]}" cy="${rest.y}" rx="${rest.rx}" ry="${rest.ry}">${animated
    ? ["cx", "cy", "rx", "ry"].map((attr) => mochiAnimate(attr, frames.map((f) => (attr === "cx" ? f[side] : attr === "cy" ? f.y : f[attr])))).join("")
    : ""}</ellipse>`;
  const happy = (x) => `<path class="mochi-happy" d="M${round2(x - 1.5)} ${round2(rest.y + 0.7)}Q${round2(x)} ${round2(rest.y - 1.6)} ${round2(x + 1.5)} ${round2(rest.y + 0.7)}"></path>`;
  return `<svg class="reasoning-mochi" viewBox="0 0 24 24">` +
    `<path class="mochi-body" d="${mochiPath(MOCHI_REST)}">${animated ? mochiAnimate("d", MOCHI_FRAMES.map(mochiPath)) : ""}</path>` +
    `<g class="mochi-open">${eye("left")}${eye("right")}</g>` +
    `<g class="mochi-closed">${happy(rest.left)}${happy(rest.right)}</g></svg>`;
}

// open=false 用于从存档重建：一出生就是收起+完成态，不播放展开/收起和收尾动画
function addReasoningBlock({ webSearch, attach = true, open = true }) {
  if (hintEl) hintEl.remove();
  const root = document.createElement("div");
  root.className = open ? "reasoning is-open" : "reasoning is-done is-settled is-static";

  const toggle = document.createElement("button");
  toggle.className = "reasoning-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(open));

  // 思考中：团子一蹦一跳；完成：扁扁坐下再弹回，变灰、眼睛眯成 ^ ^
  const morph = open && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const mark = document.createElement("span");
  mark.className = "reasoning-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = mochiMarkup(morph);

  const title = document.createElement("span");
  title.className = "reasoning-title";
  title.textContent = webSearch ? "策划并搜索相关资料。" : "正在思考。";

  const chevron = document.createElement("span");
  chevron.className = "reasoning-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>';

  // panel 负责展开/收起的高度动画（grid 行 0fr↔1fr），inner 裁掉溢出
  const panel = document.createElement("div");
  panel.className = "reasoning-panel";
  const inner = document.createElement("div");
  inner.className = "reasoning-panel-inner";
  const body = document.createElement("div");
  body.className = "reasoning-body";
  inner.appendChild(body);
  panel.appendChild(inner);

  toggle.append(mark, title, chevron);
  root.append(toggle, panel);

  if (webSearch) {
    const tools = document.createElement("div");
    tools.className = "reasoning-tools";
    const item = document.createElement("div");
    item.textContent = "联网搜索已开启";
    tools.appendChild(item);
    inner.appendChild(tools);
  }

  toggle.addEventListener("click", () => {
    const open = !root.classList.contains("is-open");
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  if (attach) {
    messagesEl.appendChild(root);
    scrollToBottom();
  }

  let hasReasoning = false;
  let finished = false;
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
      if (finished) return;
      finished = true;
      root.classList.add("is-done");
      // 收尾压到最扁时（CSS mochi-settle 的 35%）再停掉变形、换成 ^ ^ 眼，跳回原形的那一下藏在最扁处
      setTimeout(() => {
        mark.querySelectorAll("animate").forEach((node) => node.remove());
        root.classList.add("is-settled");
      }, 170);
      root.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      title.textContent = hasReasoning ? "思考完成" : "思考完成";
    },
  };
}

// 刷新或切换会话后，用存下来的思考文字重建一个已收起的思考块（挂在消息区末尾，调用方接着加气泡）
function appendReasoningTrace(text) {
  const box = addReasoningBlock({ webSearch: false, open: false });
  box.append(text);
  box.finish();
  return box.root;
}

// 找助手气泡前面属于它的思考块：紧挨着气泡，或隔着「查了记忆」块；碰到别的就是没有
function findReasoningTrace(root) {
  let node = root?.previousElementSibling;
  while (node && node.classList.contains("memory-trace") && !node.classList.contains("is-user")) node = node.previousElementSibling;
  return node?.classList.contains("reasoning") ? node : null;
}

// 切换 reroll 版本后，让气泡前面的思考块跟着当前版本走（没有就拆掉）
function syncReasoningTrace(root, message) {
  const existing = findReasoningTrace(root);
  const text = message?.reasoning || "";
  if (!text) {
    existing?.remove();
    return;
  }
  const box = addReasoningBlock({ webSearch: false, attach: false, open: false });
  box.append(text);
  box.finish();
  if (existing) existing.replaceWith(box.root);
  else (findMemoryStepsTrace(root) || root).before(box.root);
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
  const toolCallDeltas = [];                    // 模型要调记忆工具时，参数按 index 分片流过来
  const reasoningDeltas = [];                   // 回放工具轮次需要把 reasoning_details 原样带回去
  let finishReason = "";
  const finish = () => ({
    full,
    annotations,
    usage,
    toolCalls: finalizeToolCalls(toolCallDeltas),
    reasoningDetails: finalizeReasoningDetails(reasoningDeltas),
    finishReason,
  });
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
      if (data === "[DONE]") return finish();
      try {
        const obj = JSON.parse(data);
        if (obj.usage) usage = obj.usage;
        const choice = obj.choices?.[0] || {};
        const delta = choice.delta || choice.message || {};
        if (typeof choice.finish_reason === "string" && choice.finish_reason) finishReason = choice.finish_reason;
        mergeToolCallDeltas(toolCallDeltas, delta.tool_calls);
        mergeReasoningDetails(reasoningDeltas, delta.reasoning_details);
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
  return finish();
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
