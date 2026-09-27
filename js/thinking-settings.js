// 「思考彩蛋」设置子页：总开关、翻出中文、活点地图、系列勾选、自定义系列（新建 / 编辑 / 删除）。
// 都是即时生效的设置项，不走「保存并返回」。词库和换词逻辑在 js/thinking-words.js。

function saveThinkingFlag(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
}

function saveThinkingSeries() {
  localStorage.setItem(THINKING_SERIES_OFF_KEY, JSON.stringify([...thinkingSeriesOff]));
  localStorage.setItem(THINKING_CUSTOM_KEY, JSON.stringify(thinkingCustomSeries));
}

function updateThinkingSummary() {
  if (!thinkingEggEnabled) {
    settingsThinkingSummary.textContent = "关闭";
    return;
  }
  const on = thinkingAllSeries().filter((s) => !thinkingSeriesOff.has(s.id)).length;
  settingsThinkingSummary.textContent = `开启 · ${on} 个系列${thinkingTranslate ? " · 翻中文" : ""}`;
}

function renderThinkingToggle(button, state, value) {
  button.setAttribute("aria-pressed", String(value));
  state.textContent = value ? "开" : "关";
}

function renderThinkingSeriesList() {
  thinkingSeriesList.replaceChildren(...thinkingAllSeries().map((series) => {
    const row = document.createElement("div");
    row.className = "tool-setting thinking-series";
    const on = !thinkingSeriesOff.has(series.id);
    const sample = series.words.slice(0, 3).map((w) => w.zh || w.en).join("、");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "quick-row memory-settings-row thinking-series-toggle";
    toggle.dataset.id = series.id;
    toggle.setAttribute("aria-pressed", String(on));
    toggle.innerHTML = '<span class="thinking-series-copy"><strong></strong><span></span></span><span class="quick-state"></span>';
    toggle.querySelector("strong").textContent = series.name;
    toggle.querySelector(".thinking-series-copy span").textContent = `${series.words.length} 个 · ${sample || "还没有词"}`;
    toggle.querySelector(".quick-state").textContent = on ? "开" : "关";
    row.appendChild(toggle);
    if (series.custom) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "thinking-series-edit";
      edit.dataset.id = series.id;
      edit.textContent = "编辑";
      row.appendChild(edit);
    }
    return row;
  }));
}

function renderThinkingEditor() {
  const editing = thinkingEditingSeries;
  thinkingSeriesEditor.hidden = !editing;
  thinkingSeriesAdd.hidden = Boolean(editing);
  if (!editing) return;
  const series = thinkingCustomSeries.find((s) => s.id === editing);
  thinkingEditorName.value = series?.name || "";
  thinkingEditorWords.value = series ? series.words.map((w) => (w.zh ? `${w.en} | ${w.zh}` : w.en)).join("\n") : "";
  thinkingEditorDelete.hidden = !series;
  thinkingEditorError.textContent = "";
}

function renderThinkingSettings() {
  renderThinkingToggle(thinkingEggToggle, thinkingEggState, thinkingEggEnabled);
  renderThinkingToggle(thinkingTranslateToggle, thinkingTranslateState, thinkingTranslate);
  renderThinkingToggle(thinkingMarauderToggle, thinkingMarauderState, thinkingMarauder);
  renderThinkingSeriesList();
  renderThinkingEditor();
  updateThinkingSummary();
}

// 「英文 | 中文」一行一个；竖线全角半角都认，中文可以不写
function parseThinkingWords(text) {
  return text.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [en, ...rest] = line.split(/[|｜]/);
      return { en: en.trim(), zh: rest.join("|").trim() };
    })
    .filter((w) => w.en);
}

function saveThinkingEditor() {
  const name = thinkingEditorName.value.trim();
  const words = parseThinkingWords(thinkingEditorWords.value);
  if (!name) { thinkingEditorError.textContent = "给这个系列起个名字。"; thinkingEditorName.focus(); return; }
  if (!words.length) { thinkingEditorError.textContent = "至少写一个词。"; thinkingEditorWords.focus(); return; }
  const existing = thinkingCustomSeries.find((s) => s.id === thinkingEditingSeries);
  if (existing) Object.assign(existing, { name, words });
  else thinkingCustomSeries.push({ id: `custom-${Date.now().toString(36)}`, name, words });
  saveThinkingSeries();
  thinkingEditingSeries = null;
  renderThinkingSettings();
  thinkingSeriesAdd.focus();
}

function deleteThinkingSeries() {
  const series = thinkingCustomSeries.find((s) => s.id === thinkingEditingSeries);
  if (!series || !window.confirm(`删除「${series.name}」系列？`)) return;
  thinkingCustomSeries = thinkingCustomSeries.filter((s) => s.id !== series.id);
  thinkingSeriesOff.delete(series.id);
  saveThinkingSeries();
  thinkingEditingSeries = null;
  renderThinkingSettings();
  thinkingSeriesAdd.focus();
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
  thinkingEditingSeries = null;
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
  thinkingEggEnabled = !thinkingEggEnabled;
  saveThinkingFlag(THINKING_EGG_KEY, thinkingEggEnabled);
  renderThinkingSettings();
});
thinkingTranslateToggle.addEventListener("click", () => {
  thinkingTranslate = !thinkingTranslate;
  saveThinkingFlag(THINKING_TRANSLATE_KEY, thinkingTranslate);
  renderThinkingSettings();
});
thinkingMarauderToggle.addEventListener("click", () => {
  thinkingMarauder = !thinkingMarauder;
  saveThinkingFlag(THINKING_MARAUDER_KEY, thinkingMarauder);
  renderThinkingSettings();
});
thinkingSeriesList.addEventListener("click", (event) => {
  const edit = event.target.closest(".thinking-series-edit");
  if (edit) {
    thinkingEditingSeries = edit.dataset.id;
    renderThinkingEditor();
    thinkingEditorName.focus();
    return;
  }
  const toggle = event.target.closest(".thinking-series-toggle");
  if (!toggle) return;
  const id = toggle.dataset.id;
  if (thinkingSeriesOff.has(id)) thinkingSeriesOff.delete(id);
  else thinkingSeriesOff.add(id);
  saveThinkingSeries();
  renderThinkingSettings();
  thinkingSeriesList.querySelector(`.thinking-series-toggle[data-id="${id}"]`)?.focus();
});
thinkingSeriesAdd.addEventListener("click", () => {
  thinkingEditingSeries = "new";
  renderThinkingEditor();
  thinkingEditorName.focus();
});
thinkingEditorSave.addEventListener("click", saveThinkingEditor);
thinkingEditorDelete.addEventListener("click", deleteThinkingSeries);
thinkingEditorCancel.addEventListener("click", () => {
  thinkingEditingSeries = null;
  renderThinkingEditor();
  thinkingSeriesAdd.focus();
});
