// 会话与文件夹的存档：归一化、读写 localStorage、损坏备份。
// ===== 会话文件夹：存在会话 store 的 folders 里，会话用 folderId 指向所属文件夹（单层，不嵌套）=====
function createFolderId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeFolderName(value, fallback = "未命名文件夹") {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 40) || fallback;
}

function normalizeFolders(items, now) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      let id = typeof item.id === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(item.id) ? item.id : "";
      if (!id || seen.has(id)) id = createFolderId();
      seen.add(id);
      // 绑定的提示词 id（提示词库里的 id）；没绑定不写键，保持老数据原样
      const promptId = typeof item.promptId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.promptId) ? item.promptId : "";
      return {
        id,
        name: normalizeFolderName(item.name),
        pinned: Boolean(item.pinned),
        collapsed: Boolean(item.collapsed),
        createdAt: validStoredDate(item.createdAt, now),
        ...(promptId ? { promptId } : {}),
      };
    });
}

// 每个文件夹按 id 固定分配一个色块颜色（GPT 项目那种带底色的方形图标）
const FOLDER_TILE_COLORS = [
  ["rgba(217,119,87,.16)", "#c2410c"],
  ["rgba(245,158,11,.18)", "#b45309"],
  ["rgba(34,197,94,.16)", "#15803d"],
  ["rgba(20,184,166,.16)", "#0f766e"],
  ["rgba(59,130,246,.16)", "#1d4ed8"],
  ["rgba(139,92,246,.16)", "#6d28d9"],
  ["rgba(236,72,153,.16)", "#be185d"],
  ["rgba(100,116,139,.18)", "#334155"],
];

