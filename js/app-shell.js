// 应用壳：侧栏开合、焦点管理、pending 状态、会话切换。
function focusConversationMore(conversationId) {
  window.requestAnimationFrame(() => {
    const more = [...conversationList.querySelectorAll(".conversation-more")]
      .find((button) => button.dataset.conversationId === conversationId);
    // 移入未置顶文件夹后，会话不再显示在侧栏，焦点回到文件夹入口。
    (more || conversationList.querySelector('[data-action="open-folders"]'))?.focus();
  });
}

function focusConversationSelect(conversationId) {
  window.requestAnimationFrame(() => {
    [...conversationList.querySelectorAll(".conversation-select")]
      .find((button) => button.dataset.conversationId === conversationId)
      ?.focus();
  });
}

function loadSidebarPreference() {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSidebarPreference(isOpen) {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, isOpen ? "1" : "0");
  } catch {
    // 侧栏偏好是可选项，失败不应阻断打开/关闭。
  }
}

function updateConversationActionState() {
  const empty = getActiveConversation().messages.length === 0;
  clearChatBtn.disabled = pending || empty;
  exportChatBtn.disabled = pending || empty;
  sendBtn.disabled = pending ||
    imageProcessingJobs > 0 ||
    (!input.value.trim() && !pendingImages.length);
  updateAttachmentState();
}

function setPending(value) {
  pending = value;
  if (value) {
    conversationMenuId = null;
    folderMenuId = null;
    movePickerId = null;
    renamingConversationId = null;
  }
  updateConversationActionState();
  renderConversationList();
}

function renderActiveConversation() {
  messageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  messageObjectUrls = [];
  messagesEl.replaceChildren();
  const conversation = getActiveConversation();
  if (!conversation.messages.length) {
    messagesEl.appendChild(hintEl);
  } else {
    conversation.messages.forEach((item, index) =>
      addBubble(item.role, item.content, item.attachments || [], conversation.id, index)
    );
  }
  updateConversationActionState();
}

function anySettingsScreenOpen() {
  return settingsScreen.classList.contains("is-open") ||
    folderScreen.classList.contains("is-open") ||
    folderDetailScreen.classList.contains("is-open") ||
    modelScreen.classList.contains("is-open") ||
    promptScreen.classList.contains("is-open") ||
    identityScreen.classList.contains("is-open") ||
    webSettingsScreen.classList.contains("is-open") ||
    imageSettingsScreen.classList.contains("is-open");
}

function gateIsOpen() {
  return gate.style.display !== "none";
}

function syncInteractionState() {
  const settingsOpenNow = anySettingsScreenOpen();
  const mobileSidebarOpen = sidebarOpen && !desktopSidebarMedia.matches;
  const gateOpenNow = gateIsOpen();
  chatShell.inert = mobileSidebarOpen || gateOpenNow;
  topbarEl.inert = settingsOpenNow;
  messagesEl.inert = settingsOpenNow;
  composer.inert = settingsOpenNow;
  conversationSidebar.inert = !sidebarOpen || settingsOpenNow || gateOpenNow;
}

function syncSidebarLayout() {
  appShell.classList.toggle("sidebar-is-open", sidebarOpen);
  conversationsOpen.setAttribute("aria-expanded", String(sidebarOpen));
  conversationsOpen.setAttribute("aria-label", sidebarOpen ? "关闭会话列表" : "打开会话列表");
  conversationSidebar.setAttribute("aria-hidden", String(!sidebarOpen));
  conversationScrim.setAttribute("aria-hidden", "true");
  if (!desktopSidebarMedia.matches && sidebarOpen) {
    conversationSidebar.setAttribute("role", "dialog");
    conversationSidebar.setAttribute("aria-modal", "true");
    conversationSidebar.setAttribute("aria-labelledby", "conversation-sidebar-title");
  } else {
    conversationSidebar.setAttribute("role", "region");
    conversationSidebar.removeAttribute("aria-modal");
    conversationSidebar.removeAttribute("aria-labelledby");
  }
  syncInteractionState();
}

function openConversationSidebar(trigger = conversationsOpen) {
  closeQuickPanel();
  conversationSidebarTrigger = trigger;
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  renamingConversationId = null;
  sidebarOpen = true;
  if (desktopSidebarMedia.matches) saveSidebarPreference(true);
  renderConversationList();
  syncSidebarLayout();
  window.requestAnimationFrame(() => {
    const active = conversationList.querySelector('[aria-current="page"]');
    (active || conversationClose).focus();
  });
}

function closeConversationSidebar({ returnFocus = true } = {}) {
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  renamingConversationId = null;
  sidebarOpen = false;
  if (desktopSidebarMedia.matches) saveSidebarPreference(false);
  renderConversationList();
  syncSidebarLayout();
  const returnTarget = conversationSidebarTrigger || conversationsOpen;
  conversationSidebarTrigger = null;
  if (returnFocus && returnTarget instanceof HTMLElement) returnTarget.focus();
}

function toggleConversationSidebar() {
  if (sidebarOpen) closeConversationSidebar();
  else openConversationSidebar(conversationsOpen);
}

function trapConversationSidebarFocus(event) {
  if (
    event.key !== "Tab" ||
    !sidebarOpen ||
    desktopSidebarMedia.matches
  ) return;
  const focusable = [...conversationSidebar.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    conversationClose.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!conversationSidebar.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

function switchConversation(conversationId) {
  if (pending) {
    announceConversation("回复完成后可切换会话。");
    return;
  }
  if (conversationId === conversationStore.activeId) {
    if (!desktopSidebarMedia.matches) closeConversationSidebar();
    return;
  }
  if (!conversationById(conversationId)) return;
  const draft = cloneConversationStore();
  draft.activeId = conversationId;
  if (!persistConversationStore(draft)) return;
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  renamingConversationId = null;
  renderConversationList();
  renderActiveConversation();
  if (!desktopSidebarMedia.matches) closeConversationSidebar();
}
