// 侧栏会话列表的渲染：置顶、分组、文件夹折叠、移动选择器。
function announceConversation(message) {
  conversationLive.textContent = "";
  window.requestAnimationFrame(() => {
    conversationLive.textContent = message;
  });
}

function showAppStatus(message) {
  appStatus.textContent = message || "";
  appStatus.classList.toggle("is-visible", Boolean(message));
}

function conversationPreview(conversation) {
  const latest = conversation.messages.at(-1);
  if (!latest) return "";
  const text = latest.content.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (text) return text;
  const count = latest.attachments?.length || 0;
  return count ? `〔${count} 张图片〕` : "";
}

function formatConversationTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function sortedConversations() {
  // 置顶的排最前，其余按最近更新
  return [...conversationStore.conversations].sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}

function toggleConversationPinned(conversationId) {
  if (pending) {
    announceConversation("回复完成后再置顶。");
    return false;
  }
  const target = conversationById(conversationId);
  if (!target) return false;
  const draft = cloneConversationStore();
  const draftTarget = conversationById(conversationId, draft);
  if (draftTarget.pinned) delete draftTarget.pinned;
  else draftTarget.pinned = true;
  if (!persistConversationStore(draft)) return false;
  renderConversationList();
  if (folderDetailIsOpen() && folderById(folderDetailId)) renderFolderDetail();
  announceConversation(draftTarget.pinned ? `已置顶“${target.title}”。` : `“${target.title}”已取消置顶。`);
  return true;
}

function renderConversationList() {
  resetSwipeState();
  conversationList.replaceChildren();
  conversationNew.disabled = pending;
  conversationNewFolder.disabled = pending;
  conversationPendingNote.textContent = pending ? "回复完成后可切换会话" : "";

  // 分组：置顶文件夹（默认展开）→ 其他文件夹（默认折叠）→ 最近（未分类会话）
  const folders = conversationStore.folders || [];
  const byFolder = new Map(folders.map((folder) => [folder.id, []]));
  const loose = [];
  for (const conversation of sortedConversations()) {
    if (conversation.folderId && byFolder.has(conversation.folderId)) byFolder.get(conversation.folderId).push(conversation);
    else loose.push(conversation);
  }
  // 侧栏只放「文件夹」入口 + 置顶的文件夹 + 最近；没置顶的文件夹统一在文件夹页里管理
  const pinned = folders.filter((folder) => folder.pinned);
  conversationList.appendChild(buildFoldersEntry(folders.length));
  if (pinned.length) {
    conversationList.appendChild(buildSectionLabel("已置顶"));
    pinned.forEach((folder) => conversationList.appendChild(buildFolder(folder, byFolder.get(folder.id))));
  }
  // 有文件夹时「最近」标签一直显示，并带「新建」：当前会话在文件夹里时，头部的新建会跟进同一个文件夹，这里是建散会话的入口
  if (loose.length || folders.length) conversationList.appendChild(buildSectionLabel("最近", folders.length ? { action: "new-loose", label: "新建" } : null));
  loose.forEach((conversation) => conversationList.appendChild(wrapSwipeRow(buildConversationItem(conversation), conversation, "sidebar")));

  if (renamingConversationId) {
    window.requestAnimationFrame(() => {
      const renameInput = conversationList.querySelector(".conversation-rename-input");
      renameInput?.focus();
      renameInput?.select();
    });
  } else if (conversationMenuId || movePickerId || folderMenuId) {
    window.requestAnimationFrame(() => {
      const menu = conversationList.querySelector(".conversation-menu");
      menu?.scrollIntoView({ block: "nearest" });
      menu?.querySelector(".conversation-menu-button")?.focus();
    });
  }
}

function buildFoldersEntry(count) {
  const entry = document.createElement("button");
  entry.className = "conversation-folders-entry";
  entry.type = "button";
  entry.dataset.action = "open-folders";
  entry.disabled = pending;
  entry.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path></svg>
    <span>文件夹</span>
    <span class="conversation-folder-count"></span>
    <svg class="conversation-folders-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>`;
  entry.querySelector(".conversation-folder-count").textContent = count ? String(count) : "";
  return entry;
}

function buildSectionLabel(text, action = null) {
  const label = document.createElement("div");
  label.className = "conversation-section-label";
  label.textContent = text;
  if (action) {
    const button = document.createElement("button");
    button.className = "conversation-section-action";
    button.type = "button";
    button.dataset.action = action.action;
    button.disabled = pending;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span></span>';
    button.querySelector("span").textContent = action.label;
    button.setAttribute("aria-label", `${action.label}不在文件夹里的会话`);
    label.appendChild(button);
  }
  return label;
}

