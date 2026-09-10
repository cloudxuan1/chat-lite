// 文件夹页 / 文件夹详情页 及会话的新建、改名、删除。
function folderScreenIsOpen() {
  return folderScreen.classList.contains("is-open");
}

function persistFolderDraft(draft, message, { closeMenus = false } = {}) {
  if (!persistConversationStore(draft)) return false;
  // 先保存，再关闭并重绘；保存失败时保留选择菜单，便于重试。
  if (closeMenus) {
    conversationMenuId = null;
    folderMenuId = null;
    movePickerId = null;
  }
  renderConversationList();
  if (folderScreenIsOpen()) renderFolderScreen();
  if (folderDetailIsOpen() && folderById(folderDetailId)) renderFolderDetail();
  if (message) announceConversation(message);
  return true;
}

function openFolderScreen() {
  if (!desktopSidebarMedia.matches) closeConversationSidebar({ returnFocus: false });
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  folderPageMenuId = null;
  renderFolderScreen();
  folderScreen.classList.add("is-open");
  folderScreen.setAttribute("aria-hidden", "false");
  syncInteractionState();
  folderScroll.scrollTop = 0;
  folderBack.focus();
}

function closeFolderScreen({ instant = false } = {}) {
  if (folderDetailIsOpen()) closeFolderDetail({ instant: true });
  if (instant) skipPanelMotionOnce(folderScreen);
  folderScreen.classList.remove("is-open");
  folderScreen.setAttribute("aria-hidden", "true");
  folderMenuId = null;
  folderPageMenuId = null;
  syncInteractionState();
  renderConversationList();
  conversationsOpen.focus();
}

// 文件夹页：全部文件夹（置顶在前），每行是一个入口，点进去是详情页
function renderFolderScreen() {
  folderPageList.replaceChildren();
  const folders = conversationStore.folders || [];
  const ordered = [...folders.filter((f) => f.pinned), ...folders.filter((f) => !f.pinned)];
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "settings-card folder-page-card";
    empty.innerHTML = '<p class="folder-page-empty folder-page-empty-all">还没有文件夹。点右上角「+」新建一个，或在某条会话的「…」里选「移到文件夹」。</p>';
    folderPageList.appendChild(empty);
    return;
  }
  const card = document.createElement("div");
  card.className = "settings-card folder-page-card";
  const all = conversationStore.conversations;
  for (const folder of ordered) {
    const count = all.filter((item) => item.folderId === folder.id).length;
    const row = document.createElement("div");
    row.className = "folder-page-row";
    row.dataset.folderId = folder.id;
    row.dataset.pinned = folder.pinned ? "1" : "0";
    const open = document.createElement("button");
    open.className = "folder-page-open";
    open.type = "button";
    open.dataset.action = "fp-open";
    open.dataset.folderId = folder.id;
    open.disabled = pending;
    const copy = document.createElement("span");
    copy.className = "folder-page-copy";
    const name = document.createElement("span");
    name.className = "folder-page-name";
    name.textContent = folder.name;
    const meta = document.createElement("span");
    meta.className = "folder-page-meta";
    meta.textContent = count ? `${count} 个会话` : "空";
    copy.append(name, meta);
    open.append(buildFolderTile(folder, "md"), copy);
    if (folder.pinned) {
      const pin = document.createElement("span");
      pin.className = "folder-page-pin";
      pin.setAttribute("aria-label", "已置顶");
      pin.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>';
      open.appendChild(pin);
    }
    // 拖柄：按住拖动改变顺序（置顶组内、普通组内各自排）
    const handle = document.createElement("span");
    handle.className = "folder-page-handle";
    handle.setAttribute("role", "button");
    handle.setAttribute("aria-label", `拖动调整“${folder.name}”的顺序`);
    handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"></path></svg>';
    row.append(open, handle);
    if (folderPageMenuId === folder.id) {
      row.classList.add("has-menu");
      const menu = document.createElement("div");
      menu.className = "conversation-menu conversation-folder-menu folder-page-menu";
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", `文件夹${folder.name}的操作`);
      menu.innerHTML = `
        <button class="conversation-menu-button" type="button" data-action="fp-menu-new">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
          <span>在这个文件夹新建会话</span>
        </button>
        <button class="conversation-menu-button" type="button" data-action="folder-pin">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>
          <span>${folder.pinned ? "取消置顶" : "置顶"}</span>
        </button>
        <button class="conversation-menu-button" type="button" data-action="folder-rename">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"></path><path d="m13.8 7 3.2 3.2"></path></svg>
          <span>重命名</span>
        </button>
        <button class="conversation-menu-button danger" type="button" data-action="folder-delete">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="m7 7 .7 13h8.6L17 7"></path></svg>
          <span>删除文件夹</span>
        </button>`;
      row.appendChild(menu);
    }
    card.appendChild(row);
  }
  card.classList.toggle("has-menu", Boolean(folderPageMenuId));
  folderPageList.appendChild(card);
}

