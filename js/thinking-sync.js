// 思考彩蛋词库云同步：词库存在 ember（经 Worker 的 thinking-words-get / -save 转发），手机电脑共用，Claude 也能用 MCP 改。
// 本机 localStorage 仍是离线缓存，所有界面照旧读本机；这里只负责「拉下来写回本机」和「本机改完推上去」。
// 规矩：云端每次写入版本 +1，上传必须带「我基于哪个版本改的」；对不上 = 另一端改过 → 冲突，弹给轩选，选之前本机修改原样保留。
// 第一次在这台设备同步：云端空 → 把本机词库搬上去；云端已有 → 把本机独有的自定义系列并进去（同 id 必须内容也相同），
// 内置系列两边改得不一样才算冲突。任何情况下都不用空库覆盖旧内容。

// 本机词库 → 云端文档（内置系列存当前生效的样子，原版留在 THINKING_SERIES 里当恢复默认的来源）
function thinkingLibraryDoc() {
  return {
    settings: { egg: thinkingEggEnabled, translate: thinkingTranslate, marauder: thinkingMarauder },
    series: thinkingAllSeries().map((s) => ({
      id: s.id, name: s.name, builtin: !s.custom, enabled: !thinkingSeriesOff.has(s.id),
      words: s.words.map((w) => ({ en: w.en, zh: w.zh || "" })),
    })),
  };
}

function thinkingSameWords(a, b) {
  return JSON.stringify((a || []).map((w) => [w.en, w.zh || ""])) === JSON.stringify((b || []).map((w) => [w.en, w.zh || ""]));
}

// 云端文档 → 本机各个键（内置系列只记和原版不一样的部分，跟设置页的存法一致）
function thinkingLocalFromDoc(doc) {
  const builtin = new Map(THINKING_SERIES.map((s) => [s.id, s]));
  const overrides = {};
  const custom = [];
  const off = new Set();
  for (const s of doc.series || []) {
    if (!s.enabled) off.add(s.id);
    const original = builtin.get(s.id);
    if (!original) {
      custom.push({ id: s.id, name: s.name, words: normalizeThinkingWords(s.words) });
      continue;
    }
    const words = normalizeThinkingWords(s.words);
    const o = {};
    if (s.name !== original.name) o.name = s.name;
    if (!thinkingSameWords(words, original.words.map(([en, zh]) => ({ en, zh })))) o.words = words;
    if (Object.keys(o).length) overrides[s.id] = o;
  }
  const settings = doc.settings || {};
  return {
    egg: settings.egg !== false, translate: settings.translate !== false, marauder: settings.marauder !== false,
    off, custom, overrides,
  };
}

function thinkingSyncedVersion() {
  const raw = localStorage.getItem(THINKING_SYNC_VERSION_KEY);
  return raw === null ? null : Number(raw);
}

// 把云端词库写回本机；本机没写成功就不认这个版本，下次再来
function applyThinkingLibraryDoc(doc, version, dirty = false) {
  const next = thinkingLocalFromDoc(doc);
  const ok = persistThinkingEntries([
    [THINKING_EGG_KEY, next.egg ? "1" : "0"],
    [THINKING_TRANSLATE_KEY, next.translate ? "1" : "0"],
    [THINKING_MARAUDER_KEY, next.marauder ? "1" : "0"],
    [THINKING_SERIES_OFF_KEY, JSON.stringify([...next.off])],
    [THINKING_CUSTOM_KEY, JSON.stringify(next.custom)],
    [THINKING_OVERRIDES_KEY, JSON.stringify(next.overrides)],
    [THINKING_SYNC_VERSION_KEY, String(version)],
    [THINKING_SYNC_DIRTY_KEY, dirty ? "1" : "0"],
  ]);
  if (!ok) return false;
  thinkingEggEnabled = next.egg;
  thinkingTranslate = next.translate;
  thinkingMarauder = next.marauder;
  thinkingSeriesOff = next.off;
  thinkingCustomSeries = next.custom;
  thinkingSeriesOverrides = next.overrides;
  thinkingSyncApplying = true;
  try { notifyThinkingSettingsChanged(); } finally { thinkingSyncApplying = false; }
  if (thinkingSettingsScreen.classList.contains("is-open")) renderThinkingSettings();
  else updateThinkingSummary();
  // 系列详情页开着也要换成新内容：不然返回时会把输入框里的旧词再存一遍、盖掉刚同步下来的。
  // 不会打断打字——一打字就有「没上传的修改」，云端新版只会进冲突，走不到这里。
  if (thinkingSeriesScreen.classList.contains("is-open")) {
    if (currentThinkingSeries()) renderThinkingSeriesScreen();
    else closeThinkingSeriesScreen({ instant: true });
  }
  return true;
}

