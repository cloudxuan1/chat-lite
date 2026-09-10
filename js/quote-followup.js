// 选中一段追问：选中回复文字弹小按钮，点了把引用带进输入框。
// ===== 选中一段追问：在 Claude 的回复里选中文字，弹出小按钮，点了把引用带进输入框 =====
const quotePill = document.getElementById("quote-pill");
let quoteText = "";
let quoteTimer = 0;
function selectedReplyText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  const bubble = element?.closest(".message-item.assistant .msg");
  if (!bubble || bubble.classList.contains("error") || bubble.closest(".message-item")?.classList.contains("is-editing")) return null;
  const text = selection.toString().replace(/\r/g, "").trim();
  if (!text) return null;
  return { text };
}
function hideQuotePill() {
  if (quotePill.hidden) return;
  quotePill.classList.remove("is-visible");
  quotePill.hidden = true;
}
function updateQuotePill() {
  const found = anySettingsScreenOpen() || pending ? null : selectedReplyText();
  if (!found) { hideQuotePill(); return; }
  quoteText = found.text;
  quotePill.hidden = false;
  // 固定在输入栏上方正中：iOS 自带的复制菜单会贴着选区上下弹，跟着选区放必然撞上
  const composerTop = document.getElementById("composer").getBoundingClientRect().top;
  quotePill.style.bottom = `${Math.round(window.innerHeight - composerTop + 12)}px`;
  requestAnimationFrame(() => { if (!quotePill.hidden) quotePill.classList.add("is-visible"); });
}
document.addEventListener("selectionchange", () => {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(updateQuotePill, 140);
});
messagesEl.addEventListener("scroll", hideQuotePill, { passive: true });
// 点别处（包括打开设置/侧栏的按钮）先收起；重新选中会再弹
document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#quote-pill")) hideQuotePill(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideQuotePill(); closeSwipeRow(); } }, true);
// 按住按钮时别让浏览器先把选区清掉
quotePill.addEventListener("pointerdown", (event) => event.preventDefault());
quotePill.addEventListener("click", () => {
  const text = quoteText;
  hideQuotePill();
  if (!text) return;
  const quote = text.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
  const existing = input.value.trimEnd();
  input.value = (existing ? existing + "\n\n" : "") + quote;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  window.getSelection()?.removeAllRanges();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.scrollTop = input.scrollHeight;
});

async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Safari 或浏览器权限拒绝时，继续尝试兼容复制。
    }
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.top = "0";
  helper.style.left = "-9999px";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  helper.setSelectionRange(0, helper.value.length);
  const copied = document.execCommand("copy");
  helper.remove();
  if (!copied) throw new Error("浏览器未允许复制");
}

function messageRoleName(role) {
  return role === "user" ? userDisplayName : assistantDisplayName;
}

function showComposerStatus(message, { error = false, source = "" } = {}) {
  composerStatus.textContent = message || "";
  composerStatus.classList.toggle("is-error", Boolean(message && error));
  composerStatus.dataset.source = message ? source : "";
}

function updateAttachmentState() {
  const capability = modelImageCapability(modelById(currentModel));
  imageAttach.disabled = pending ||
    imageProcessingJobs > 0 ||
    capability === "unsupported";
  composerAttachments.setAttribute("aria-busy", String(imageProcessingJobs > 0));
  imageAttach.setAttribute(
    "aria-label",
    capability === "unsupported" ? "当前模型不支持图片" : "添加图片",
  );
  if (capability === "unsupported") {
    if (pendingImages.length) {
      showComposerStatus("当前模型不能看图；图片草稿已保留，请换一个支持图片的模型。", {
        error: true,
        source: "capability",
      });
    } else if (!composerStatus.textContent || composerStatus.dataset.source === "capability") {
      showComposerStatus("当前模型不能看图。", { source: "capability" });
    }
  } else if (composerStatus.dataset.source === "capability") {
    showComposerStatus("");
  }
}

// 就地编辑一条消息的正文：气泡变输入框，保存写回会话并落盘，取消/Esc/纯文字清空则还原
function startEditMessage(root) {
  // 回复流式输出时（pending）不允许编辑，避免改到正在发送的上下文
  if (pending || !root || root.classList.contains("is-editing")) return;
  const index = Number(root.dataset.msgIndex);
  if (!Number.isInteger(index)) return;
  const conversation = getActiveConversation();
  const convId = conversation.id;
  const message = conversation.messages[index];
  if (!message) return;

  const bubble = root.querySelector(".msg");
  if (!bubble) return;
  const textTarget = bubble.querySelector(".message-text") || bubble;
  const hasImages = Boolean(bubble.querySelector(".message-images"));
  const originalTools = root.querySelector(".message-tools");

  const area = document.createElement("textarea");
  area.className = "message-edit-area";
  area.rows = 1; // 默认 rows=2 会让单行消息的编辑框固定占两行高
  area.value = message.content;
  area.setAttribute("aria-label", `编辑${messageRoleName(message.role)}的消息`);
  bubble.classList.remove("md");
  textTarget.textContent = "";
  textTarget.appendChild(area);
  root.classList.add("is-editing");

  const autoGrow = () => {
    // 同 autoGrowSystemPrompt：改高度前后保住消息区滚动位置，避免每敲一个字上下跳
    const scrollTop = messagesEl.scrollTop;
    area.style.height = "auto";
    area.style.height = area.scrollHeight + "px";
    messagesEl.scrollTop = scrollTop;
  };
  area.addEventListener("input", autoGrow);
  autoGrow();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);

  const actions = document.createElement("div");
  actions.className = "message-tools";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "message-edit-action";
  cancelBtn.textContent = "取消";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "message-edit-action is-save";
  saveBtn.textContent = "保存";

  const exitEdit = () => {
    root.classList.remove("is-editing");
    actions.remove();
    if (originalTools) originalTools.hidden = false;
  };

  const cancelEdit = () => {
    setBubbleText(bubble, message.content);
    exitEdit();
  };

  const saveEdit = () => {
    const value = area.value.trim();
    // 纯文字消息不允许清空；带图消息可以只留图、去掉文字说明
    if (!value && !hasImages) { cancelEdit(); return; }
    const draft = cloneConversationStore();
    const draftConversation = conversationById(convId, draft);
    const draftMessage = draftConversation?.messages[index];
    if (draftMessage) {
      draftMessage.content = value;
      // 有 reroll 版本时同步改当前版本，否则归一化会用旧版本盖掉这次编辑
      if (draftMessage.variants?.length) {
        draftMessage.variants[draftMessage.activeVariant ?? draftMessage.variants.length - 1] = value;
      }
    }
    persistConversationStore(draft, { keepInMemoryOnFailure: true });
    // 就地更新，保留当前会话里已经显示的思考/来源/缓存徽章，不整段重渲染
    setBubbleText(bubble, value);
    exitEdit();
    const copy = originalTools?.querySelector(".message-copy");
    if (copy) {
      copy.dataset.copyText = value;
      copy.hidden = !value;
    }
  };

  cancelBtn.addEventListener("click", cancelEdit);
  saveBtn.addEventListener("click", saveEdit);
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  });

  actions.append(cancelBtn, saveBtn);
  if (originalTools) originalTools.hidden = true;
  root.append(actions);
}

