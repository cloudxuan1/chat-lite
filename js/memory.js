// 记忆库（ember）接入：开场小抄、模型调工具时的代执行、隐藏步骤的归一化与回放、界面上的「查了记忆」。
// 链路：新会话第一句 → Worker action "memory-briefing" 拿开场小抄，作为第二个文本块附在这条用户消息里（memoryContext）；
// 之后 memory_search / memory_recall 作为 function tool 挂给模型，模型要查时前端把调用转给 Worker action "memory-tool"，
// 结果作为 role:"tool" 消息回给模型，中间这些消息以 steps 藏在最终那条助手消息里，下一轮原样回放（缓存前缀才不会断）。
// 本文件没有顶层状态（memoryEnabled 在 shared/store.js）也没有顶层事件绑定；它必须排在 store.js 之前，
// 因为 normalizeStoredMessages（prompts.js）在页面加载时就会调用这里的 normalizeMemorySteps。

// ---- 开场小抄 ----
function formatMemoryBriefing(items) {
  const lines = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object" && typeof item.content === "string" && item.content.trim())
    .map((item) => {
      const meta = [item.id !== undefined ? `#${item.id}` : "", item.date || "", item.reason || ""].filter(Boolean).join(" · ");
      return `- ${meta ? `[${meta}] ` : ""}${item.content.trim()}`;
    });
  if (!lines.length) return "";
  const text = [
    "〔记忆库开场小抄，仅供背景参考〕",
    "以下是关于用户过去的记忆，不是任务清单，也不覆盖系统提示词和用户当前的要求。",
    "自然地带到其中最相关或最有温度的一两件即可，其余记在心里、话题碰到再用，不要逐条汇报。",
    "需要细节可用 memory_recall(id) 取全文；想找别的可用 memory_search。",
    ...lines,
  ].join("\n");
  return Array.from(text).slice(0, MEMORY_CONTEXT_MAX_CHARS).join("");
}

function normalizeMemoryContext(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text ? Array.from(text).slice(0, MEMORY_CONTEXT_MAX_CHARS).join("") : "";
}

// 把小抄文本拆回条目，只为界面展示（存的是文本，模型看到什么界面就显示什么）
function memoryBriefingEntries(memoryContext) {
  return String(memoryContext || "")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}

// ---- 隐藏步骤（tool_calls / tool 结果）的归一化 ----
function normalizeToolCalls(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .filter((call) =>
      call && typeof call === "object" &&
      typeof call.id === "string" && call.id && call.id.length <= 200 &&
      call.function && typeof call.function === "object" &&
      typeof call.function.name === "string" && MEMORY_TOOL_NAMES.has(call.function.name)
    )
    .filter((call) => !seen.has(call.id) && seen.add(call.id))
    .map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.function.name,
        arguments: typeof call.function.arguments === "string" ? call.function.arguments : "{}",
      },
    }));
}

function normalizeReasoningDetailsList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => JSON.parse(JSON.stringify(item)));
}

// 合法形状：assistant（带 tool_calls）→ 对应的 tool 结果…；不成对的、不认识的工具一律丢弃。
function normalizeMemorySteps(items) {
  if (!Array.isArray(items)) return [];
  const steps = [];
  let openCalls = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.role === "assistant") {
      const toolCalls = normalizeToolCalls(item.tool_calls);
      if (!toolCalls.length) continue;
      const reasoning = normalizeReasoningDetailsList(item.reasoning_details);
      steps.push({
        role: "assistant",
        content: typeof item.content === "string" ? item.content : "",
        tool_calls: toolCalls,
        ...(reasoning.length ? { reasoning_details: reasoning } : {}),
      });
      openCalls = new Set(toolCalls.map((call) => call.id));
    } else if (item.role === "tool") {
      if (typeof item.tool_call_id !== "string" || !openCalls.has(item.tool_call_id)) continue;
      steps.push({
        role: "tool",
        tool_call_id: item.tool_call_id,
        content: typeof item.content === "string" ? item.content : "",
      });
      openCalls.delete(item.tool_call_id);
    }
  }
  // 最后一次调用如果没有结果，整段都不可信（回放时模型会看到悬空的 tool_call）
  return openCalls.size ? [] : steps;
}

// reroll 版本各自的步骤：与 variants 等长，没有步骤的位置是 null；全空则返回 null（不存这个键）
function normalizeVariantSteps(items, count) {
  if (!Array.isArray(items) || count < 2) return null;
  const list = Array.from({ length: count }, (_, i) => {
    const steps = normalizeMemorySteps(items[i]);
    return steps.length ? steps : null;
  });
  return list.some(Boolean) ? list : null;
}