// 这台设备第一次同步、云端已经有词库：本机独有的自定义系列并进去；内置系列两边都改过且不一样 → 冲突
function mergeThinkingFirstSync(cloud) {
  const local = thinkingLibraryDoc();
  const merged = JSON.parse(JSON.stringify(cloud));
  const cloudById = new Map(merged.series.map((s) => [s.id, s]));
  let added = 0;
  // 默认开关都是 true；本机明确关掉的项不能在搬家时悄悄打开。
  let conflict = Object.entries(local.settings).some(([key, value]) => value === false && cloud.settings?.[key] !== false);
  for (const s of local.series) {
    const theirs = cloudById.get(s.id);
    if (!s.enabled && theirs?.enabled) conflict = true;
    if (s.builtin) {
      const edited = Boolean(thinkingSeriesOverrides[s.id]);
      if (edited && (!theirs || theirs.name !== s.name || !thinkingSameWords(theirs.words, s.words))) conflict = true;
      continue;
    }
    if (theirs) {
      if (theirs.builtin || theirs.name !== s.name || theirs.enabled !== s.enabled || !thinkingSameWords(theirs.words, s.words)) conflict = true;
      continue;
    }
    const twin = merged.series.find((c) => !c.builtin && c.name === s.name && thinkingSameWords(c.words, s.words));
    if (twin) {
      if (twin.enabled !== s.enabled) conflict = true;
      continue;
    }
    merged.series.push(s);
    added += 1;
  }
  return { merged, added, conflict };
}

async function thinkingSyncRequest(action, extra = {}) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, password: accessPw, ...extra }),
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}

// 关掉再打开也算新一轮同步；旧响应只释放锁，不得覆盖新一轮的本机词库。
async function thinkingSyncExchange(action, extra = {}) {
  const epoch = thinkingSyncEpoch;
  thinkingSyncBusy = true;
  try {
    const result = await thinkingSyncRequest(action, extra);
    return thinkingSyncEnabled && epoch === thinkingSyncEpoch ? result : null;
  } catch {
    if (thinkingSyncEnabled && epoch === thinkingSyncEpoch) setThinkingSyncState("error", "连不上云端");
    return null;
  } finally {
    thinkingSyncBusy = false;
    if (thinkingSyncEnabled && epoch !== thinkingSyncEpoch) void pullThinkingLibrary();
  }
}

function setThinkingSyncState(state, message = "") {
  thinkingSyncState = state;
  thinkingSyncMessage = message;
  renderThinkingSync();
}

function thinkingSyncFailure(result) {
  if (result.status === 503) return setThinkingSyncState("unavailable");
  if (result.status === 401) return setThinkingSyncState("error", "访问密码不对");
  const detail = typeof result.data?.detail === "string" ? result.data.detail : "";
  setThinkingSyncState("error", result.status === 422 && detail ? `云端不收：${detail}` : "连不上云端");
}

async function pushThinkingLibrary(baseVersion = thinkingSyncedVersion() ?? 0, doc = thinkingLibraryDoc()) {
  clearTimeout(thinkingSyncTimer);
  if (!thinkingSyncEnabled || !accessPw || thinkingSyncBusy || thinkingSyncState === "conflict") return;
  setThinkingSyncState("syncing");
  const result = await thinkingSyncExchange("thinking-words-save", { baseVersion, data: doc });
  if (!result) return;
  if (result.status === 200 && result.data) {
    // 上传途中又改了词：dirty 继续留着，按新改动再排一次
    const changed = JSON.stringify(doc) !== JSON.stringify(thinkingLibraryDoc());
    if (!persistThinkingEntries([
      [THINKING_SYNC_VERSION_KEY, String(result.data.version)],
      [THINKING_SYNC_DIRTY_KEY, changed ? "1" : "0"],
    ])) return setThinkingSyncState("error", "本机存不下同步记录");
    if (changed) scheduleThinkingPush();
    return setThinkingSyncState("synced");
  }
  if (result.status === 409 && result.data?.current) {
    thinkingSyncConflict = result.data.current;
    return setThinkingSyncState("conflict");
  }
  thinkingSyncFailure(result);
}

