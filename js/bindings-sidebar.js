// 侧栏与会话列表的事件绑定。
conversationsOpen.addEventListener("click", toggleConversationSidebar);
conversationClose.addEventListener("click", () => closeConversationSidebar());
conversationScrim.addEventListener("click", () => closeConversationSidebar());
conversationSidebar.addEventListener("keydown", trapConversationSidebarFocus);
conversationNew.addEventListener("click", createNewConversation);
// 侧栏头部新建文件夹：建完打开文件夹页并展开它（未置顶的文件夹不在侧栏里显示，不然看不到建在哪）
conversationNewFolder.addEventListener("click", () => {
  const folder = createFolderInteractive();
  if (!folder) return;
  openFolderScreen();
  openFolderDetail(folder.id);
});
conversationList.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!(actionTarget instanceof HTMLElement) || !conversationList.contains(actionTarget)) return;
  const action = actionTarget.dataset.action;
  const conversationId = actionTarget.dataset.conversationId ||
    actionTarget.closest("[data-conversation-id]")?.dataset.conversationId;
  if (action === "switch" && conversationId) {
    switchConversation(conversationId);
  } else if (action === "menu" && conversationId) {
    const closingMenu = conversationMenuId === conversationId || movePickerId === conversationId;
    conversationMenuId = closingMenu ? null : conversationId;
    folderMenuId = null;
    movePickerId = null;
    renamingConversationId = null;
    renderConversationList();
    if (closingMenu) focusConversationMore(conversationId);
  } else if (action === "rename" && conversationId) {
    conversationMenuId = null;
    folderMenuId = null;
    movePickerId = null;
    renamingConversationId = conversationId;
    renderConversationList();
  } else if (action === "pin" && conversationId) {
    conversationMenuId = null;
    if (!toggleConversationPinned(conversationId)) renderConversationList();
    focusConversationMore(conversationId);
  } else if (action === "delete" && conversationId) {
    deleteConversation(conversationId);
  } else if (action === "cancel-rename") {
    const cancelledConversationId = renamingConversationId;
    renamingConversationId = null;
    renderConversationList();
    if (cancelledConversationId) focusConversationMore(cancelledConversationId);
  } else if (action === "open-folders") {
    openFolderScreen();
  } else if (action === "new-loose") {
    createNewConversation({ folderId: "" });
  } else if (action === "move-open" && conversationId) {
    movePickerId = conversationId;
    conversationMenuId = null;
    folderMenuId = null;
    renderConversationList();
  } else if (action === "move-to" && conversationId) {
    moveConversationToFolder(conversationId, actionTarget.dataset.folderId || "");
  } else if (action === "move-out" && conversationId) {
    moveConversationToFolder(conversationId, "");
  } else if (action === "move-new-folder" && conversationId) {
    const folder = createFolderInteractive();
    if (folder) moveConversationToFolder(conversationId, folder.id);
    else renderConversationList();
  } else {
    const folderId = actionTarget.dataset.folderId;
    if (!folderId) return;
    if (action === "folder-toggle") {
      toggleFolderCollapsed(folderId);
    } else if (action === "folder-menu") {
      const closing = folderMenuId === folderId;
      folderMenuId = closing ? null : folderId;
      conversationMenuId = null;
      movePickerId = null;
      renamingConversationId = null;
      renderConversationList();
    } else {
      handleFolderAction(action, folderId);
    }
  }
});
