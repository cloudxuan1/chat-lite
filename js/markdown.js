// Markdown → HTML（只给 Claude 的回复用）。
// ===== Markdown → HTML（只给 Claude 的回复用）=====
// 先把整段文本做 HTML 转义，之后只由我们自己拼标签，所以回复里的 <script> 之类只会原样显示。
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeHref(url) {
  const value = String(url).trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : "";
}
function renderInline(text) {
  // 行内代码先摘出来占位，避免里面的 * _ [ 被当作格式
  const codes = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => safeHref(url) ? `<img src="${safeHref(url)}" alt="${alt}" loading="lazy">` : m)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => safeHref(url) ? `<a href="${safeHref(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : m)
    .replace(/(^|[^"=>])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (_, lead, url) => `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+?)~~/g, "<del>$1</del>")
    .replace(/==([^=\n]+?)==/g, "<mark>$1</mark>")
    // 模型有时直接写几个简单 HTML 标签（下划线、上下标、高亮）；只放行这几个不带属性的
    .replace(/&lt;(\/?)(u|mark|sup|sub|b|i|s|del|strong|em|kbd)&gt;/g, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/g, "<br>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}
function renderMarkdown(source) {
  const lines = escapeHtml(source).replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  const isBlank = (line) => !line.trim();
  const listItem = (line) => line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  const tableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const tableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const splitCells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const blockStart = (line) =>
    /^```/.test(line) || /^#{1,6}\s/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^&gt;\s?/.test(line) || Boolean(listItem(line)) || tableRow(line);

  function renderList(startIndent) {
    // 返回 <ul>/<ol>…，按缩进处理子列表
    const first = listItem(lines[i]);
    const ordered = /\d/.test(first[2]);
    const items = [];
    while (i < lines.length) {
      const m = listItem(lines[i]);
      if (!m || m[1].length < startIndent) break;
      if (m[1].length > startIndent) {
        // 更深的缩进：作为上一个条目的子列表
        if (!items.length) break;
        items[items.length - 1] += renderList(m[1].length);
        continue;
      }
      if (ordered !== /\d/.test(m[2])) break;
      let body = m[3];
      i++;
      // 条目的续行：缩进大于等于条目内容起点且不是新条目
      while (i < lines.length && !isBlank(lines[i]) && !listItem(lines[i]) && /^\s{2,}/.test(lines[i]) && !/^```/.test(lines[i].trim())) {
        body += "<br>" + lines[i].trim();
        i++;
      }
      // 任务列表：- [ ] / - [x]
      const task = body.match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) items.push(`<label class="md-task"><input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}>${renderInline(task[2])}</label>`);
      else items.push(renderInline(body));
    }
    const tag = ordered ? "ol" : "ul";
    const startAttr = ordered && first[2] !== "1." && first[2] !== "1)" ? ` start="${parseInt(first[2], 10)}"` : "";
    return `<${tag}${startAttr}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    // 代码块（流式输出到一半没闭合时，剩下的都当代码）
    const fence = line.match(/^```\s*([\w+#.-]*)/);
    if (fence) {
      const lang = fence[1];
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      const label = lang ? `<span class="md-code-lang">${lang}</span>` : "<span></span>";
      html.push(`<pre><div class="md-code-head">${label}<button class="md-code-copy" type="button">复制</button></div><code>${code.join("\n")}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) { html.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html.push("<hr>"); i++; continue; }
    if (/^&gt;\s?/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) { quoted.push(lines[i].replace(/^&gt;\s?/, "")); i++; }
      html.push(`<blockquote>${renderMarkdown(quoted.map((q) => q.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")).join("\n"))}</blockquote>`);
      continue;
    }
    if (listItem(line)) { html.push(renderList(listItem(line)[1].length)); continue; }
    if (tableRow(line) && i + 1 < lines.length && tableSep(lines[i + 1])) {
      const head = splitCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && tableRow(lines[i])) { rows.push(splitCells(lines[i])); i++; }
      const th = head.map((c) => `<th>${renderInline(c)}</th>`).join("");
      const body = rows.map((r) => `<tr>${head.map((_, c) => `<td>${renderInline(r[c] ?? "")}</td>`).join("")}</tr>`).join("");
      html.push(`<div class="md-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }
    // 段落：连续非空行，单个换行保留为 <br>（中文回复常靠换行分层，不能像 GitHub 那样合并成空格）
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !(para.length && blockStart(lines[i]))) { para.push(lines[i]); i++; }
    html.push(`<p>${para.map((l) => renderInline(l.trim())).join("<br>")}</p>`);
  }
  return html.join("");
}
// 往气泡里写正文：Claude 的回复渲染 Markdown，用户消息保持纯文本；空文本不渲染（保留 typing 光标）
function setBubbleText(bubble, text) {
  const target = bubble.querySelector(".message-text") || bubble;
  const isAssistant = bubble.classList.contains("assistant") && !bubble.classList.contains("error");
  if (isAssistant && text) {
    bubble.classList.add("md");
    target.innerHTML = renderMarkdown(text);
  } else {
    bubble.classList.remove("md");
    target.textContent = text;
  }
}

function makeMessageTools(role, bubble, visible, copyText = "") {
  const tools = document.createElement("div");
  tools.className = "message-tools";
  tools.hidden = !visible;

  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = messageRoleName(role);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "message-copy";
  copy.dataset.copyText = copyText;
  copy.hidden = !copyText;
  copy.setAttribute("aria-label", `复制${messageRoleName(role)}的消息`);
  copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg><span class="message-copy-label" aria-live="polite">复制</span>';
  copy.addEventListener("click", async () => {
    const label = copy.querySelector(".message-copy-label");
    try {
      await writeClipboard(copy.dataset.copyText || "");
      label.textContent = "已复制";
      copy.classList.add("is-copied");
    } catch {
      label.textContent = "复制失败";
    }
    window.setTimeout(() => {
      label.textContent = "复制";
      copy.classList.remove("is-copied");
    }, 1200);
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "message-edit";
  edit.setAttribute("aria-label", `编辑${messageRoleName(role)}的消息`);
  edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg><span class="message-edit-label">编辑</span>';
  edit.addEventListener("click", () => {
    const root = edit.closest(".message-item");
    if (root) startEditMessage(root);
  });

  tools.append(author, copy, edit);

  // 只有助手消息有「重新生成」：删掉这条回复（和它后面的消息）后按同样上下文重新请求
  if (role === "assistant") {
    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "message-reroll";
    reroll.setAttribute("aria-label", `重新生成${messageRoleName(role)}的回复`);
    reroll.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg><span class="message-reroll-label">重新生成</span>';
    reroll.addEventListener("click", () => {
      const root = reroll.closest(".message-item");
      if (root) rerollMessage(root);
    });
    tools.appendChild(reroll);

    // reroll 版本切换器「‹ 1/2 ›」，只有存在多个版本时显示（updateVariantSwitcher 控制）
    const variants = document.createElement("span");
    variants.className = "message-variants";
    variants.hidden = true;
    const makeArrow = (dir, label, path) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "message-variant-btn";
      button.dataset.dir = String(dir);
      button.setAttribute("aria-label", label);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
      button.addEventListener("click", () => {
        const root = button.closest(".message-item");
        if (root) switchVariant(root, dir);
      });
      return button;
    };
    const label = document.createElement("span");
    label.className = "message-variant-label";
    variants.append(
      makeArrow(-1, "上一个版本", "M15 18l-6-6 6-6"),
      label,
      makeArrow(1, "下一个版本", "M9 18l6-6-6-6"),
    );
    tools.appendChild(variants);
  }
  return tools;
}

function revealMessageTools(bubble) {
  const tools = bubble.closest(".message-item")?.querySelector(".message-tools");
  if (tools) tools.hidden = false;
}

function updateMessageLabels() {
  document.querySelectorAll(".message-item").forEach((item) => {
    const role = item.dataset.role;
    const author = item.querySelector(".message-author");
    const copy = item.querySelector(".message-copy");
    if (author) author.textContent = messageRoleName(role);
    if (copy) copy.setAttribute("aria-label", `复制${messageRoleName(role)}的消息`);
    const edit = item.querySelector(".message-edit");
    if (edit) edit.setAttribute("aria-label", `编辑${messageRoleName(role)}的消息`);
    const reroll = item.querySelector(".message-reroll");
    if (reroll) reroll.setAttribute("aria-label", `重新生成${messageRoleName(role)}的回复`);
  });
}

function appendMessageImage(grid, record, attachment) {
  if (!record?.blob) {
    const missing = document.createElement("span");
    missing.className = "message-image-missing";
    missing.textContent = "这张图片已不在本机";
    grid.appendChild(missing);
    return;
  }
  const image = document.createElement("img");
  image.className = "message-image";
  image.alt = attachment?.name || "对话图片";
  image.loading = "lazy";
  const url = URL.createObjectURL(record.blob);
  messageObjectUrls.push(url);
  image.src = url;
  grid.appendChild(image);
}

async function hydrateMessageImages(grid, attachments, conversationId) {
  let records;
  try {
    records = await getImageRecords(attachments);
  } catch {
    records = attachments.map(() => null);
  }
  if (
    !grid.isConnected ||
    getActiveConversation().id !== conversationId
  ) return;
  grid.replaceChildren();
  records.forEach((record, index) =>
    appendMessageImage(grid, record, attachments[index])
  );
  scrollToBottom();
}

function addBubble(role, text, attachments = [], conversationId = "", messageIndex = null) {
  if (hintEl) hintEl.remove();
  const root = document.createElement("div");
  root.className = `message-item ${role}`;
  root.dataset.role = role;
  if (messageIndex !== null) root.dataset.msgIndex = String(messageIndex);
  const el = document.createElement("div");
  el.className = "msg " + role;
  if (attachments.length) {
    el.classList.add("has-images");
    const textElement = document.createElement("span");
    textElement.className = "message-text";
    const grid = document.createElement("span");
    grid.className = `message-images${attachments.length === 1 ? " single" : ""}`;
    attachments.forEach(() => {
      const loading = document.createElement("span");
      loading.className = "message-image-missing";
      loading.textContent = "正在载入图片…";
      grid.appendChild(loading);
    });
    el.append(textElement, grid);
    setBubbleText(el, text);
    void hydrateMessageImages(grid, attachments, conversationId || getActiveConversation().id);
  } else {
    setBubbleText(el, text);
  }
  root.append(el, makeMessageTools(role, el, Boolean(text || attachments.length), text));
  if (messageIndex !== null) {
    const stored = conversationById(conversationId || getActiveConversation().id)
      ?.messages[messageIndex];
    if (stored) updateVariantSwitcher(root, stored);
  }
  messagesEl.appendChild(root);
  scrollToBottom();
  return el;
}

function buildConversationMarkdown() {
  return getActiveConversation().messages
    .map((item) => {
      const body = [
        item.content.trim(),
        item.attachments?.length ? `〔附带 ${item.attachments.length} 张图片〕` : "",
      ].filter(Boolean).join("\n\n");
      return `## ${messageRoleName(item.role)}\n\n${body}`;
    })
    .join("\n\n")
    .trimEnd() + "\n";
}

function downloadConversation() {
  const conversation = getActiveConversation();
  if (!conversation.messages.length || pending) return;
  // 文件名优先级：设置里手填的固定名 > 当前会话名 > 日期时间兜底
  const customBase = safeExportFileBase(exportFileName);
  const titleBase = safeExportFileBase(conversation.title);
  const filename = `${customBase || titleBase || defaultExportFileBase()}.md`;
  const blob = new Blob([buildConversationMarkdown()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