function folderDetailIsOpen() {
  return folderDetailScreen.classList.contains("is-open");
}

function openFolderDetail(folderId) {
  if (!folderById(folderId)) return;
  folderDetailId = folderId;
  folderDetailMenuOpen = false;
  folderDetailConvMenuId = null;
  folderDetailPickerId = null;
  folderDetailPromptOpen = false;
  folderPageMenuId = null;
  renderFolderDetail();
  folderDetailScreen.classList.add("is-open");
  folderDetailScreen.setAttribute("aria-hidden", "false");
  folderScreen.inert = true;
  syncInteractionState();
  folderDetailScroll.scrollTop = 0;
  folderDetailBack.focus();
}

function closeFolderDetail({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(folderDetailScreen);
  folderDetailScreen.classList.remove("is-open");
  folderDetailScreen.setAttribute("aria-hidden", "true");
  folderScreen.inert = false;
  folderDetailId = null;
  folderDetailMenuOpen = false;
  folderDetailConvMenuId = null;
  folderDetailPickerId = null;
  syncInteractionState();
  if (folderScreenIsOpen()) {
    renderFolderScreen();
    folderBack.focus();
  }
}

// 文件夹详情页（GPT 式）：头部小色块 + 名字 + 「…」菜单，正文只有列表
function renderFolderDetail() {
  const folder = folderById(folderDetailId);
  if (!folder) return;
  folderDetailTitle.replaceChildren(buildFolderTile(folder, "sm"));
  const titleText = document.createElement("span");
  titleText.className = "folder-detail-title-text";
  titleText.textContent = folder.name;
  folderDetailTitle.appendChild(titleText);
  folderDetailMore.disabled = pending;
  folderDetailMore.setAttribute("aria-expanded", String(folderDetailMenuOpen));

  folderDetailMenuHost.replaceChildren();
  if (folderDetailMenuOpen) {
    const menu = document.createElement("div");
    menu.className = "conversation-menu conversation-folder-menu folder-detail-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", `文件夹${folder.name}的操作`);
    menu.innerHTML = `
      <button class="conversation-menu-button" type="button" data-action="folder-pin">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>
        <span>${folder.pinned ? "取消置顶" : "置顶"}</span>
      </button>
      <button class="conversation-menu-button" type="button" data-action="folder-rename">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"></path><path d="m13.8 7 3.2 3.2"></path></svg>
        <span>重命名</span>
      </button>
      <button class="conversation-menu-button danger" type="button" data-action="folder-delete">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="m7 7 .7 13h8.6L17 7"></path></svg>
        <span>删除文件夹</span>
      </button>`;
    folderDetailMenuHost.appendChild(menu);
  }

  resetSwipeState();
  folderDetailList.replaceChildren();
  // 有菜单打开时放开卡片的 overflow，避免最后一行的菜单被卡片裁掉
  folderDetailList.classList.toggle("has-menu", Boolean(folderDetailConvMenuId || folderDetailPickerId || folderDetailPromptOpen));
  // 提示词行：这个文件夹里的会话用哪份系统提示词（默认跟随设置）
  const promptRow = document.createElement("div");
  promptRow.className = "folder-page-prompt-row";
  const promptButton = document.createElement("button");
  promptButton.className = "folder-page-item folder-page-prompt";
  promptButton.type = "button";
  promptButton.dataset.action = "fd-prompt";
  promptButton.disabled = pending;
  promptButton.setAttribute("aria-expanded", String(folderDetailPromptOpen));
  const bound = folderBoundPrompt(folder);
  const promptLabel = bound ? bound.name : folder.promptId ? "跟随设置（原绑定已删除）" : "跟随设置";
  promptButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"></path></svg><span class="folder-page-item-title">提示词</span><span class="folder-page-prompt-value"></span><svg class="folder-page-prompt-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
  promptButton.querySelector(".folder-page-prompt-value").textContent = promptLabel;
  promptRow.appendChild(promptButton);
  if (folderDetailPromptOpen) {
    const menu = document.createElement("div");
    menu.className = "conversation-menu conversation-move-menu folder-prompt-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", `选择“${folder.name}”使用的提示词`);
    const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>';
    const dot = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.2"></circle></svg>';
    const options = [{ id: "", name: `跟随设置（现在是“${activePrompt(promptLibrary).name}”）` }, ...promptLibrary.items];
    for (const option of options) {
      const current = option.id ? folder.promptId === option.id : !bound;
      const button = document.createElement("button");
      button.className = `conversation-menu-button${current ? " is-current" : ""}`;
      button.type = "button";
      button.dataset.action = "fd-prompt-set";
      button.dataset.promptId = option.id;
      button.innerHTML = `${current ? check : dot}<span></span>`;
      button.querySelector("span").textContent = option.name;
      menu.appendChild(button);
    }
    promptRow.appendChild(menu);
  }
  folderDetailList.appendChild(promptRow);
  const create = document.createElement("button");
  create.className = "folder-page-item folder-page-new";
  create.type = "button";
  create.dataset.action = "fp-new";
  create.disabled = pending;
  create.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span class="folder-page-item-title">在这个文件夹新建会话</span>';
  folderDetailList.appendChild(create);

  const conversations = sortedConversations().filter((item) => item.folderId === folder.id);
  for (const conversation of conversations) {
    const row = document.createElement("div");
    row.className = `folder-page-item-row${conversation.id === conversationStore.activeId ? " active" : ""}`;
    row.dataset.conversationId = conversation.id;
    const button = document.createElement("button");
    button.className = "folder-page-item";
    button.type = "button";
    button.dataset.action = "fp-switch";
    button.dataset.conversationId = conversation.id;
    button.disabled = pending;
    const title = document.createElement("span");
    title.className = "folder-page-item-title";
    title.textContent = conversation.title;
    if (conversation.pinned) {
      const pin = document.createElement("span");
      pin.className = "folder-page-item-pin";
      pin.setAttribute("aria-label", "已置顶");
      pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>';
      button.appendChild(pin);
    }
    const time = document.createElement("time");
    time.className = "folder-page-item-time";
    time.dateTime = conversation.updatedAt;
    time.textContent = formatConversationTime(conversation.updatedAt);
    button.prepend(title);
    button.appendChild(time);
    const more = document.createElement("button");
    more.className = "conversation-more";
    more.type = "button";
    more.dataset.action = "fd-menu";
    more.dataset.conversationId = conversation.id;
    more.disabled = pending;
    more.setAttribute("aria-label", `${conversation.title}的更多操作`);
    more.setAttribute("aria-expanded", String(folderDetailConvMenuId === conversation.id || folderDetailPickerId === conversation.id));
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r=".8"></circle><circle cx="12" cy="12" r=".8"></circle><circle cx="19" cy="12" r=".8"></circle></svg>';
    row.append(button, more);
    if (folderDetailPickerId === conversation.id) {
      row.appendChild(buildMovePicker(conversation));
    } else if (folderDetailConvMenuId === conversation.id) {
      const menu = document.createElement("div");
      menu.className = "conversation-menu";
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", `${conversation.title}的操作`);
      menu.innerHTML = `
        <button class="conversation-menu-button" type="button" data-action="fd-pin" data-conversation-id="${conversation.id}">
          ${conversation.pinned ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path><path d="m4 4 16 16"></path></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>'}
          <span>${conversation.pinned ? "取消置顶" : "置顶"}</span>
        </button>
        <button class="conversation-menu-button" type="button" data-action="fd-rename" data-conversation-id="${conversation.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"></path><path d="m13.8 7 3.2 3.2"></path></svg>
          <span>重命名</span>
        </button>
        <button class="conversation-menu-button" type="button" data-action="fd-move-open" data-conversation-id="${conversation.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path></svg>
          <span>移到文件夹</span>
        </button>
        <button class="conversation-menu-button danger" type="button" data-action="fd-delete" data-conversation-id="${conversation.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="m7 7 .7 13h8.6L17 7"></path></svg>
          <span>删除</span>
        </button>`;
      row.appendChild(menu);
    }
    folderDetailList.appendChild(wrapSwipeRow(row, conversation, "detail"));
  }
  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "folder-page-empty";
    empty.textContent = "还没有会话。点上面新建一个，或在别的会话的「…」里选「移到文件夹」。";
    folderDetailList.appendChild(empty);
  }
  if (folderDetailMenuOpen) {
    window.requestAnimationFrame(() => folderDetailMenuHost.querySelector(".conversation-menu-button")?.focus());
  } else if (folderDetailConvMenuId || folderDetailPickerId) {
    window.requestAnimationFrame(() => folderDetailList.querySelector(".conversation-menu .conversation-menu-button")?.focus());
  }
}

