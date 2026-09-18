// 会话与文件夹的存档：归一化、读写 IndexedDB（打不开时退回 localStorage）、损坏备份、首次迁移。
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
      // 绑定的提示词 id（提示词库里的 id）、颜色/图标 key；没设不写键，保持老数据原样
      const promptId = typeof item.promptId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.promptId) ? item.promptId : "";
      const color = typeof item.color === "string" && folderColorByKey(item.color) ? item.color : "";
      const icon = typeof item.icon === "string" && folderIconByKey(item.icon) ? item.icon : "";
      return {
        id,
        name: normalizeFolderName(item.name),
        pinned: Boolean(item.pinned),
        collapsed: Boolean(item.collapsed),
        createdAt: validStoredDate(item.createdAt, now),
        ...(promptId ? { promptId } : {}),
        ...(color ? { color } : {}),
        ...(icon ? { icon } : {}),
      };
    });
}

// 每个文件夹按 id 固定分配一个色块颜色（GPT 项目那种带底色的方形图标）
// 文件夹的色块颜色：选过就用选的，没选过按 id 哈希固定取一个
function folderTileColor(folder) {
  const chosen = folderColorByKey(folder?.color);
  if (chosen) return chosen;
  let hash = 0;
  for (const char of String(folder?.id || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FOLDER_COLORS[hash % FOLDER_COLORS.length];
}
function folderTileIcon(folder) {
  return folderIconByKey(folder?.icon) || FOLDER_ICONS[0];
}

function buildFolderTile(folder, size = "md") {
  const { bg, fg } = folderTileColor(folder);
  const tile = document.createElement("span");
  tile.className = `folder-tile folder-tile-${size}`;
  tile.style.setProperty("--tile-bg", bg);
  tile.style.setProperty("--tile-fg", fg);
  tile.setAttribute("aria-hidden", "true");
  tile.innerHTML = `<svg viewBox="0 0 24 24"><path d="${folderTileIcon(folder).path}"></path></svg>`;
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

// 把一份原始存档（localStorage 里的字符串，或 IndexedDB 记录转成的字符串）解析成可用的 store，不碰存储。
// corruptRaw 非空 = 原数据有损，覆盖前得先原样留一份；partial = 损了一部分但会话还能救；needsWrite = 解析结果和原数据不一致，该写回。
function interpretConversationStoreRaw(stored) {
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (isRecoverableConversationStore(parsed)) {
        const normalized = normalizeConversationStore(parsed);
        const isCanonical = JSON.stringify(parsed) === JSON.stringify(normalized);
        return { store: normalized, corruptRaw: isCanonical ? "" : stored, partial: !isCanonical, needsWrite: !isCanonical };
      }
    } catch {
      // 继续走下方的旧版历史恢复。
    }
  }
  const migrated = normalizeConversationStore({
    version: 1,
    conversations: [createConversation({
      messages: loadLegacyMessages(),
      sessionId: loadLegacySessionId(),
    })],
  });
  migrated.activeId = migrated.conversations[0].id;
  return { store: migrated, corruptRaw: stored || "", partial: false, needsWrite: true };
}

function corruptConversationStoreWarning(partial, backedUp) {
  if (partial) {
    return backedUp
      ? "检测到部分损坏的会话索引；可恢复会话已保留，原数据已留作本机备份。"
      : "检测到部分损坏的会话索引；为避免覆盖原数据，本次更改暂不能保存。";
  }
  return backedUp
    ? "检测到损坏的会话索引；旧历史已恢复，原数据已留作本机备份。"
    : "检测到损坏的会话索引；为避免覆盖原数据，本次更改暂不能保存。";
}

// localStorage 老路径（2026-09 之前唯一的路径）：IndexedDB 打不开时的后备，行为原样保留。
function loadConversationStore() {
  const stored = localStorage.getItem(CONVERSATIONS_KEY);
  const result = interpretConversationStoreRaw(stored);
  let mayWrite = true;
  if (result.corruptRaw) {
    mayWrite = preserveCorruptConversationStore(result.corruptRaw);
    conversationStoreLoadWarning = corruptConversationStoreWarning(result.partial, mayWrite);
  }
  if (mayWrite && result.needsWrite) {
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(result.store));
    } catch {
      conversationStoreLoadWarning = result.partial
        ? "本地存储已满；刷新前请先下载或删除旧会话。"
        : "暂时无法保存会话索引；旧版历史仍保留在本机。";
    }
  }
  return result.store;
}

// ---- IndexedDB 主路径：会话存档存在和图片同一个库的 conversations 表里，一条记录 { id: "store", value: 整份存档 } ----
async function readConversationStoreRecord() {
  const db = await openImageDb();
  try {
    const transaction = db.transaction(CONVERSATIONS_DB_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(CONVERSATIONS_DB_STORE).get(CONVERSATION_STORE_RECORD_ID);
    const [record] = await Promise.all([new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("读取会话存档失败"));
    }), done]);
    return record && record.value !== undefined ? record.value : null;
  } finally {
    db.close();
  }
}

