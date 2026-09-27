// 「思考彩蛋」设置：子页（总开关、翻出中文、活点地图、系列列表）+ 系列详情页（改名、开关、逐词增删改、批量粘贴、
// 恢复默认 / 删除）。都是即时生效的设置项，不走「保存并返回」。词库和换词逻辑在 js/thinking-words.js。
const THINKING_PEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 4.5c-6.4 0-11 4.6-12 11L6 20l4.5-1.5c6.4-1 11-5.6 11-12Z"></path><path d="M6 20l7.5-8.5"></path></svg>';

function setThinkingSaveError(message = "") {
  for (const status of [thinkingSettingsStatus, thinkingSeriesStatus]) {
    status.textContent = message;
    status.hidden = !message;
  }
}

// 先落盘再更新运行时状态；多个键一起改时，失败就撤回本次已写入的键。
function persistThinkingEntries(entries) {
  const written = [];
  try {
    for (const [key, value] of entries) {
      const previous = localStorage.getItem(key);
      if (previous === value) continue;
      localStorage.setItem(key, value);
      written.push([key, previous]);
    }
    setThinkingSaveError();
    return true;
  } catch {
    for (const [key, previous] of written.reverse()) {
      try {
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
      } catch { /* 保留错误提示，不宣称保存成功 */ }
    }
    setThinkingSaveError("没有保存成功，请检查浏览器存储空间后重试。编辑中的文字仍在此页，返回时会再次尝试保存。");
    return false;
  }
}

function saveThinkingFlag(key, value) {
  return persistThinkingEntries([[key, value ? "1" : "0"]]);
}

function notifyThinkingSettingsChanged() {
  document.dispatchEvent(new Event("thinking-settings-change"));
}

function saveThinkingSeries({ off = thinkingSeriesOff, custom = thinkingCustomSeries, overrides = thinkingSeriesOverrides } = {}) {
  const entries = [
    [THINKING_SERIES_OFF_KEY, JSON.stringify([...off]), JSON.stringify([...thinkingSeriesOff])],
    [THINKING_CUSTOM_KEY, JSON.stringify(custom), JSON.stringify(thinkingCustomSeries)],
    [THINKING_OVERRIDES_KEY, JSON.stringify(overrides), JSON.stringify(thinkingSeriesOverrides)],
  ].filter(([, value, previous]) => value !== previous);
  if (!persistThinkingEntries(entries)) return false;
  thinkingSeriesOff = off;
  thinkingCustomSeries = custom;
  thinkingSeriesOverrides = overrides;
  if (entries.length) notifyThinkingSettingsChanged();
  return true;
}

function setThinkingSwitch(button, on) {
  button.setAttribute("aria-checked", String(on));
}

function updateThinkingSummary() {
  if (!thinkingEggEnabled) {
    settingsThinkingSummary.textContent = "关闭";
    return;
  }
  const on = thinkingAllSeries().filter((s) => !thinkingSeriesOff.has(s.id)).length;
  settingsThinkingSummary.textContent = `开启 · ${on} 个系列${thinkingTranslate ? " · 翻中文" : ""}`;
}

function renderThinkingSeriesList() {
  thinkingSeriesList.replaceChildren(...thinkingAllSeries().map((series) => {
    const row = document.createElement("div");
    row.className = "tool-setting thinking-series-row";
    const sample = series.words.slice(0, 3).map((w) => w.zh || w.en).join("、");
    row.innerHTML = `<button class="thinking-series-open" type="button"><span class="thinking-series-copy"><span class="thinking-row-title"></span><span class="thinking-series-sub"></span></span><span class="thinking-pen">${THINKING_PEN_ICON}</span></button>` +
      '<button class="thinking-switch-row is-bare" type="button" role="switch"><span class="thinking-switch" aria-hidden="true"></span></button>';
    const open = row.querySelector(".thinking-series-open");
    open.dataset.id = series.id;
    open.setAttribute("aria-label", `编辑「${series.name}」`);
    row.querySelector(".thinking-row-title").textContent = series.name;
    row.querySelector(".thinking-series-sub").textContent = `${series.words.length} 个${series.edited ? " · 改过" : ""} · ${sample || "还没有词"}`;
    const toggle = row.querySelector(".thinking-switch-row");
    toggle.dataset.id = series.id;
    toggle.setAttribute("aria-label", `使用「${series.name}」`);
    setThinkingSwitch(toggle, !thinkingSeriesOff.has(series.id));
    return row;
  }));
}