function buildFolder(folder, conversations) {
  const root = document.createElement("div");
  root.className = "conversation-folder";
  root.dataset.folderId = folder.id;
  if (folder.collapsed) root.classList.add("is-collapsed");
  if (conversations.some((item) => item.id === conversationStore.activeId)) root.classList.add("has-active");

  const row = document.createElement("div");
  row.className = "conversation-folder-row";

  const toggle = document.createElement("button");
  toggle.className = "conversation-folder-toggle";
  toggle.type = "button";
  toggle.dataset.action = "folder-toggle";
  toggle.dataset.folderId = folder.id;
  toggle.setAttribute("aria-expanded", String(!folder.collapsed));
  toggle.innerHTML = `
    <svg class="conversation-folder-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
    <span class="conversation-folder-name"></span>
    <span class="conversation-folder-count"></span>`;
  toggle.insertBefore(buildFolderTile(folder, "sm"), toggle.querySelector(".conversation-folder-name"));
  toggle.querySelector(".conversation-folder-name").textContent = folder.name;
  toggle.querySelector(".conversation-folder-count").textContent = String(conversations.length);

  const more = document.createElement("button");
  more.className = "conversation-more";
  more.type = "button";
  more.dataset.action = "folder-menu";
  more.dataset.folderId = folder.id;
  more.disabled = pending;
  more.setAttribute("aria-label", `文件夹${folder.name}的更多操作`);
  more.setAttribute("aria-expanded", String(folderMenuId === folder.id));
  more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r=".8"></circle><circle cx="12" cy="12" r=".8"></circle><circle cx="19" cy="12" r=".8"></circle></svg>';
  row.append(toggle, more);

  if (folderMenuId === folder.id) {
    const menu = document.createElement("div");
    menu.className = "conversation-menu conversation-folder-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", `文件夹${folder.name}的操作`);
    menu.innerHTML = `
      <button class="conversation-menu-button" type="button" data-action="folder-rename" data-folder-id="${folder.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"></path><path d="m13.8 7 3.2 3.2"></path></svg>
        <span>重命名</span>
      </button>
      <button class="conversation-menu-button" type="button" data-action="folder-pin" data-folder-id="${folder.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>
        <span>${folder.pinned ? "取消置顶" : "置顶"}</span>
      </button>
      <button class="conversation-menu-button danger" type="button" data-action="folder-delete" data-folder-id="${folder.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="m7 7 .7 13h8.6L17 7"></path></svg>
        <span>删除文件夹</span>
      </button>`;
    row.appendChild(menu);
  }
  root.appendChild(row);

  if (!folder.collapsed) {
    const items = document.createElement("div");
    items.className = "conversation-folder-items";
    if (conversations.length) {
      conversations.forEach((conversation) => items.appendChild(wrapSwipeRow(buildConversationItem(conversation), conversation, "sidebar")));
    } else {
      const empty = document.createElement("p");
      empty.className = "conversation-folder-empty";
      empty.textContent = "还没有会话。在会话的「…」里选「移到文件夹」。";
      items.appendChild(empty);
    }
    root.appendChild(items);
  }
  return root;
}

// 「移到文件夹」选择列表：现有文件夹（当前所在打 ✓）+ 新建文件夹 + 移出文件夹
function buildMovePicker(conversation) {
  const menu = document.createElement("div");
  menu.className = "conversation-menu conversation-move-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", `把${conversation.title}移到文件夹`);
  const folders = conversationStore.folders || [];
  const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>';
  const folderIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path></svg>';
  for (const folder of folders) {
    const button = document.createElement("button");
    const current = conversation.folderId === folder.id;
    button.className = `conversation-menu-button${current ? " is-current" : ""}`;
    button.type = "button";
    button.dataset.action = "move-to";
    button.dataset.conversationId = conversation.id;
    button.dataset.folderId = folder.id;
    button.innerHTML = `${current ? check : folderIcon}<span></span>`;
    button.querySelector("span").textContent = folder.name;
    menu.appendChild(button);
  }
  if (folders.length) {
    const divider = document.createElement("div");
    divider.className = "conversation-menu-divider";
    menu.appendChild(divider);
  }
  const create = document.createElement("button");
  create.className = "conversation-menu-button";
  create.type = "button";
  create.dataset.action = "move-new-folder";
  create.dataset.conversationId = conversation.id;
  create.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><span>新建文件夹…</span>';
  menu.appendChild(create);
  if (conversation.folderId) {
    const out = document.createElement("button");
    out.className = "conversation-menu-button";
    out.type = "button";
    out.dataset.action = "move-out";
    out.dataset.conversationId = conversation.id;
    out.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-8"></path><path d="m14 3 4 4-4 4"></path></svg><span>移出文件夹</span>';
    menu.appendChild(out);
  }
  return menu;
}