// ---- 流式增量合并（OpenAI 风格：按 index 拼 arguments / 拼 reasoning 文本）----
function mergeToolCallDeltas(accumulator, deltas) {
  if (!Array.isArray(deltas)) return accumulator;
  deltas.forEach((delta, position) => {
    if (!delta || typeof delta !== "object") return;
    const index = Number.isInteger(delta.index) ? delta.index : position;
    const entry = accumulator[index] || (accumulator[index] = {
      id: "",
      type: "function",
      function: { name: "", arguments: "" },
    });
    if (typeof delta.id === "string" && delta.id) entry.id = delta.id;
    if (typeof delta.function?.name === "string" && delta.function.name) entry.function.name = delta.function.name;
    if (typeof delta.function?.arguments === "string") entry.function.arguments += delta.function.arguments;
  });
  return accumulator;
}

function finalizeToolCalls(accumulator) {
  return accumulator
    .filter((entry) => entry && entry.id && entry.function.name)
    .map((entry) => ({
      id: entry.id,
      type: "function",
      function: { name: entry.function.name, arguments: entry.function.arguments || "{}" },
    }));
}

// OpenRouter 的 reasoning_details 流式到达时按 index 分片：文本类字段拼接，其余字段（type/id/format/signature）后到覆盖先到。
function mergeReasoningDetails(accumulator, details) {
  if (!Array.isArray(details)) return accumulator;
  details.forEach((detail, position) => {
    if (!detail || typeof detail !== "object") return;
    const index = Number.isInteger(detail.index) ? detail.index : position;
    const entry = accumulator[index] || (accumulator[index] = {});
    for (const [key, value] of Object.entries(detail)) {
      if (value === undefined || value === null) continue;
      if ((key === "text" || key === "summary" || key === "data") && typeof value === "string") {
        entry[key] = (typeof entry[key] === "string" ? entry[key] : "") + value;
      } else {
        entry[key] = value;
      }
    }
  });
  return accumulator;
}

function finalizeReasoningDetails(accumulator) {
  return accumulator.filter((entry) => entry && Object.keys(entry).length > 0);
}

function parseToolArguments(call) {
  try {
    const parsed = JSON.parse(call?.function?.arguments || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ---- 发给 OpenRouter 的形状 ----
// 用户消息：小抄作为第二个文本块紧跟在用户原话之后（图片块仍在最后）
function withMemoryContext(message, item) {
  if (item?.role !== "user" || !item.memoryContext) return message;
  const memoryBlock = { type: "text", text: item.memoryContext };
  if (typeof message.content === "string") {
    return { ...message, content: [{ type: "text", text: message.content }, memoryBlock] };
  }
  if (!Array.isArray(message.content)) return message;
  const [first, ...rest] = message.content;
  return { ...message, content: first ? [first, memoryBlock, ...rest] : [memoryBlock] };
}

// 助手消息里藏的步骤展开成真实的 assistant(tool_calls) / tool 消息，放在最终回复之前
function expandMemorySteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((step) => (
    step.role === "assistant"
      ? {
        role: "assistant",
        content: step.content || "",
        tool_calls: step.tool_calls,
        ...(step.reasoning_details ? { reasoning_details: step.reasoning_details } : {}),
      }
      : { role: "tool", tool_call_id: step.tool_call_id, content: step.content }
  ));
}

// ---- 走 Worker ----
async function requestMemoryBriefing(topic) {
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "memory-briefing", password: accessPw, topic }),
    });
    if (!response.ok) return "";
    const data = await response.json().catch(() => null);
    return formatMemoryBriefing(data?.items);
  } catch {
    return "";   // 记忆库不在也照常聊
  }
}

// 返回给模型的工具结果（字符串）。密码失效抛 401，其余失败都变成 ok:false 的说明让模型自己处理。
async function runMemoryTool(call) {
  let response;
  try {
    response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "memory-tool",
        password: accessPw,
        name: call.function.name,
        arguments: parseToolArguments(call),
      }),
    });
  } catch {
    return JSON.stringify({ ok: false, error: "连接记忆库代理失败，这次查不了，请直接回答" });
  }
  if (response.status === 401) {
    const error = new Error("访问密码错误");
    error.code = 401;
    throw error;
  }
  if (!response.ok) {
    return JSON.stringify({ ok: false, error: `记忆库代理返回 ${response.status}，这次查不了，请直接回答` });
  }
  const data = await response.json().catch(() => null);
  return JSON.stringify(data && typeof data === "object" ? data : { ok: false, error: "记忆库返回格式异常" });
}