function renderThinkingSettings() {
  setThinkingSwitch(thinkingEggToggle, thinkingEggEnabled);
  setThinkingSwitch(thinkingTranslateToggle, thinkingTranslate);
  setThinkingSwitch(thinkingMarauderToggle, thinkingMarauder);
  renderThinkingSeriesList();
  updateThinkingSummary();
}

// ---- 系列详情页 ----
function currentThinkingSeries() {
  return thinkingAllSeries().find((s) => s.id === thinkingEditingSeries) || null;
}

function thinkingWordRow(word = { en: "", zh: "" }) {
  const row = document.createElement("div");
  row.className = "thinking-word-row";
  row.innerHTML = '<input class="thinking-input thinking-word-en" type="text" placeholder="English…" aria-label="英文" />' +
    '<input class="thinking-input thinking-word-zh" type="text" placeholder="中文（可不写）" aria-label="中文" />' +
    '<button class="thinking-word-delete" type="button" aria-label="删掉这个词"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg></button>';
  row.querySelector(".thinking-word-en").value = word.en;
  row.querySelector(".thinking-word-zh").value = word.zh;
  return row;
}

function renderThinkingSeriesScreen() {
  const series = currentThinkingSeries();
  if (!series) return;
  thinkingSeriesHeading.textContent = series.name;
  thinkingSeriesName.value = series.name;
  setThinkingSwitch(thinkingSeriesEnabled, !thinkingSeriesOff.has(series.id));
  thinkingWords.replaceChildren(...series.words.map(thinkingWordRow));
  thinkingWordsTitle.textContent = `词 · ${series.words.length} 个`;
  thinkingSeriesReset.hidden = series.custom || !series.edited;
  thinkingSeriesDelete.hidden = !series.custom;
}

// 把详情页当前的内容写回：自定义系列直接改；内置系列写进 overrides（名字/词和原版一样就不记）
function saveThinkingSeriesScreen() {
  const series = currentThinkingSeries();
  if (!series) return true;
  const name = thinkingSeriesName.value.trim() || series.name;
  const words = [...thinkingWords.querySelectorAll(".thinking-word-row")]
    .map((row) => ({ en: row.querySelector(".thinking-word-en").value.trim(), zh: row.querySelector(".thinking-word-zh").value.trim() }))
    .filter((w) => w.en);
  if (series.custom) {
    const custom = thinkingCustomSeries.map((s) => s.id === series.id ? { ...s, name, words } : s);
    if (!saveThinkingSeries({ custom })) return false;
  } else {
    const original = THINKING_SERIES.find((s) => s.id === series.id);
    const same = JSON.stringify(words) === JSON.stringify(original.words.map(([en, zh]) => ({ en, zh })));
    const override = { ...(name !== original.name ? { name } : {}), ...(same ? {} : { words }) };
    const overrides = { ...thinkingSeriesOverrides };
    if (Object.keys(override).length) overrides[series.id] = override;
    else delete overrides[series.id];
    if (!saveThinkingSeries({ overrides })) return false;
  }
  thinkingSeriesHeading.textContent = name;
  thinkingWordsTitle.textContent = `词 · ${words.length} 个`;
  thinkingSeriesReset.hidden = series.custom || !thinkingSeriesOverrides[series.id];
  return true;
}

function openThinkingSeriesScreen(id) {
  thinkingEditingSeries = id;
  renderThinkingSeriesScreen();
  thinkingSettingsScreen.inert = true;
  thinkingSeriesScreen.classList.add("is-open");
  thinkingSeriesScreen.setAttribute("aria-hidden", "false");
  thinkingSeriesBack.focus();
}

function closeThinkingSeriesScreen({ instant = false } = {}) {
  if (!saveThinkingSeriesScreen()) return;
  if (instant) skipPanelMotionOnce(thinkingSeriesScreen);
  const id = thinkingEditingSeries;
  thinkingEditingSeries = null;
  thinkingSeriesScreen.classList.remove("is-open");
  thinkingSeriesScreen.setAttribute("aria-hidden", "true");
  thinkingSettingsScreen.inert = false;
  renderThinkingSettings();
  (thinkingSeriesList.querySelector(`.thinking-series-open[data-id="${id}"]`) || thinkingSeriesAdd).focus();
}

function openThinkingSettingsScreen() {
  renderThinkingSettings();
  settingsScreen.inert = true;
  thinkingSettingsScreen.classList.add("is-open");
  thinkingSettingsScreen.setAttribute("aria-hidden", "false");
  thinkingSettingsBack.focus();
}