function folderTileColor(folder) {
  let hash = 0;
  for (const char of String(folder?.id || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FOLDER_TILE_COLORS[hash % FOLDER_TILE_COLORS.length];
}

function buildFolderTile(folder, size = "md") {
  const [bg, fg] = folderTileColor(folder);
  const tile = document.createElement("span");
  tile.className = `folder-tile folder-tile-${size}`;
  tile.style.setProperty("--tile-bg", bg);
  tile.style.setProperty("--tile-fg", fg);
  tile.setAttribute("aria-hidden", "true");
  tile.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path></svg>';
  return tile;
}

function folderById(folderId, store = conversationStore) {
  return (store.folders || []).find((item) => item.id === folderId) || null;
}

function isRecoverableConversationStore(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.version === 1 &&
    Array.isArray(value.conversations) &&
    value.conversations.some((item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Array.isArray(item.messages)
    )
  );
}

function preserveCorruptConversationStore(rawValue) {
  if (!rawValue) return true;
  conversationStoreRecoveryRaw = rawValue;
  try {
    if (localStorage.getItem(CORRUPT_CONVERSATIONS_BACKUP_KEY) !== rawValue) {
      localStorage.setItem(CORRUPT_CONVERSATIONS_BACKUP_KEY, rawValue);
    }
    return localStorage.getItem(CORRUPT_CONVERSATIONS_BACKUP_KEY) === rawValue;
  } catch {
    return false;
  }
}

function normalizeConversationStore(value) {
  const source = value && typeof value === "object" ? value : {};
  const seenIds = new Set();
  const seenSessions = new Set();
  const now = new Date().toISOString();
  const titleSources = new Set(["default", "fallback", "deepseek", "manual"]);
  const conversations = [];
  const folders = normalizeFolders(source.folders, now);
  const folderIds = new Set(folders.map((item) => item.id));

  for (const item of Array.isArray(source.conversations) ? source.conversations : []) {
    if (!item || typeof item !== "object" || !Array.isArray(item.messages)) continue;
    const messages = normalizeStoredMessages(item?.messages);
    let id = typeof item?.id === "string" &&
      item.id.trim().length <= 160 &&
      /^[A-Za-z0-9._:-]+$/.test(item.id.trim())
      ? item.id.trim()
      : "";
    if (!id || seenIds.has(id)) id = createConversationId();
    seenIds.add(id);

    let sessionId = typeof item?.sessionId === "string" && item.sessionId.trim().length <= 256
      ? item.sessionId.trim()
      : "";
    if (!sessionId || seenSessions.has(sessionId)) sessionId = createSessionId();
    seenSessions.add(sessionId);

    const createdAt = validStoredDate(item?.createdAt, now);
    const updatedAt = validStoredDate(item?.updatedAt, createdAt);
    const fallbackTitle = titleFromFirstMessage(messages);
    const title = normalizeConversationTitle(item?.title) || fallbackTitle;
    const titleSource = titleSources.has(item?.titleSource)
      ? item.titleSource
      : title === "新对话" ? "default" : "fallback";

    // 所属文件夹不存在就当未分类；没有文件夹时不写这个键，保持老数据原样（加载时有"是否原样"校验）
    const folderId = typeof item?.folderId === "string" && folderIds.has(item.folderId) ? item.folderId : "";

    conversations.push({
      id,
      title,
      titleSource,
      messages,
      sessionId,
      createdAt,
      updatedAt,
      ...(folderId ? { folderId } : {}),
      ...(item?.pinned === true ? { pinned: true } : {}),
    });
  }

  if (!conversations.length) conversations.push(createConversation());
  const activeId = conversations.some((item) => item.id === source.activeId)
    ? source.activeId
    : conversations[0].id;
  return { version: 1, activeId, ...(folders.length ? { folders } : {}), conversations };
}

function loadLegacyMessages() {
  try {
    return normalizeStoredMessages(JSON.parse(localStorage.getItem(LEGACY_CHAT_KEY) || "[]"));
  } catch {
    return [];
  }
}

function loadLegacySessionId() {
  const saved = localStorage.getItem(LEGACY_SESSION_KEY);
  return saved && saved.length <= 256 ? saved : createSessionId();
}

function loadConversationStore() {
  const stored = localStorage.getItem(CONVERSATIONS_KEY);
  let mayReplaceStoredValue = !stored;
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (isRecoverableConversationStore(parsed)) {
        const normalized = normalizeConversationStore(parsed);
        const isCanonical = JSON.stringify(parsed) === JSON.stringify(normalized);
        const mayReplaceNormalizedValue = isCanonical ||
          preserveCorruptConversationStore(stored);
        if (!isCanonical) {
          conversationStoreLoadWarning = mayReplaceNormalizedValue
            ? "检测到部分损坏的会话索引；可恢复会话已保留，原数据已留作本机备份。"
            : "检测到部分损坏的会话索引；为避免覆盖原数据，本次更改暂不能保存。";
        }
        if (mayReplaceNormalizedValue) {
          try {
            localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(normalized));
          } catch {
            conversationStoreLoadWarning = "本地存储已满；刷新前请先下载或删除旧会话。";
          }
        }
        return normalized;
      }
    } catch {
      // 继续走下方的旧版历史恢复。
    }
    mayReplaceStoredValue = preserveCorruptConversationStore(stored);
    conversationStoreLoadWarning = mayReplaceStoredValue
      ? "检测到损坏的会话索引；旧历史已恢复，原数据已留作本机备份。"
      : "检测到损坏的会话索引；为避免覆盖原数据，本次更改暂不能保存。";
  }

  const migrated = normalizeConversationStore({
    version: 1,
    conversations: [createConversation({
      messages: loadLegacyMessages(),
      sessionId: loadLegacySessionId(),
    })],
  });
  migrated.activeId = migrated.conversations[0].id;
  if (mayReplaceStoredValue) {
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(migrated));
    } catch {
      conversationStoreLoadWarning = "暂时无法保存会话索引；旧版历史仍保留在本机。";
    }
  }
  return migrated;
}

function cloneConversationStore() {
  return JSON.parse(JSON.stringify(conversationStore));
}

function getActiveConversation(store = conversationStore) {
  return store.conversations.find((item) => item.id === store.activeId) || store.conversations[0];
}

function conversationById(conversationId, store = conversationStore) {
  return store.conversations.find((item) => item.id === conversationId) || null;
}

function persistConversationStore(nextStore, { keepInMemoryOnFailure = false } = {}) {
  const normalized = normalizeConversationStore(nextStore);
  if (
    conversationStoreRecoveryRaw &&
    !preserveCorruptConversationStore(conversationStoreRecoveryRaw)
  ) {
    showAppStatus("本地存储空间不足，无法备份损坏数据；为避免覆盖，暂未保存这次更改。");
    return false;
  }
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(normalized));
    conversationStore = normalized;
    conversationStoreRecoveryRaw = "";
    showAppStatus("");
    return true;
  } catch {
    if (keepInMemoryOnFailure) conversationStore = normalized;
    showAppStatus("本地存储已满，请先下载或删除旧会话。");
    return false;
  }
}
