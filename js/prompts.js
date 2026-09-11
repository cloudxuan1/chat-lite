// 提示词库：多份系统提示词，选一份作为当前使用。
// ===== 提示词库：多份系统提示词，选一份作为当前使用 =====
function createPromptId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePromptName(value, fallback = "未命名") {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 40) || fallback;
}

function normalizePromptLibrary(value) {
  const source = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const items = (Array.isArray(source.items) ? source.items : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      let id = typeof item.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) ? item.id : "";
      if (!id || seen.has(id)) id = createPromptId();
      seen.add(id);
      return {
        id,
        name: normalizePromptName(item.name),
        content: typeof item.content === "string" ? item.content : "",
      };
    });
  if (!items.length) items.push({ id: createPromptId(), name: "默认", content: "" });
  const activeId = items.some((item) => item.id === source.activeId) ? source.activeId : items[0].id;
  return { activeId, items };
}

// 首次加载：没有提示词库时把旧的单份提示词迁成第一份「默认」
function loadPromptLibrary() {
  const stored = parseStoredJson(SYSTEM_PROMPTS_KEY, null);
  if (stored && typeof stored === "object" && Array.isArray(stored.items)) {
    return normalizePromptLibrary(stored);
  }
  const legacy = localStorage.getItem(SYSTEM_PROMPT_KEY) || "";
  return normalizePromptLibrary({ items: [{ name: "默认", content: legacy }] });
}

function clonePromptLibrary(library) {
  return JSON.parse(JSON.stringify(library));
}

function activePrompt(library) {
  return library.items.find((item) => item.id === library.activeId) || library.items[0];
}

// 文件夹绑定的提示词（提示词已被删就当没绑定）
function folderBoundPrompt(folder) {
  if (!folder?.promptId) return null;
  return promptLibrary.items.find((item) => item.id === folder.promptId) || null;
}
// 发消息时实际用的系统提示词：会话所在文件夹绑定了就用它，否则用设置里当前选中的
function effectiveSystemPrompt(conversation) {
  const bound = folderBoundPrompt(folderById(conversation?.folderId));
  return (bound ? bound.content : systemPrompt).trim();
}

function promptSummaryText(library) {
  const active = activePrompt(library);
  const length = active.content.trim().length;
  const parts = [active.name, length ? `${length.toLocaleString()} 字` : "未设置"];
  if (library.items.length > 1) parts.push(`共 ${library.items.length} 份`);
  return parts.join(" · ");
}