async function pullThinkingLibrary() {
  if (!thinkingSyncEnabled || !accessPw || thinkingSyncBusy || thinkingSyncState === "conflict") return;
  thinkingSyncLastPull = Date.now();
  setThinkingSyncState("syncing");
  const result = await thinkingSyncExchange("thinking-words-get");
  if (!result) return;
  if (result.status !== 200 || !result.data) return thinkingSyncFailure(result);
  // 输入保存失败时仍留在详情页，不让云端重画把尚未落盘的草稿擦掉。
  if (thinkingSeriesScreen.classList.contains("is-open") && !saveThinkingSeriesScreen()) {
    return setThinkingSyncState("error", "本机编辑尚未保存");
  }
  const { version, data } = result.data;
  const synced = thinkingSyncedVersion();
  const dirty = localStorage.getItem(THINKING_SYNC_DIRTY_KEY) === "1";

  if (!data) return pushThinkingLibrary(0); // 云端空：把本机词库搬上去（首次同步）
  if (synced === null) {
    const { merged, added, conflict } = mergeThinkingFirstSync(data);
    if (conflict) {
      thinkingSyncConflict = { version, data };
      return setThinkingSyncState("conflict");
    }
    if (!applyThinkingLibraryDoc(merged, version, added > 0)) return setThinkingSyncState("error", "本机存不下");
    if (added) {
      showAppStatus(`已合并这台设备的 ${added} 个自定义系列，正在上传。`);
      return pushThinkingLibrary(version, merged);
    }
    return setThinkingSyncState("synced");
  }
  if (version === synced) {
    if (dirty) return pushThinkingLibrary(version);
    return setThinkingSyncState("synced");
  }
  if (dirty) {
    thinkingSyncConflict = { version, data };
    return setThinkingSyncState("conflict");
  }
  if (!applyThinkingLibraryDoc(data, version)) return setThinkingSyncState("error", "本机存不下");
  setThinkingSyncState("synced");
}

function scheduleThinkingPush() {
  clearTimeout(thinkingSyncTimer);
  if (!thinkingSyncEnabled) return;
  thinkingSyncTimer = setTimeout(() => {
    // 首次同步还没做完就改了词：先走拉取（会合并），别拿版本 0 硬推
    if (thinkingSyncedVersion() === null) void pullThinkingLibrary();
    else void pushThinkingLibrary();
  }, 800);
}

function resolveThinkingConflict(useCloud) {
  const cloud = thinkingSyncConflict;
  if (!cloud) return;
  clearTimeout(thinkingSyncTimer);
  thinkingSyncConflict = null;
  thinkingSyncState = "idle";
  if (useCloud) {
    if (applyThinkingLibraryDoc(cloud.data, cloud.version)) setThinkingSyncState("synced");
    else setThinkingSyncState("error", "本机存不下");
  } else {
    void pushThinkingLibrary(cloud.version);
  }
}

function renderThinkingSync() {
  setThinkingSwitch(thinkingSyncToggle, thinkingSyncEnabled);
  const labels = {
    off: "只用这台设备上的词库",
    idle: "",
    syncing: "同步中…",
    synced: `已同步${thinkingSyncedVersion() ? ` · 第 ${thinkingSyncedVersion()} 版` : ""}`,
    unavailable: "云端词库还没开通（记忆库未配置）",
    error: `没同步上：${thinkingSyncMessage}。这台设备的修改都还在。`,
    conflict: "",
  };
  const state = thinkingSyncEnabled ? thinkingSyncState : "off";
  thinkingSyncText.textContent = labels[state] ?? "";
  thinkingSyncText.classList.toggle("is-error", state === "error");
  thinkingSyncRetry.hidden = state !== "error";
  thinkingSyncConflictBox.hidden = state !== "conflict";
}

thinkingSyncToggle.addEventListener("click", () => {
  if (!persistThinkingEntries([[THINKING_SYNC_KEY, thinkingSyncEnabled ? "0" : "1"]])) return;
  thinkingSyncEnabled = !thinkingSyncEnabled;
  thinkingSyncEpoch += 1;
  clearTimeout(thinkingSyncTimer);
  thinkingSyncConflict = null;
  thinkingSyncState = "idle";
  renderThinkingSync();
  if (thinkingSyncEnabled) void pullThinkingLibrary();
});
thinkingSyncRetry.addEventListener("click", () => {
  thinkingSyncState = "idle";
  void pullThinkingLibrary();
});
thinkingSyncUseCloud.addEventListener("click", () => resolveThinkingConflict(true));
thinkingSyncUseLocal.addEventListener("click", () => resolveThinkingConflict(false));
settingsThinkingOpen.addEventListener("click", () => {
  renderThinkingSync();
  if (thinkingSyncState !== "conflict") void pullThinkingLibrary();
});
// 本机改了词：记下「有没上传的修改」，稍后上传；云端写回本机时不算
document.addEventListener("thinking-settings-change", () => {
  if (thinkingSyncApplying) return;
  scheduleThinkingPush();
});
// 切回这个页面（可能在别的设备或 MCP 改过）：最多 30 秒拉一次
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - thinkingSyncLastPull > 30000) void pullThinkingLibrary();
});
