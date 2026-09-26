// 回复流：思考块、引用、缓存徽章、SSE 解析、自动起标题。
// 思考图标的形状：绕中心 16 个锚点、每段一条二次曲线，锚点/控制点半径按周期重复。
// 所有形状结构相同，SVG <animate> 才能在它们之间平滑变形（iOS Safari 不支持 CSS 的 d 动画）。
function sparkPath(anchors, controls) {
  const point = (r, deg) => {
    const a = (deg - 90) * Math.PI / 180;
    return `${+(12 + r * Math.cos(a)).toFixed(2)} ${+(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  let d = `M${point(anchors[0], 0)}`;
  for (let i = 0; i < 16; i++) {
    d += `Q${point(controls[i % controls.length], i * 22.5 + 11.25)} ${point(anchors[(i + 1) % anchors.length], (i + 1) * 22.5)}`;
  }
  return `${d}Z`;
}
const SPARK_SHAPES = {
  sparkle: sparkPath([10.5, 4.6, 3.8, 4.6], [5.2, 4, 4, 5.2]),   // 四角星（静止/完成时的样子）
  clover: sparkPath([9.6, 8.8, 3.2, 8.8], [10.2, 6.6, 6.6, 10.2]), // 四瓣花
  star: sparkPath([10, 4.2], [6.4, 6.4]),                          // 八角星
  blob: sparkPath([7.6], [7.75]),                                  // 圆团
};
// 四角星 → 花 → 八角星 → 圆团 → 四角星，一圈 6.4 秒，颜色在几种暖橙之间跟着变
const SPARK_MORPH =
  `<animate attributeName="d" dur="6.4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.25;.5;.75;1" keySplines=".65 0 .35 1;.65 0 .35 1;.65 0 .35 1;.65 0 .35 1" values="${SPARK_SHAPES.sparkle};${SPARK_SHAPES.clover};${SPARK_SHAPES.star};${SPARK_SHAPES.blob};${SPARK_SHAPES.sparkle}"></animate>` +
  '<animate attributeName="fill" dur="6.4s" repeatCount="indefinite" values="#d97757;#e39a78;#cf6a47;#e08a63;#d97757"></animate>';
const SPARK_SPIN = '<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="8s" repeatCount="indefinite"></animateTransform>';

// open=false 用于从存档重建：一出生就是收起+完成态，不播放展开/收起和收尾动画
function addReasoningBlock({ webSearch, attach = true, open = true }) {
  if (hintEl) hintEl.remove();
  const root = document.createElement("div");
  root.className = open ? "reasoning is-open" : "reasoning is-done is-static";

  const toggle = document.createElement("button");
  toggle.className = "reasoning-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(open));

  // 思考中：边转边变形的星星；完成：一缩一弹，定格成灰色四角星
  const morph = open && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const mark = document.createElement("span");
  mark.className = "reasoning-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = `<svg class="reasoning-spark" viewBox="0 0 24 24"><g>${morph ? SPARK_SPIN : ""}<path d="${SPARK_SHAPES.sparkle}">${morph ? SPARK_MORPH : ""}</path></g></svg>`;

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
      // 收尾动画缩到最小时（CSS spark-settle 的 40%）再停掉变形和旋转，跳回四角星的那一下藏在最小处
      setTimeout(() => {
        mark.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
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