function loadBoundedInteger(key, min, max) {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function normalizeImageQuality(value) {
  return value === "original" ? "original" : "auto";
}

function createImageId() {
  if (typeof crypto?.randomUUID === "function") return `image-${crypto.randomUUID()}`;
  return `image-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function openImageDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("这个浏览器不支持本地图片存储"));
      return;
    }
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_DB_STORE)) {
        request.result.createObjectStore(IMAGE_DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开图片存储失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("图片存储失败"));
    transaction.onabort = () => reject(transaction.error || new Error("图片存储已取消"));
  });
}

async function putImageRecords(records) {
  if (!records.length) return;
  const db = await openImageDb();
  try {
    const transaction = db.transaction(IMAGE_DB_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(IMAGE_DB_STORE);
    records.forEach((record) => store.put(record));
    await done;
  } finally {
    db.close();
  }
}

async function getImageRecords(attachments) {
  if (!attachments.length) return [];
  const db = await openImageDb();
  try {
    const transaction = db.transaction(IMAGE_DB_STORE, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(IMAGE_DB_STORE);
    const results = await Promise.all(attachments.map((attachment) => new Promise((resolve) => {
      const request = store.get(attachment.id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    })));
    await done;
    return results;
  } finally {
    db.close();
  }
}

async function deleteImageRecords(attachments) {
  const ids = attachments.map((attachment) => attachment?.id).filter(Boolean);
  if (!ids.length) return;
  const db = await openImageDb();
  try {
    const transaction = db.transaction(IMAGE_DB_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(IMAGE_DB_STORE);
    ids.forEach((id) => store.delete(id));
    await done;
  } finally {
    db.close();
  }
}

async function listImageRecordIds() {
  const db = await openImageDb();
  try {
    const transaction = db.transaction(IMAGE_DB_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(IMAGE_DB_STORE).getAllKeys();
    const ids = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("读取图片索引失败"));
    });
    await done;
    return ids.filter((id) => typeof id === "string");
  } finally {
    db.close();
  }
}

async function cleanupOrphanedImageRecords() {
  const liveIds = new Set(
    conversationStore.conversations.flatMap((conversation) =>
      conversation.messages.flatMap((message) =>
        (message.attachments || []).map((attachment) => attachment.id)
      )
    )
  );
  const storedIds = await listImageRecordIds();
  const orphaned = storedIds
    .filter((id) => !liveIds.has(id))
    .map((id) => ({ id }));
  if (orphaned.length) await deleteImageRecords(orphaned);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

function normalizeDisplayName(value, fallback) {
  const normalized = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
  return normalized || fallback;
}

function normalizeExportFileName(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function safeExportFileBase(value) {
  return normalizeExportFileName(value)
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^[.\s]+/g, "")
    .replace(/[.\s]+$/g, "")
    .trim();
}

function defaultExportFileBase() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `chat-lite-${values.year}-${values.month}-${values.day}-${values.hour}-${values.minute}`;
}

function loadReasoningEffort() {
  const saved = localStorage.getItem(REASONING_EFFORT_KEY);
  if (EFFORT_OPTIONS.some((item) => item.value === saved)) return saved;
  return localStorage.getItem(LEGACY_REASONING_KEY) === "0" ? "off" : "medium";
}

function loadMaxCompletionTokens() {
  const saved = localStorage.getItem(MAX_COMPLETION_TOKENS_KEY);
  if (saved === null || saved === "") return null;
  const value = Number(saved);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function createSessionId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function createConversationId() {
  if (typeof crypto?.randomUUID === "function") return `conversation-${crypto.randomUUID()}`;
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function visibleCharacters(value) {
  const text = String(value || "");
  if (typeof Intl?.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(text), (item) => item.segment);
  }
  return Array.from(text);
}

function normalizeConversationTitle(value) {
  const normalized = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D]/gu, "")
    .replace(/^[\s"'“”‘’「」『』《》【】]+|[\s"'“”‘’「」『』《》【】]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = visibleCharacters(normalized)
    .slice(0, CONVERSATION_TITLE_MAX_CHARACTERS)
    .join("")
    .trim();
  return /[\p{L}\p{N}]/u.test(title) ? title : "";
}

function titleFromFirstMessage(messages) {
  const firstUser = messages.find((item) =>
    item.role === "user" && (item.content.trim() || item.attachments?.length)
  );
  return normalizeConversationTitle(firstUser?.content) ||
    (firstUser?.attachments?.length ? "图片对话" : "新对话");
}

function normalizeMessageAttachments(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const attachments = [];
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (
      !id ||
      seen.has(id) ||
      id.length > 160 ||
      !/^[A-Za-z0-9._:-]+$/.test(id)
    ) continue;
    const type = SUPPORTED_IMAGE_TYPES.has(item?.type) ? item.type : "";
    const size = Number.isSafeInteger(item?.size) && item.size > 0
      ? item.size
      : 0;
    if (!type || !size) continue;
    seen.add(id);
    attachments.push({
      id,
      name: String(item?.name || "图片").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || "图片",
      type,
      size,
    });
    if (attachments.length >= MAX_IMAGES_PER_MESSAGE) break;
  }
  return attachments;
}

function normalizeStoredMessages(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) =>
    (item?.role === "user" || item?.role === "assistant") &&
    typeof item.content === "string"
  ).map((item) => {
    const attachments = item.role === "user"
      ? normalizeMessageAttachments(item.attachments)
      : [];
    // 助手消息的 reroll 版本：variants 存每个版本的正文，activeVariant 指向当前展示的版本，
    // content 始终等于当前版本（老代码和导出、发请求都只读 content，天然兼容）
    const variants = item.role === "assistant" && Array.isArray(item.variants)
      ? item.variants.filter((entry) => typeof entry === "string")
      : [];
    const hasVariants = variants.length > 1;
    const activeVariant = hasVariants
      ? Math.min(
          Math.max(Number.isInteger(item.activeVariant) ? item.activeVariant : variants.length - 1, 0),
          variants.length - 1,
        )
      : 0;
    return {
      role: item.role,
      content: hasVariants ? variants[activeVariant] : item.content,
      ...(attachments.length ? { attachments } : {}),
      ...(hasVariants ? { variants, activeVariant } : {}),
    };
  });
}

function validStoredDate(value, fallback) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : fallback;
}

function createConversation({ messages = [], sessionId = "", createdAt = new Date().toISOString(), folderId = "" } = {}) {
  const safeMessages = normalizeStoredMessages(messages);
  const title = titleFromFirstMessage(safeMessages);
  return {
    id: createConversationId(),
    title,
    titleSource: title === "新对话" ? "default" : "fallback",
    messages: safeMessages,
    sessionId: sessionId && sessionId.length <= 256 ? sessionId : createSessionId(),
    createdAt,
    updatedAt: createdAt,
    ...(folderId ? { folderId } : {}),
  };
}
