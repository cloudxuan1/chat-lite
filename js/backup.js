// 备份 / 恢复（全部对话 + 图片，整包 JSON）。
// ===== 备份 / 恢复（全部对话 + 图片，整包 JSON）=====
function setBackupStatus(message) {
  const el = document.getElementById("backup-status");
  if (el) el.textContent = message || "";
}

function dataUrlToBlob(dataUrl) {
  const [head, b64 = ""] = String(dataUrl).split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function backupFileName() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `chat-lite-备份-${v.year}${v.month}${v.day}-${v.hour}${v.minute}.json`;
}

async function backupAllData(button) {
  if (button) button.disabled = true;
  setBackupStatus("正在备份…");
  try {
    const store = normalizeConversationStore(conversationStore);
    const ids = [];
    for (const conv of store.conversations)
      for (const m of conv.messages)
        for (const a of (m.attachments || []))
          if (a?.id) ids.push(a.id);
    const uniqueIds = [...new Set(ids)];
    const images = {};
    if (uniqueIds.length) {
      const records = await getImageRecords(uniqueIds.map((id) => ({ id })));
      for (const r of records) {
        if (r?.id && r.blob) {
          try {
            images[r.id] = { name: r.name || "", type: r.type || "", size: r.size || 0, data: await blobToDataUrl(r.blob) };
          } catch { /* 单张图片读失败，跳过，不阻断整体备份 */ }
        }
      }
    }
    const backup = {
      app: "chat-lite", type: "backup", version: 1, exportedAt: new Date().toISOString(),
      store, images,
      promptLibrary: normalizePromptLibrary(promptLibrary),
    };
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const imgCount = Object.keys(images).length;
    setBackupStatus(`已备份 ${store.conversations.length} 个对话${imgCount ? `、${imgCount} 张图片` : ""}、${backup.promptLibrary.items.length} 份提示词。文件已开始下载，请保存到「文件」或分享到别处。`);
  } catch (e) {
    setBackupStatus("备份失败：" + (e?.message || e));
  } finally {
    if (button) button.disabled = false;
  }
}

async function restoreFromBackup(file, button) {
  if (button) button.disabled = true;
  setBackupStatus("正在恢复…");
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.app !== "chat-lite" || !backup.store || !Array.isArray(backup.store.conversations)) {
      throw new Error("这不是 chat-lite 的备份文件");
    }
    // 图片先写回 IndexedDB
    const records = [];
    for (const [id, img] of Object.entries(backup.images || {})) {
      if (!img?.data) continue;
      try {
        const blob = dataUrlToBlob(img.data);
        records.push({ id, name: img.name || "", type: img.type || blob.type || "", size: img.size || blob.size || 0, blob, createdAt: new Date().toISOString() });
      } catch { /* 单张图片解码失败，跳过 */ }
    }
    if (records.length) {
      try { await putImageRecords(records); } catch { /* 图片存储失败不阻断文本恢复 */ }
    }
    // 合并会话：按 id 去重，只加备份里的新对话，不覆盖或删除现有对话
    const importedStore = normalizeConversationStore(backup.store);
    const draft = cloneConversationStore();
    // 文件夹也按 id 合并，只加新的；导入的会话保留 folderId
    const existingFolderIds = new Set((draft.folders || []).map((f) => f.id));
    for (const folder of importedStore.folders || []) {
      if (!existingFolderIds.has(folder.id)) { draft.folders = [...(draft.folders || []), folder]; existingFolderIds.add(folder.id); }
    }
    const existingIds = new Set(draft.conversations.map((c) => c.id));
    let added = 0;
    for (const conv of importedStore.conversations) {
      if (!existingIds.has(conv.id)) { draft.conversations.push(conv); existingIds.add(conv.id); added += 1; }
    }
    if (backup.store.activeId && draft.conversations.some((c) => c.id === backup.store.activeId)) {
      draft.activeId = backup.store.activeId;
    }
    const ok = persistConversationStore(draft, { keepInMemoryOnFailure: true });
    renderConversationList();
    renderActiveConversation();
    const addedPrompts = mergePromptLibraryFromBackup(backup.promptLibrary);
    setBackupStatus(`已恢复 ${added} 个对话${records.length ? `、${records.length} 张图片` : ""}${addedPrompts ? `、${addedPrompts} 份提示词` : ""}。${ok ? "" : "（本地存储偏紧，已尽量保存，建议删掉些旧对话再试）"}`);
  } catch (e) {
    setBackupStatus("恢复失败：" + (e?.message || e));
  } finally {
    if (button) button.disabled = false;
  }
}

// 从备份合并提示词：按 id 或「名称+内容完全相同」去重，只加新的，不覆盖、不删除、不改当前选中
function mergePromptLibraryFromBackup(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) return 0;
  const imported = normalizePromptLibrary(value);
  const sameAs = (a, b) => a.id === b.id || (a.name === b.name && a.content === b.content);
  const fresh = imported.items.filter((item) => !promptLibrary.items.some((existing) => sameAs(existing, item)));
  if (!fresh.length) return 0;
  promptLibrary = normalizePromptLibrary({
    activeId: promptLibrary.activeId,
    items: [...promptLibrary.items, ...fresh],
  });
  try {
    localStorage.setItem(SYSTEM_PROMPTS_KEY, JSON.stringify(promptLibrary));
  } catch { /* 存储偏紧时至少内存里已合并，保存设置时会再写一次 */ }
  // 恢复按钮在设置页里：设置草稿是打开时拷的一份，不同步的话「保存并返回」会把刚恢复的盖掉
  const wasClean = settingsState() === settingsSnapshot;
  const draftFresh = fresh.filter((item) => !draftPromptLibrary.items.some((existing) => sameAs(existing, item)));
  draftPromptLibrary.items.push(...draftFresh.map((item) => ({ ...item })));
  renderPromptList();
  updatePromptCount();
  if (wasClean) settingsSnapshot = settingsState();
  return fresh.length;
}