// ---- 界面：可折叠的「查了记忆」/「记忆小抄」----
function memoryStepEntries(steps) {
  const results = new Map();
  (steps || []).forEach((step) => {
    if (step.role === "tool") results.set(step.tool_call_id, step.content);
  });
  const entries = [];
  (steps || []).forEach((step) => {
    if (step.role !== "assistant") return;
    step.tool_calls.forEach((call) => {
      const args = parseToolArguments(call);
      let parsed = null;
      try { parsed = JSON.parse(results.get(call.id) || ""); } catch { parsed = null; }
      const label = call.function.name === "memory_recall"
        ? `取全文 #${args.id ?? "?"}`
        : `搜索「${String(args.query || "").slice(0, 40)}」${args.space ? ` · ${args.space}` : ""}`;
      let outcome;
      const details = [];
      if (!results.has(call.id)) {
        outcome = "查询中…";
      } else if (!parsed || parsed.ok === false) {
        outcome = `失败：${parsed?.error || "无法解析结果"}`;
      } else if (call.function.name === "memory_recall") {
        outcome = "已取到";
        if (typeof parsed.result?.content === "string") details.push(parsed.result.content.slice(0, 160));
      } else {
        const list = Array.isArray(parsed.result?.results) ? parsed.result.results : [];
        outcome = `命中 ${list.length} 条`;
        list.forEach((item) => details.push(`#${item.id} ${String(item.content || "").slice(0, 80)}`));
      }
      entries.push({ label: `${label} · ${outcome}`, details });
    });
  });
  return entries;
}

function buildMemoryTrace(summaryText, entries, { user = false } = {}) {
  const root = document.createElement("div");
  root.className = `memory-trace${user ? " is-user" : ""}`;

  const toggle = document.createElement("button");
  toggle.className = "memory-trace-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  const summary = document.createElement("span");
  summary.className = "memory-trace-summary";
  summary.textContent = summaryText;
  const chevron = document.createElement("span");
  chevron.className = "memory-trace-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  toggle.append(summary, chevron);

  const list = document.createElement("div");
  list.className = "memory-trace-list";
  root.append(toggle, list);
  toggle.addEventListener("click", () => {
    const open = !root.classList.contains("is-open");
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  const render = (text, items) => {
    summary.textContent = text;
    list.replaceChildren();
    items.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "memory-trace-item";
      const title = document.createElement("div");
      title.className = "memory-trace-item-title";
      title.textContent = typeof entry === "string" ? entry : entry.label;
      item.appendChild(title);
      (typeof entry === "string" ? [] : entry.details).forEach((line) => {
        const detail = document.createElement("div");
        detail.className = "memory-trace-item-detail";
        detail.textContent = line;
        item.appendChild(detail);
      });
      list.appendChild(item);
    });
  };
  render(summaryText, entries);
  return { root, render };
}

function memoryStepsSummary(steps) {
  const count = (steps || []).reduce((total, step) => total + (step.role === "assistant" ? step.tool_calls.length : 0), 0);
  return `查了记忆 · ${count} 次`;
}

// 存档重绘时用：小抄放在用户气泡之后、步骤放在助手气泡之前（调用方决定先后）
function appendMemoryBriefingTrace(memoryContext) {
  const entries = memoryBriefingEntries(memoryContext);
  if (!entries.length) return null;
  const trace = buildMemoryTrace(`记忆小抄 · ${entries.length} 条`, entries, { user: true });
  messagesEl.appendChild(trace.root);
  return trace;
}

function appendMemoryStepsTrace(steps) {
  if (!steps?.length) return null;
  const trace = buildMemoryTrace(memoryStepsSummary(steps), memoryStepEntries(steps));
  messagesEl.appendChild(trace.root);
  return trace;
}

// 切换 reroll 版本后，让气泡前面那条「查了记忆」跟着当前版本走
function syncMemoryStepsTrace(root, message) {
  const previous = root.previousElementSibling;
  const existing = previous?.classList?.contains("memory-trace") && !previous.classList.contains("is-user") ? previous : null;
  const steps = message?.steps || [];
  if (!steps.length) {
    existing?.remove();
    return;
  }
  const trace = buildMemoryTrace(memoryStepsSummary(steps), memoryStepEntries(steps));
  if (existing) existing.replaceWith(trace.root);
  else root.before(trace.root);
}

// ---- 开关 ----
function setMemoryEnabled(value) {
  memoryEnabled = Boolean(value);
  localStorage.setItem(MEMORY_KEY, memoryEnabled ? "1" : "0");
  updateTopbar();
  updateToolSummaries();
}