function buildConversationItem(conversation) {
    const item = document.createElement("div");
    item.className = "conversation-item";
    item.dataset.conversationId = conversation.id;
    if (conversation.id === conversationStore.activeId) item.classList.add("active");

    if (renamingConversationId === conversation.id) {
      const form = document.createElement("form");
      form.className = "conversation-rename-form";
      form.dataset.conversationId = conversation.id;

      const renameInput = document.createElement("input");
      renameInput.className = "conversation-rename-input";
      renameInput.type = "text";
      renameInput.maxLength = CONVERSATION_TITLE_MAX_CHARACTERS;
      renameInput.value = conversation.title;
      renameInput.setAttribute("aria-label", "会话标题");

      const save = document.createElement("button");
      save.className = "conversation-rename-action";
      save.type = "submit";
      save.setAttribute("aria-label", "保存标题");
      save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';

      const cancel = document.createElement("button");
      cancel.className = "conversation-rename-action";
      cancel.type = "button";
      cancel.dataset.action = "cancel-rename";
      cancel.setAttribute("aria-label", "取消重命名");
      cancel.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>';

      form.append(renameInput, save, cancel);
      item.appendChild(form);
      return item;
    }

    const select = document.createElement("button");
    select.className = "conversation-select";
    select.type = "button";
    select.dataset.action = "switch";
    select.dataset.conversationId = conversation.id;
    select.disabled = pending;
    if (conversation.id === conversationStore.activeId) {
      select.setAttribute("aria-current", "page");
    }

    const mark = document.createElement("span");
    mark.className = "conversation-current-mark";
    mark.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;
    title.title = conversation.title;
    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    if (conversation.pinned) {
      const pin = document.createElement("span");
      pin.className = "conversation-pin";
      pin.setAttribute("aria-label", "已置顶");
      pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>';
      meta.appendChild(pin);
    }
    const preview = conversationPreview(conversation);
    if (preview) {
      const previewEl = document.createElement("span");
      previewEl.className = "conversation-preview";
      previewEl.textContent = preview;
      meta.appendChild(previewEl);
    }
    const time = document.createElement("time");
    time.className = "conversation-time";
    time.dateTime = conversation.updatedAt;
    time.textContent = formatConversationTime(conversation.updatedAt);
    meta.appendChild(time);
    copy.append(title, meta);
    select.append(mark, copy);

    const more = document.createElement("button");
    more.className = "conversation-more";
    more.type = "button";
    more.dataset.action = "menu";
    more.dataset.conversationId = conversation.id;
    more.disabled = pending;
    more.setAttribute("aria-label", `${conversation.title}的更多操作`);
    more.setAttribute("aria-expanded", String(conversationMenuId === conversation.id || movePickerId === conversation.id));
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r=".8"></circle><circle cx="12" cy="12" r=".8"></circle><circle cx="19" cy="12" r=".8"></circle></svg>';
    item.append(select, more);

    if (movePickerId === conversation.id) {
      item.appendChild(buildMovePicker(conversation));
    } else if (conversationMenuId === conversation.id) {
      const menu = document.createElement("div");
      menu.className = "conversation-menu";
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", `${conversation.title}的操作`);
      menu.innerHTML = `
        <button class="conversation-menu-button" type="button" data-action="pin" data-conversation-id="${conversation.id}">
          ${conversation.pinned ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path><path d="m4 4 16 16"></path></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>'}
          <span>${conversation.pinned ? "取消置顶" : "置顶"}</span>
        </button>
        <button class="conversation-menu-button" type="button" data-action="rename" data-conversation-id="${conversation.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"></path><path d="m13.8 7 3.2 3.2"></path></svg>
          <span>重命名</span>
        </button>
        <button class="conversation-menu-button" type="button" data-action="move-open" data-conversation-id="${conversation.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path></svg>
          <span>移到文件夹</span>
        </button>
        <button class="conversation-menu-button danger" type="button" data-action="delete" data-conversation-id="${conversation.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="m7 7 .7 13h8.6L17 7"></path></svg>
          <span>删除</span>
        </button>
      `;
      item.appendChild(menu);
    }
    return item;
}
