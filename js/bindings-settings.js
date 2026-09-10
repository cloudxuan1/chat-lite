// 设置面板、全局点击/键盘、导出/备份/清空的事件绑定。
conversationList.addEventListener("submit", (event) => {
  const form = event.target.closest(".conversation-rename-form");
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const renameInput = form.querySelector(".conversation-rename-input");
  saveConversationTitle(form.dataset.conversationId, renameInput?.value || "");
});
desktopSidebarMedia.addEventListener("change", (event) => {
  sidebarOpen = event.matches
    ? loadSidebarPreference()
    : false;
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  renamingConversationId = null;
  renderConversationList();
  syncSidebarLayout();
});

modelQuick.addEventListener("click", openQuickPanel);
quickSettings.addEventListener("click", openSettings);
settingsOpen.addEventListener("click", openSettings);
settingsBack.addEventListener("click", () => closeSettings());
settingsSave.addEventListener("click", saveSettings);
settingsModelOpen.addEventListener("click", openModelScreen);
settingsPromptOpen.addEventListener("click", openPromptScreen);
settingsIdentityOpen.addEventListener("click", openIdentityScreen);
settingsWebOpen.addEventListener("click", openWebSettingsScreen);
settingsImageOpen.addEventListener("click", openImageSettingsScreen);
modelBack.addEventListener("click", closeModelScreen);
promptBack.addEventListener("click", closePromptScreen);
identityBack.addEventListener("click", closeIdentityScreen);
webSettingsBack.addEventListener("click", closeWebSettingsScreen);
imageSettingsBack.addEventListener("click", closeImageSettingsScreen);
modelSearch.addEventListener("input", renderModelList);
modelsRetry.addEventListener("click", () => void fetchModels({ force: true }));
modelScroll.addEventListener("scroll", updateModelScrollTop, { passive: true });
modelsScrollTop.addEventListener("click", scrollModelsToTop);
systemPromptInput.addEventListener("input", () => {
  activePrompt(draftPromptLibrary).content = systemPromptInput.value;
  autoGrowSystemPrompt();
  updatePromptCount();
  const count = promptList.querySelector(".prompt-row.active .prompt-row-count");
  if (count) {
    const length = systemPromptInput.value.trim().length;
    count.textContent = length ? `${length.toLocaleString()} 字` : "空";
  }
});
promptNameInput.addEventListener("input", () => {
  activePrompt(draftPromptLibrary).name = normalizePromptName(promptNameInput.value);
  const name = promptList.querySelector(".prompt-row.active .prompt-row-name");
  if (name) name.textContent = activePrompt(draftPromptLibrary).name;
  updatePromptCount();
});
promptList.addEventListener("click", (event) => {
  const row = event.target.closest(".prompt-row");
  if (row) selectPrompt(row.dataset.promptId);
});
promptAdd.addEventListener("click", addPrompt);
promptDelete.addEventListener("click", deleteActivePrompt);
userDisplayNameInput.addEventListener("input", updateIdentitySummary);
assistantDisplayNameInput.addEventListener("input", updateIdentitySummary);
exportFileNameInput.addEventListener("input", updateIdentitySummary);
swipeLeftSelect.addEventListener("change", () => { draftSwipeActions = normalizeSwipeActions({ ...draftSwipeActions, left: swipeLeftSelect.value }); updateSettingsDirty(); });
swipeRightSelect.addEventListener("change", () => { draftSwipeActions = normalizeSwipeActions({ ...draftSwipeActions, right: swipeRightSelect.value }); updateSettingsDirty(); });
maxCompletionTokensInput.addEventListener("input", () => {
  draftMaxCompletionTokens = maxCompletionTokensInput.value.trim();
  updateSettingsDirty();
});
maxCompletionTokensInput.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  stepMaxCompletionTokens(event.key === "ArrowUp" ? 1 : -1);
});
maxTokensDown.addEventListener("click", () => stepMaxCompletionTokens(-1));
maxTokensUp.addEventListener("click", () => stepMaxCompletionTokens(1));
webSearchMaxUsesInput.addEventListener("input", () => {
  draftWebSearchMaxUses = webSearchMaxUsesInput.value.trim();
  updateSettingsDirty();
});
webSearchMaxUsesInput.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  stepSearchSetting("uses", event.key === "ArrowUp" ? 1 : -1);
});
webSearchMaxResultsInput.addEventListener("input", () => {
  draftWebSearchMaxResults = webSearchMaxResultsInput.value.trim();
  updateSettingsDirty();
});
webSearchMaxResultsInput.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  stepSearchSetting("results", event.key === "ArrowUp" ? 1 : -1);
});
webSearchMaxUsesDown.addEventListener("click", () => stepSearchSetting("uses", -1));
webSearchMaxUsesUp.addEventListener("click", () => stepSearchSetting("uses", 1));
webSearchMaxResultsDown.addEventListener("click", () => stepSearchSetting("results", -1));
webSearchMaxResultsUp.addEventListener("click", () => stepSearchSetting("results", 1));
imageQualityOptions.addEventListener("click", (event) => {
  const button = event.target.closest(".quality-option");
  if (!button) return;
  draftImageQuality = normalizeImageQuality(button.dataset.quality);
  updateSettingsDirty();
});
webToggle.addEventListener("click", () => {
  webSearchEnabled = !webSearchEnabled;
  localStorage.setItem(WEB_KEY, webSearchEnabled ? "1" : "0");
  updateTopbar();
});
document.addEventListener("click", (event) => {
  if (!event.composedPath().includes(document.querySelector(".model-control"))) {
    closeQuickPanel();
  }
  // 快捷按钮在会话内容外；它刚打开的选择器不能被这次 click 当成外部点击关掉。
  if (event.target.closest(".swipe-action")) return;
  if (folderDetailMenuOpen && !event.target.closest("#folder-detail-more, .folder-detail-menu")) {
    folderDetailMenuOpen = false;
    renderFolderDetail();
  }
  if (folderPageMenuId && !event.target.closest(`.folder-page-row[data-folder-id="${folderPageMenuId}"]`)) {
    folderPageMenuId = null;
    if (folderScreenIsOpen()) renderFolderScreen();
  }
  if (folderDetailPromptOpen && !event.target.closest(".folder-page-prompt-row")) {
    folderDetailPromptOpen = false;
    if (folderDetailIsOpen()) renderFolderDetail();
  }
  if ((folderDetailConvMenuId || folderDetailPickerId) && !event.target.closest(".folder-page-item-row")) {
    folderDetailConvMenuId = null;
    folderDetailPickerId = null;
    renderFolderDetail();
  }
  if ((conversationMenuId || movePickerId || folderMenuId) &&
    !event.target.closest(".conversation-item, .conversation-folder-row")) {
    conversationMenuId = null;
    folderMenuId = null;
    movePickerId = null;
    renderConversationList();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (folderDetailScreen.classList.contains("is-open")) {
    if (folderDetailPromptOpen) {
      folderDetailPromptOpen = false;
      renderFolderDetail();
      folderDetailList.querySelector('[data-action="fd-prompt"]')?.focus();
    } else if (folderDetailConvMenuId || folderDetailPickerId) {
      const closedId = folderDetailConvMenuId || folderDetailPickerId;
      folderDetailConvMenuId = null;
      folderDetailPickerId = null;
      renderFolderDetail();
      folderDetailList.querySelector(`.conversation-more[data-conversation-id="${closedId}"]`)?.focus();
    } else if (folderDetailMenuOpen) {
      folderDetailMenuOpen = false;
      renderFolderDetail();
      folderDetailMore.focus();
    } else {
      closeFolderDetail({ instant: true });
    }
  } else if (folderScreen.classList.contains("is-open")) {
    if (folderPageMenuId) {
      const closedId = folderPageMenuId;
      folderPageMenuId = null;
      renderFolderScreen();
      folderPageList.querySelector(`.folder-page-open[data-folder-id="${closedId}"]`)?.focus();
    } else {
      closeFolderScreen({ instant: true });
    }
  } else if (modelScreen.classList.contains("is-open")) {
    closeModelScreen({ instant: true });
  } else if (promptScreen.classList.contains("is-open")) {
    closePromptScreen({ instant: true });
  } else if (identityScreen.classList.contains("is-open")) {
    closeIdentityScreen({ instant: true });
  } else if (webSettingsScreen.classList.contains("is-open")) {
    closeWebSettingsScreen({ instant: true });
  } else if (imageSettingsScreen.classList.contains("is-open")) {
    closeImageSettingsScreen({ instant: true });
  } else if (settingsScreen.classList.contains("is-open")) {
    closeSettings({ instant: true });
  } else if (renamingConversationId) {
    const cancelledConversationId = renamingConversationId;
    renamingConversationId = null;
    renderConversationList();
    focusConversationMore(cancelledConversationId);
  } else if (movePickerId || folderMenuId) {
    const closedPickerId = movePickerId;
    movePickerId = null;
    folderMenuId = null;
    renderConversationList();
    if (closedPickerId) focusConversationMore(closedPickerId);
  } else if (conversationMenuId) {
    const closedConversationId = conversationMenuId;
    conversationMenuId = null;
    folderMenuId = null;
    movePickerId = null;
    renderConversationList();
    focusConversationMore(closedConversationId);
  } else if (sidebarOpen) {
    closeConversationSidebar();
  } else if (quickPanel.classList.contains("is-open")) {
    closeQuickPanel();
    modelQuick.focus();
  }
});
exportChatBtn.addEventListener("click", downloadConversation);

const backupExportBtn = document.getElementById("backup-export");
const backupImportBtn = document.getElementById("backup-import");
const backupFileInput = document.getElementById("backup-file");
backupExportBtn.addEventListener("click", () => backupAllData(backupExportBtn));
backupImportBtn.addEventListener("click", () => backupFileInput.click());
backupFileInput.addEventListener("change", () => {
  const file = backupFileInput.files?.[0];
  backupFileInput.value = "";       // 允许连续选同一个文件
  if (file) restoreFromBackup(file, backupImportBtn);
});
clearChatBtn.addEventListener("click", () => {
  if (pending || !window.confirm("清空当前会话？其他会话不会受影响，此操作不能撤销。")) return;
  const draft = cloneConversationStore();
  const active = getActiveConversation(draft);
  const clearedAttachments = active.messages.flatMap((item) => item.attachments || []);
  active.messages = [];
  active.title = "新对话";
  active.titleSource = "default";
  active.sessionId = createSessionId();
  active.updatedAt = new Date().toISOString();
  if (!persistConversationStore(draft)) return;
  void deleteImageRecords(clearedAttachments).catch(() => {
    showAppStatus("会话已清空，但有些本机图片暂时没有清理。");
  });
  renderConversationList();
  renderActiveConversation();
  announceConversation("当前会话已清空。");
  input.focus();
});