// 重新生成一条助手回复：旧回复留在 variants 里可切回，新回复流式写进同一个气泡；
// 这条回复后面的消息（如果有）是基于旧版本聊出来的，会先弹确认再删除
function rerollMessage(root) {
  if (pending || !root || root.classList.contains("is-editing")) return;
  const index = Number(root.dataset.msgIndex);
  if (!Number.isInteger(index)) return;
  const conversation = getActiveConversation();
  const convId = conversation.id;
  const message = conversation.messages[index];
  if (!message || message.role !== "assistant") return;

  const followingCount = conversation.messages.length - index - 1;
  if (
    followingCount > 0 &&
    !window.confirm(`重新生成会删除它后面的 ${followingCount} 条消息（这条回复的旧版本会保留，可用箭头切回），确定吗？`)
  ) return;

  if (followingCount > 0) {
    const draft = cloneConversationStore();
    const draftConversation = conversationById(convId, draft);
    if (!draftConversation) return;
    const removedAttachments = draftConversation.messages
      .slice(index + 1)
      .flatMap((item) => item.attachments || []);
    draftConversation.messages = draftConversation.messages.slice(0, index + 1);
    draftConversation.updatedAt = new Date().toISOString();
    if (!persistConversationStore(draft)) return;
    void deleteImageRecords(removedAttachments).catch(() => {});
    renderActiveConversation();
    renderConversationList();
  }

  const bubble = messagesEl.querySelector(`.message-item[data-msg-index="${index}"] .msg`);
  if (!bubble) return;
  setPending(true);
  void streamAssistantReply({
    conversationId: convId,
    sessionId: conversation.sessionId,
    model: currentModel,
    effort: normalizeEffortForModel(reasoningEffort, modelById(currentModel)),
    assistantIndex: index,
    existingBubble: bubble,
  });
}

// 在一条助手回复的多个 reroll 版本之间切换：就地换正文、复制内容和计数，并落盘
function switchVariant(root, direction) {
  if (pending || !root || root.classList.contains("is-editing")) return;
  const index = Number(root.dataset.msgIndex);
  if (!Number.isInteger(index)) return;
  const conversation = getActiveConversation();
  const message = conversation.messages[index];
  const count = message?.variants?.length || 0;
  if (message?.role !== "assistant" || count < 2) return;
  const current = message.activeVariant ?? count - 1;
  const target = Math.min(Math.max(current + direction, 0), count - 1);
  if (target === current) return;

  const draft = cloneConversationStore();
  const draftMessage = conversationById(conversation.id, draft)?.messages[index];
  if (!draftMessage?.variants) return;
  draftMessage.activeVariant = target;
  draftMessage.content = draftMessage.variants[target];
  persistConversationStore(draft, { keepInMemoryOnFailure: true });

  const updated = getActiveConversation().messages[index];
  const bubble = root.querySelector(".msg");
  if (bubble) setBubbleText(bubble, updated.content);
  const copy = root.querySelector(".message-copy");
  if (copy) {
    copy.dataset.copyText = updated.content;
    copy.hidden = !updated.content;
  }
  updateVariantSwitcher(root, updated);
  // 两个版本长短不一，切换后视野会停在半空：最后一条就滚到底，中间的保证这条消息还在视野里
  if (index === getActiveConversation().messages.length - 1) {
    scrollToBottom();
  } else {
    // 长版本会把工具栏顶出视野，让箭头所在那行留在原地附近
    (root.querySelector(".message-tools") || root).scrollIntoView({ block: "nearest" });
  }
}

// 根据消息的 variants 状态显示/隐藏「‹ 2/3 ›」切换器并更新禁用态
function updateVariantSwitcher(root, message) {
  const box = root.querySelector(".message-variants");
  if (!box) return;
  const count = message?.variants?.length || 0;
  if (count < 2) {
    box.hidden = true;
    return;
  }
  const active = message.activeVariant ?? count - 1;
  box.hidden = false;
  box.querySelector(".message-variant-label").textContent = `${active + 1}/${count}`;
  box.querySelector('.message-variant-btn[data-dir="-1"]').disabled = active <= 0;
  box.querySelector('.message-variant-btn[data-dir="1"]').disabled = active >= count - 1;
}