async function writeConversationStoreRecord(id, value) {
  const db = await openImageDb();
  try {
    const transaction = db.transaction(CONVERSATIONS_DB_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(CONVERSATIONS_DB_STORE).put({ id, value });
    await done;
  } finally {
    db.close();
  }
}

// 读 IndexedDB 里的存档；没有记录就从 localStorage 老存档（含更早的单会话历史）搬一次，老键留着不删当保险。
// 读取完成后才开始迁移；写失败只提示，下次保存会再试。
async function loadConversationStoreFromDb(record) {
  const migrating = record === null;
  const result = interpretConversationStoreRaw(migrating ? localStorage.getItem(CONVERSATIONS_KEY) : JSON.stringify(record));
  let mayWrite = true;
  if (result.corruptRaw) {
    mayWrite = await writeConversationStoreRecord(CONVERSATION_STORE_BACKUP_RECORD_ID, result.corruptRaw).then(() => true, () => false);
    conversationStoreReadOnly = !mayWrite;
    conversationStoreLoadWarning = corruptConversationStoreWarning(result.partial, mayWrite);
  }
  if (mayWrite && (migrating || result.needsWrite)) {
    try {
      await writeConversationStoreRecord(CONVERSATION_STORE_RECORD_ID, result.store);
    } catch {
      conversationStoreLoadWarning = "会话存档暂时没能写进本地数据库；改动先留在内存里，刷新前请先下载备份。";
    }
  }
  return result.store;
}

// 启动时由 init.js 调一次：读完存档才把 conversationStoreReady 置 true（之前聊天区是 inert 的）。
// IndexedDB 读不了时只显示旧备份，不允许继续写旧副本。
async function initializeConversationStore() {
  let timer;
  try {
    // 只对读取计时：超时的读取稍后返回也不能继续迁移、改状态或写盘。
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("IndexedDB 打开超时")), CONVERSATION_STORE_OPEN_TIMEOUT_MS);
    });
    const record = await Promise.race([readConversationStoreRecord(), timeout]);
    clearTimeout(timer);
    conversationStore = await loadConversationStoreFromDb(record);
    conversationStoreBackend = "indexeddb";
  } catch {
    // 老键可能是迁移当天的快照，不能当成最新存档继续写，也不能据此清图片。
    conversationStoreBackend = "local";
    conversationStoreReadOnly = true;
    conversationStore = interpretConversationStoreRaw(localStorage.getItem(CONVERSATIONS_KEY)).store;
    conversationStoreLoadWarning = "本地数据库暂时打不开；当前仅显示旧备份，可能不含最新聊天，暂不能保存。请关闭其它标签页后刷新重试。";
  } finally {
    clearTimeout(timer);
  }
  conversationStoreReady = true;
  if (conversationStorePendingWrite) drainConversationStoreWrites();
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
  if (!conversationStoreReady || conversationStoreReadOnly) {
    showAppStatus(conversationStoreLoadWarning || "存档尚未就绪或原数据没能备份；暂未保存这次更改。");
    return false;
  }
  const normalized = normalizeConversationStore(nextStore);
  if (conversationStoreBackend !== "local") {
    // IndexedDB 路径：内存先改、后台排队写盘（IndexedDB 写盘是异步的，做不到"先确认存好再改界面"），写失败弹提示不回滚
    conversationStore = normalized;
    scheduleConversationStoreWrite(normalized);
    return true;
  }
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

// 连着几次保存只写最后一份；存档还没读完时先排着，读完再写
function scheduleConversationStoreWrite(store) {
  conversationStorePendingWrite = store;
  if (conversationStoreReady && !conversationStoreWriting) return drainConversationStoreWrites();
  return null;
}

// 串行写盘：一次写一份，写完发现又有新的再写；写失败提示但不回滚（内存里是最新的，下次保存会再试）
function drainConversationStoreWrites() {
  conversationStoreWriting = true;
  return (async () => {
    while (conversationStorePendingWrite) {
      const next = conversationStorePendingWrite;
      conversationStorePendingWrite = null;
      try {
        await writeConversationStoreRecord(CONVERSATION_STORE_RECORD_ID, next);
        if (conversationStoreWriteFailed) {
          conversationStoreWriteFailed = false;
          showAppStatus("");
        }
      } catch {
        conversationStoreWriteFailed = true;
        showAppStatus("会话没能写进本地数据库，改动先留在内存里；请下载备份后刷新重试。");
      }
    }
    conversationStoreWriting = false;
  })();
}