// 文件夹页拖动排序：按 DOM 顺序重排 folders 数组（置顶/普通各自成组，组内顺序即数组顺序）
function commitFolderOrderFromDom() {
  const ids = [...folderPageList.querySelectorAll(".folder-page-row")].map((row) => row.dataset.folderId);
  const draft = cloneConversationStore();
  const byId = new Map((draft.folders || []).map((folder) => [folder.id, folder]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const folder of draft.folders || []) {
    if (!ordered.includes(folder)) ordered.push(folder);
  }
  draft.folders = ordered;
  if (!persistFolderDraft(draft, "已调整文件夹顺序。")) {
    // DOM 已经换过顺序；保存失败时按未修改的 store 恢复，避免显示未保存的结果。
    renderFolderScreen();
  }
}

// 侧栏和文件夹页共用的文件夹菜单动作
function handleFolderAction(action, folderId) {
  if (action === "folder-rename") {
    folderMenuId = null;
    renameFolder(folderId);
    renderConversationList();
    if (folderScreenIsOpen()) renderFolderScreen();
    if (folderDetailIsOpen()) renderFolderDetail();
  } else if (action === "folder-pin") {
    folderMenuId = null;
    toggleFolderPinned(folderId);
  } else if (action === "folder-delete") {
    folderMenuId = null;
    deleteFolder(folderId);
    if (folderDetailIsOpen() && !folderById(folderDetailId)) closeFolderDetail();
    renderConversationList();
    if (folderScreenIsOpen()) renderFolderScreen();
  }
}

function createFolderInteractive() {
  if (pending) {
    announceConversation("回复完成后可新建文件夹。");
    return null;
  }
  const raw = window.prompt("文件夹名称", "");
  if (raw === null || !raw.trim()) return null;
  const folder = { id: createFolderId(), name: normalizeFolderName(raw), pinned: false, collapsed: false, createdAt: new Date().toISOString() };
  const draft = cloneConversationStore();
  draft.folders = [...(draft.folders || []), folder];
  return persistFolderDraft(draft, `已新建文件夹“${folder.name}”。`) ? folder : null;
}

// 给文件夹绑定/解绑提示词（promptId 为空 = 跟随设置）
function setFolderPrompt(folderId, promptId) {
  const folder = folderById(folderId);
  if (!folder || pending) return false;
  const prompt = promptId ? promptLibrary.items.find((item) => item.id === promptId) : null;
  if (promptId && !prompt) return false;
  const draft = cloneConversationStore();
  const target = folderById(folderId, draft);
  if (prompt) target.promptId = prompt.id;
  else delete target.promptId;
  return persistFolderDraft(draft, prompt ? `“${folder.name}”里的会话改用提示词“${prompt.name}”。` : `“${folder.name}”改为跟随设置里的提示词。`);
}

function renameFolder(folderId) {
  const folder = folderById(folderId);
  if (!folder || pending) return;
  const raw = window.prompt("文件夹名称", folder.name);
  if (raw === null || !raw.trim()) return;
  const draft = cloneConversationStore();
  folderById(folderId, draft).name = normalizeFolderName(raw);
  persistFolderDraft(draft);
}

function toggleFolderPinned(folderId) {
  if (pending) return;
  const draft = cloneConversationStore();
  const folder = folderById(folderId, draft);
  if (!folder) return;
  folder.pinned = !folder.pinned;
  folder.collapsed = !folder.pinned; // 置顶的展开着，取消置顶的折叠起来
  persistFolderDraft(draft, folder.pinned ? `已置顶“${folder.name}”。` : `已取消置顶“${folder.name}”。`);
}

function toggleFolderCollapsed(folderId) {
  const draft = cloneConversationStore();
  const folder = folderById(folderId, draft);
  if (!folder) return;
  folder.collapsed = !folder.collapsed;
  persistConversationStore(draft, { keepInMemoryOnFailure: true });
  renderConversationList();
}

// 删文件夹只是把里面的会话放回未分类，不删对话
function deleteFolder(folderId) {
  const folder = folderById(folderId);
  if (!folder || pending) return;
  const count = conversationStore.conversations.filter((item) => item.folderId === folderId).length;
  if (!window.confirm(`删除文件夹“${folder.name}”？里面的 ${count} 个会话会回到未分类，不会被删除。`)) return;
  const draft = cloneConversationStore();
  draft.folders = (draft.folders || []).filter((item) => item.id !== folderId);
  for (const conversation of draft.conversations) {
    if (conversation.folderId === folderId) delete conversation.folderId;
  }
  persistFolderDraft(draft, `已删除文件夹“${folder.name}”。`);
}

function moveConversationToFolder(conversationId, folderId) {
  if (pending) {
    announceConversation("回复完成后可移动会话。");
    return;
  }
  const draft = cloneConversationStore();
  const conversation = conversationById(conversationId, draft);
  if (!conversation) return;
  const folder = folderId ? folderById(folderId, draft) : null;
  if (folderId && !folder) return;
  if (folder) {
    conversation.folderId = folder.id;
    folder.collapsed = false; // 移进去就展开，让人看到它到哪了
  } else {
    delete conversation.folderId;
  }
  if (persistFolderDraft(draft, folder ? `已移到“${folder.name}”。` : "已移出文件夹。", { closeMenus: true })) {
    focusConversationMore(conversationId);
  }
}

function createNewConversation({ folderId } = {}) {
  if (pending) {
    announceConversation("回复完成后可新建会话。");
    return;
  }
  const active = getActiveConversation();
  const targetFolderId = folderId === undefined ? (active.folderId || "") : folderId;
  if (!active.messages.length && active.titleSource === "default") {
    // 当前已经是一张白纸，不再新建一张；如果指定了文件夹就把这张白纸搬过去
    if ((active.folderId || "") !== targetFolderId) {
      const draft = cloneConversationStore();
      const target = conversationById(active.id, draft);
      if (targetFolderId) target.folderId = targetFolderId;
      else delete target.folderId;
      if (!persistConversationStore(draft)) return;
      renderConversationList();
    }
    if (!desktopSidebarMedia.matches) closeConversationSidebar({ returnFocus: false });
    input.focus();
    return;
  }
  const draft = cloneConversationStore();
  const created = createConversation({ folderId: targetFolderId });
  draft.conversations.push(created);
  draft.activeId = created.id;
  if (!persistConversationStore(draft)) return;
  renderConversationList();
  renderActiveConversation();
  announceConversation("已新建会话。");
  if (!desktopSidebarMedia.matches) closeConversationSidebar({ returnFocus: false });
  input.focus();
}

function saveConversationTitle(conversationId, rawTitle) {
  if (pending) {
    announceConversation("回复完成后可重命名。");
    return;
  }
  const title = normalizeConversationTitle(rawTitle);
  if (!title) {
    announceConversation("标题不能为空。");
    return;
  }
  const draft = cloneConversationStore();
  const target = conversationById(conversationId, draft);
  if (!target) return;
  target.title = title;
  target.titleSource = "manual";
  if (!persistConversationStore(draft)) return;
  renamingConversationId = null;
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  renderConversationList();
  focusConversationMore(conversationId);
  announceConversation("标题已保存。");
}

function deleteConversation(conversationId) {
  if (pending) {
    announceConversation("回复完成后可删除会话。");
    return;
  }
  const target = conversationById(conversationId);
  if (!target || !window.confirm(`删除“${target.title}”？此操作不能撤销。`)) return;
  const deletedAttachments = target.messages.flatMap((item) => item.attachments || []);
  const deletingActiveConversation = conversationStore.activeId === conversationId;
  const orderedBeforeDelete = sortedConversations();
  const deletedIndex = orderedBeforeDelete.findIndex((item) => item.id === conversationId);
  const draft = cloneConversationStore();
  draft.conversations = draft.conversations.filter((item) => item.id !== conversationId);
  if (!draft.conversations.length) draft.conversations.push(createConversation());
  if (draft.activeId === conversationId) {
    draft.activeId = [...draft.conversations].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )[0].id;
  }
  const adjacentConversationId = (
    orderedBeforeDelete[deletedIndex + 1] ||
    orderedBeforeDelete[deletedIndex - 1]
  )?.id;
  if (!persistConversationStore(draft)) return;
  void deleteImageRecords(deletedAttachments).catch(() => {
    showAppStatus("会话已删除，但有些本机图片暂时没有清理。");
  });
  conversationMenuId = null;
  folderMenuId = null;
  movePickerId = null;
  renamingConversationId = null;
  renderConversationList();
  if (deletingActiveConversation) renderActiveConversation();
  focusConversationSelect(
    conversationById(adjacentConversationId)?.id || conversationStore.activeId
  );
  announceConversation("会话已删除。");
}