function closeThinkingSettingsScreen({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(thinkingSettingsScreen);
  thinkingSettingsScreen.classList.remove("is-open");
  thinkingSettingsScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  updateSettingsDirty();
  updateThinkingSummary();
  settingsThinkingOpen.focus();
}

settingsThinkingOpen.addEventListener("click", openThinkingSettingsScreen);
thinkingSettingsBack.addEventListener("click", () => closeThinkingSettingsScreen());
thinkingEggToggle.addEventListener("click", () => {
  if (!saveThinkingFlag(THINKING_EGG_KEY, !thinkingEggEnabled)) return;
  thinkingEggEnabled = !thinkingEggEnabled;
  notifyThinkingSettingsChanged();
  renderThinkingSettings();
});
thinkingTranslateToggle.addEventListener("click", () => {
  if (!saveThinkingFlag(THINKING_TRANSLATE_KEY, !thinkingTranslate)) return;
  thinkingTranslate = !thinkingTranslate;
  notifyThinkingSettingsChanged();
  renderThinkingSettings();
});
thinkingMarauderToggle.addEventListener("click", () => {
  if (!saveThinkingFlag(THINKING_MARAUDER_KEY, !thinkingMarauder)) return;
  thinkingMarauder = !thinkingMarauder;
  notifyThinkingSettingsChanged();
  renderThinkingSettings();
});
thinkingSeriesList.addEventListener("click", (event) => {
  const open = event.target.closest(".thinking-series-open");
  if (open) { openThinkingSeriesScreen(open.dataset.id); return; }
  const toggle = event.target.closest(".thinking-switch-row");
  if (!toggle) return;
  const id = toggle.dataset.id;
  const off = new Set(thinkingSeriesOff);
  if (off.has(id)) off.delete(id);
  else off.add(id);
  if (!saveThinkingSeries({ off })) return;
  setThinkingSwitch(toggle, !thinkingSeriesOff.has(id));
  updateThinkingSummary();
});
thinkingSeriesAdd.addEventListener("click", () => {
  const id = `custom-${Date.now().toString(36)}`;
  const custom = [...thinkingCustomSeries, { id, name: "新系列", words: [] }];
  if (!saveThinkingSeries({ custom })) return;
  renderThinkingSettings();
  openThinkingSeriesScreen(id);
  thinkingSeriesName.select();
});

thinkingSeriesBack.addEventListener("click", () => closeThinkingSeriesScreen());
thinkingSeriesName.addEventListener("input", saveThinkingSeriesScreen);
thinkingSeriesEnabled.addEventListener("click", () => {
  const id = thinkingEditingSeries;
  if (!saveThinkingSeriesScreen()) return;
  const off = new Set(thinkingSeriesOff);
  if (off.has(id)) off.delete(id);
  else off.add(id);
  if (!saveThinkingSeries({ off })) return;
  setThinkingSwitch(thinkingSeriesEnabled, !thinkingSeriesOff.has(id));
});
thinkingWords.addEventListener("input", saveThinkingSeriesScreen);
thinkingWords.addEventListener("click", (event) => {
  const del = event.target.closest(".thinking-word-delete");
  if (!del) return;
  const row = del.closest(".thinking-word-row");
  (row.nextElementSibling || row.previousElementSibling)?.querySelector(".thinking-word-en")?.focus();
  row.remove();
  saveThinkingSeriesScreen();
});
thinkingWordAdd.addEventListener("click", () => {
  const row = thinkingWordRow();
  thinkingWords.appendChild(row);
  row.querySelector(".thinking-word-en").focus();
});
// 「英文 | 中文」一行一个；竖线全角半角都认，中文可以不写
thinkingBulkAdd.addEventListener("click", () => {
  const words = thinkingBulkText.value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [en, ...rest] = line.split(/[|｜]/);
    return { en: en.trim(), zh: rest.join("|").trim() };
  }).filter((w) => w.en);
  if (!words.length) return;
  thinkingWords.append(...words.map(thinkingWordRow));
  thinkingBulkText.value = "";
  saveThinkingSeriesScreen();
});
thinkingSeriesReset.addEventListener("click", () => {
  if (!window.confirm("恢复成原版的名字和词？你改过的会丢掉。")) return;
  const overrides = { ...thinkingSeriesOverrides };
  delete overrides[thinkingEditingSeries];
  if (!saveThinkingSeries({ overrides })) return;
  renderThinkingSeriesScreen();
});
thinkingSeriesDelete.addEventListener("click", () => {
  const series = currentThinkingSeries();
  if (!series?.custom || !window.confirm(`删除「${series.name}」系列？`)) return;
  const custom = thinkingCustomSeries.filter((s) => s.id !== series.id);
  const off = new Set(thinkingSeriesOff);
  off.delete(series.id);
  if (!saveThinkingSeries({ custom, off })) return;
  closeThinkingSeriesScreen();
});
