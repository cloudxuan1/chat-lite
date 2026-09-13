// 模型目录、设置面板及各子页的读写与渲染。
function normalizeFavorites(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const id = String(item?.id || item || "").trim();
    const label = String(item?.label || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, label: label || friendlyModelName(id) });
  }
  return normalized;
}

function loadFavorites() {
  const saved = normalizeFavorites(parseStoredJson(FAVORITES_KEY, []));
  return saved.length ? saved : [{ id: currentModel || DEFAULT_MODEL, label: friendlyModelName(currentModel || DEFAULT_MODEL) }];
}

function normalizeModel(item) {
  const id = String(item?.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(item?.name || "").trim(),
    description: String(item?.description || "").trim().slice(0, 600),
    contextLength: Number(item?.contextLength || 0) || null,
    maxCompletionTokens: Number(item?.maxCompletionTokens || 0) || null,
    pricing: item?.pricing && typeof item.pricing === "object" ? item.pricing : null,
    reasoning: item?.reasoning && typeof item.reasoning === "object" ? item.reasoning : null,
    supportedParameters: Array.isArray(item?.supportedParameters) ? item.supportedParameters : [],
    inputModalities: Array.isArray(item?.inputModalities)
      ? item.inputModalities.filter((modality) => typeof modality === "string")
      : [],
  };
}

function loadModelCatalog() {
  const items = parseStoredJson(MODEL_CATALOG_KEY, []);
  if (!Array.isArray(items)) return [];
  return items.map(normalizeModel).filter(Boolean);
}

function saveModelCatalog(items) {
  const safe = items.map(normalizeModel).filter(Boolean);
  fetchedModels = safe;
  try {
    localStorage.setItem(MODEL_CATALOG_KEY, JSON.stringify(safe));
  } catch {
    // 模型目录只是离线备用，浏览器空间不足时不影响聊天和收藏。
  }
}

function friendlyModelName(modelId) {
  let slug = String(modelId || DEFAULT_MODEL).split("/").pop() || "";
  slug = slug.replace(/:[^:]+$/, "").replace(/^claude-/i, "");
  slug = slug
    .replace(/^gpt-/i, "GPT ")
    .replace(/^gemini-/i, "Gemini ")
    .replace(/^grok-/i, "Grok ")
    .replace(/^deepseek-/i, "DeepSeek ")
    .replace(/^qwen-/i, "Qwen ")
    .replace(/-/g, " ")
    .replace(/\b(opus|sonnet|haiku|pro|flash|mini|max)\b/gi, (word) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .replace(/\s+/g, " ")
    .trim();
  return slug || "当前模型";
}

function modelById(modelId) {
  return fetchedModels.find((item) => item.id === modelId) || null;
}

function modelImageCapability(model) {
  if (!model || !model.inputModalities.length) return "unknown";
  return model.inputModalities.includes("image") ? "supported" : "unsupported";
}

function modelLabel(modelId) {
  const model = modelById(modelId);
  return friendlyModelName(model?.id || modelId);
}

function effortAllowed(model, value) {
  const reasoning = model?.reasoning;
  if (value === "off") return reasoning?.mandatory !== true;
  const supported = reasoning?.supported_efforts;
  if (Array.isArray(supported) && supported.length) return supported.includes(value);
  if (model && model.supportedParameters.length && !model.supportedParameters.includes("reasoning")) {
    return false;
  }
  return true;
}

function normalizeEffortForModel(value, model) {
  if (effortAllowed(model, value)) return value;
  const supported = model?.reasoning?.supported_efforts;
  const preferred = model?.reasoning?.default_effort;
  if (preferred && EFFORT_OPTIONS.some((item) => item.value === preferred) && effortAllowed(model, preferred)) {
    return preferred;
  }
  if (Array.isArray(supported)) {
    for (const option of ["medium", "low", "high"]) {
      if (supported.includes(option)) return option;
    }
  }
  return model?.reasoning?.mandatory ? "medium" : "off";
}

function renderEffortOptions(container, selected, model, onSelect) {
  container.replaceChildren();
  EFFORT_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "effort-option";
    button.textContent = option.label;
    button.dataset.effort = option.value;
    button.disabled = !effortAllowed(model, option.value);
    button.setAttribute("aria-pressed", String(option.value === selected));
    button.addEventListener("click", () => onSelect(option.value));
    container.appendChild(button);
  });
}

function updateTopbar() {
  modelQuickLabel.textContent = modelLabel(currentModel);
  quickModelId.textContent = currentModel;
  const model = modelById(currentModel);
  renderEffortOptions(quickEffortOptions, reasoningEffort, model, setQuickEffort);
  webToggle.setAttribute("aria-pressed", String(webSearchEnabled));
  webState.textContent = webSearchEnabled ? "开" : "关";
}

function setQuickEffort(value) {
  reasoningEffort = normalizeEffortForModel(value, modelById(currentModel));
  localStorage.setItem(REASONING_EFFORT_KEY, reasoningEffort);
  updateTopbar();
}

function settingsState() {
  return JSON.stringify({
    model: draftModel,
    reasoningEffort: draftReasoningEffort,
    promptLibrary: draftPromptLibrary,
    maxCompletionTokens: draftMaxCompletionTokens,
    userDisplayName: userDisplayNameInput.value,
    assistantDisplayName: assistantDisplayNameInput.value,
    exportFileName: exportFileNameInput.value,
    webSearchMaxUses: draftWebSearchMaxUses,
    webSearchMaxResults: draftWebSearchMaxResults,
    imageQuality: draftImageQuality,
    swipeActions: draftSwipeActions,
  });
}

function maxTokensValidationMessage() {
  const raw = draftMaxCompletionTokens.trim();
  if (!raw) return "";
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    return "请输入大于 0 的整数，或留空使用自动。";
  }
  const modelMax = modelById(draftModel)?.maxCompletionTokens;
  if (modelMax && Number(raw) > modelMax) {
    return `当前模型最多支持 ${modelMax.toLocaleString()} token。`;
  }
  return "";
}

function updateMaxTokensUi() {
  const modelMax = modelById(draftModel)?.maxCompletionTokens;
  maxTokensNote.textContent = modelMax
    ? `包含内部思考；留空为自动 · 当前模型最多 ${modelMax.toLocaleString()}`
    : "包含内部思考；留空为自动";
  const message = maxTokensValidationMessage();
  maxTokensError.textContent = message;
  maxCompletionTokensInput.setAttribute("aria-invalid", String(Boolean(message)));
  return !message;
}

function boundedIntegerValidationMessage(raw, min, max) {
  const value = raw.trim();
  if (!value) return "";
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    return `请输入 ${min} 到 ${max} 的整数，或留空使用自动。`;
  }
  const number = Number(value);
  return number >= min && number <= max
    ? ""
    : `请输入 ${min} 到 ${max} 的整数，或留空使用自动。`;
}

function updateSearchSettingsUi() {
  const usesMessage = boundedIntegerValidationMessage(draftWebSearchMaxUses, 1, 30);
  const resultsMessage = boundedIntegerValidationMessage(draftWebSearchMaxResults, 1, 25);
  webSearchMaxUsesError.textContent = usesMessage;
  webSearchMaxResultsError.textContent = resultsMessage;
  webSearchMaxUsesInput.setAttribute("aria-invalid", String(Boolean(usesMessage)));
  webSearchMaxResultsInput.setAttribute("aria-invalid", String(Boolean(resultsMessage)));
  return !usesMessage && !resultsMessage;
}

function updateToolSummaries() {
  const searchDetails = [];
  if (draftWebSearchMaxUses) searchDetails.push(`最多 ${draftWebSearchMaxUses} 次`);
  if (draftWebSearchMaxResults) searchDetails.push(`每次 ${draftWebSearchMaxResults} 条`);
  settingsWebSummary.textContent = webSearchEnabled
    ? `开启 · ${searchDetails.join(" · ") || "自动"}`
    : "关闭";
  settingsImageSummary.textContent = `最多 8 张 · ${
    draftImageQuality === "original" ? "保留原图" : "自动压缩"
  }`;
  imageQualityOptions.querySelectorAll(".quality-option").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.quality === draftImageQuality));
  });
  imageQualityNote.textContent = draftImageQuality === "original"
    ? "保留原始像素和文件；小字更清楚，但更容易超过 6MB 合计上限。"
    : "自动压缩会在发送前缩小大图，更快也更省上传量。";
}

function updateSettingsDirty() {
  settingsSave.textContent = "保存并返回";
  const valid = updateMaxTokensUi() && updateSearchSettingsUi();
  settingsSave.disabled = !valid;
  updateToolSummaries();
}

function updatePromptCount() {
  const length = systemPromptInput.value.length;
  promptCount.textContent = `${length.toLocaleString()} 字`;
  settingsPromptSummary.textContent = promptSummaryText(draftPromptLibrary);
  updateSettingsDirty();
}

// 提示词列表：点哪行就选中哪份（草稿态，保存并返回后生效），编辑区跟着切换
function renderPromptList() {
  promptList.replaceChildren();
  draftPromptLibrary.items.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `prompt-row${item.id === draftPromptLibrary.activeId ? " active" : ""}`;
    row.dataset.promptId = item.id;
    row.setAttribute("aria-pressed", String(item.id === draftPromptLibrary.activeId));
    const check = document.createElement("span");
    check.className = "prompt-row-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
    const name = document.createElement("span");
    name.className = "prompt-row-name";
    name.textContent = item.name;
    const count = document.createElement("span");
    count.className = "prompt-row-count";
    const length = item.content.trim().length;
    count.textContent = length ? `${length.toLocaleString()} 字` : "空";
    row.append(check, name, count);
    promptList.appendChild(row);
  });
  promptDelete.disabled = draftPromptLibrary.items.length <= 1;
}

function loadPromptEditor() {
  const active = activePrompt(draftPromptLibrary);
  promptNameInput.value = active.name;
  systemPromptInput.value = active.content;
  updatePromptCount();
  requestAnimationFrame(autoGrowSystemPrompt);
}

function selectPrompt(promptId) {
  if (!draftPromptLibrary.items.some((item) => item.id === promptId)) return;
  draftPromptLibrary.activeId = promptId;
  renderPromptList();
  loadPromptEditor();
}

function addPrompt() {
  const item = {
    id: createPromptId(),
    name: `提示词 ${draftPromptLibrary.items.length + 1}`,
    content: "",
  };
  draftPromptLibrary.items.push(item);
  draftPromptLibrary.activeId = item.id;
  renderPromptList();
  loadPromptEditor();
  promptNameInput.focus();
  promptNameInput.select();
}

function deleteActivePrompt() {
  if (draftPromptLibrary.items.length <= 1) return;
  const active = activePrompt(draftPromptLibrary);
  if (!window.confirm(`删除提示词「${active.name}」？`)) return;
  const index = draftPromptLibrary.items.findIndex((item) => item.id === active.id);
  draftPromptLibrary.items.splice(index, 1);
  draftPromptLibrary.activeId = draftPromptLibrary.items[Math.min(index, draftPromptLibrary.items.length - 1)].id;
  renderPromptList();
  loadPromptEditor();
}

function updateIdentitySummary() {
  draftUserDisplayName = normalizeDisplayName(userDisplayNameInput.value, "你");
  draftAssistantDisplayName = normalizeDisplayName(assistantDisplayNameInput.value, "助手");
  draftExportFileName = normalizeExportFileName(exportFileNameInput.value);
  const fileSummary = draftExportFileName ? "自定义文件名" : "自动命名";
  settingsIdentitySummary.textContent = `${draftUserDisplayName} / ${draftAssistantDisplayName} · ${fileSummary}`;
  updateSettingsDirty();
}

function autoGrowSystemPrompt() {
  // 先记住滚动位置：height 置 auto 的瞬间输入框塌掉，promptScroll 会被浏览器强行拉回，造成打字时上下跳
  const scrollTop = promptScroll.scrollTop;
  systemPromptInput.style.height = "auto";
  systemPromptInput.style.height = `${Math.max(systemPromptInput.scrollHeight, 220)}px`;
  promptScroll.scrollTop = scrollTop;
}

function stepMaxCompletionTokens(direction) {
  const raw = draftMaxCompletionTokens.trim();
  const current = /^\d+$/.test(raw) ? Number(raw) : 0;
  const next = direction > 0 ? current + 1024 : current - 1024;
  draftMaxCompletionTokens = next > 0 ? String(next) : "";
  maxCompletionTokensInput.value = draftMaxCompletionTokens;
  updateSettingsDirty();
}

function stepSearchSetting(kind, direction) {
  const isUses = kind === "uses";
  const raw = isUses ? draftWebSearchMaxUses : draftWebSearchMaxResults;
  const max = isUses ? 30 : 25;
  const current = /^\d+$/.test(raw.trim()) ? Number(raw) : 0;
  const next = direction > 0 ? Math.min(max, current + 1) : current - 1;
  const value = next > 0 ? String(next) : "";
  if (isUses) {
    draftWebSearchMaxUses = value;
    webSearchMaxUsesInput.value = value;
  } else {
    draftWebSearchMaxResults = value;
    webSearchMaxResultsInput.value = value;
  }
  updateSettingsDirty();
}

function updateSettingsModel() {
  const model = modelById(draftModel);
  settingsModelName.textContent = modelLabel(draftModel);
  settingsModelId.textContent = draftModel;
  draftReasoningEffort = normalizeEffortForModel(draftReasoningEffort, model);
  renderEffortOptions(settingsEffortOptions, draftReasoningEffort, model, (value) => {
    draftReasoningEffort = normalizeEffortForModel(value, model);
    updateSettingsModel();
    updateSettingsDirty();
  });
  if (model?.reasoning?.mandatory) {
    reasoningNote.textContent = "这个模型必须推理，不能关闭；这里只显示它支持的档位。";
  } else if (model && model.supportedParameters.length && !model.supportedParameters.includes("reasoning")) {
    reasoningNote.textContent = "这个模型没有提供可调推理程度，发送时会关闭推理。";
  } else {
    reasoningNote.textContent = "越高越适合复杂问题，也会花更多时间和 token。";
  }
  updateMaxTokensUi();
}

function collectVisibleModels() {
  const query = modelSearch.value.trim().toLowerCase();
  const favoriteIds = new Set(draftFavorites.map((item) => item.id));
  const byId = new Map();
  for (const favorite of draftFavorites) {
    const fetched = modelById(favorite.id);
    byId.set(favorite.id, fetched || normalizeModel({ id: favorite.id, name: favorite.label }));
  }
  for (const model of fetchedModels) byId.set(model.id, model);
  if (!byId.has(draftModel)) byId.set(draftModel, normalizeModel({ id: draftModel }));
  const matches = (model) => {
    if (!query) return true;
    return `${model.id} ${model.name} ${model.description}`.toLowerCase().includes(query);
  };
  const favorites = [...byId.values()].filter((model) => favoriteIds.has(model.id) && matches(model));
  const others = [...byId.values()].filter((model) => !favoriteIds.has(model.id) && matches(model));
  return { favorites, others };
}

function makeStarIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"></path></svg>';
}

function appendModelGroup(label, models) {
  if (!models.length) return;
  const heading = document.createElement("div");
  heading.className = "model-group-label";
  heading.textContent = label;
  modelList.appendChild(heading);
  for (const model of models) {
    const row = document.createElement("div");
    row.className = "model-choice" + (model.id === draftModel ? " active" : "");

    const text = document.createElement("span");
    text.className = "model-choice-text";
    const name = document.createElement("strong");
    name.className = "model-choice-name";
    name.textContent = friendlyModelName(model.id);
    const id = document.createElement("span");
    id.className = "model-choice-id";
    id.textContent = model.id;
    text.append(name, id);

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "model-choice-select";
    selectButton.setAttribute("aria-pressed", String(model.id === draftModel));
    selectButton.appendChild(text);

    const favorite = draftFavorites.some((item) => item.id === model.id);
    const star = document.createElement("button");
    star.type = "button";
    star.className = "model-star";
    star.innerHTML = makeStarIcon();
    star.setAttribute("aria-label", favorite ? `取消收藏 ${name.textContent}` : `收藏 ${name.textContent}`);
    star.setAttribute("aria-pressed", String(favorite));
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      if (favorite) {
        draftFavorites = draftFavorites.filter((item) => item.id !== model.id);
      } else {
        draftFavorites = normalizeFavorites([
          ...draftFavorites,
          { id: model.id, label: friendlyModelName(model.id) },
        ]);
      }
      favoriteModels = normalizeFavorites(draftFavorites);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteModels));
      renderModelList();
    });

    const select = () => {
      draftModel = model.id;
      draftReasoningEffort = normalizeEffortForModel(draftReasoningEffort, model);
      updateSettingsModel();
      renderModelList();
      updateSettingsDirty();
    };
    selectButton.addEventListener("click", select);
    row.append(selectButton, star);
    modelList.appendChild(row);
  }
}

function renderModelList() {
  modelList.replaceChildren();
  const { favorites, others } = collectVisibleModels();
  appendModelGroup("收藏模型", favorites);
  appendModelGroup(modelSearch.value.trim() ? "搜索结果" : "全部模型", others);
  if (!favorites.length && !others.length) {
    const empty = document.createElement("div");
    empty.className = "model-group-label";
    empty.textContent = modelsLoading ? "正在拉取模型…" : "没有找到模型";
    modelList.appendChild(empty);
  }
}

async function fetchModels({ force = false } = {}) {
  if (modelsLoading || (modelsLoadedThisPage && !force)) return;
  modelsLoading = true;
  modelsStatus.textContent = "正在从 OpenRouter 拉取模型…";
  modelsRetry.disabled = true;
  renderModelList();
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "models", password: accessPw }),
    });
    if (response.status === 401) {
      localStorage.removeItem(PW_KEY);
      accessPw = "";
      showGate("密码已失效，请重新输入");
      throw new Error("需要重新输入访问密码");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `服务返回 ${response.status}`);
    }
    const models = Array.isArray(payload?.models) ? payload.models : [];
    saveModelCatalog(models);
    modelsLoadedThisPage = true;
    modelsStatus.textContent = `已拉取 ${fetchedModels.length.toLocaleString()} 个模型`;
    updateSettingsModel();
    updateAttachmentState();
  } catch (error) {
    modelsStatus.textContent = `拉取失败：${error.message}。已保留本地模型，可点右侧重试。`;
  } finally {
    modelsLoading = false;
    modelsRetry.disabled = false;
    renderModelList();
  }
}

function openQuickPanel() {
  const open = !quickPanel.classList.contains("is-open");
  quickPanel.classList.toggle("is-open", open);
  quickPanel.setAttribute("aria-hidden", String(!open));
  modelQuick.setAttribute("aria-expanded", String(open));
}

function closeQuickPanel() {
  quickPanel.classList.remove("is-open");
  quickPanel.setAttribute("aria-hidden", "true");
  modelQuick.setAttribute("aria-expanded", "false");
}

function openSettings() {
  settingsTrigger = document.activeElement;
  closeQuickPanel();
  draftModel = currentModel;
  draftFavorites = favoriteModels.map((item) => ({ ...item }));
  draftReasoningEffort = reasoningEffort;
  draftMaxCompletionTokens = maxCompletionTokens === null ? "" : String(maxCompletionTokens);
  draftUserDisplayName = userDisplayName;
  draftAssistantDisplayName = assistantDisplayName;
  draftExportFileName = exportFileName;
  draftWebSearchMaxUses = webSearchMaxUses === null ? "" : String(webSearchMaxUses);
  draftWebSearchMaxResults = webSearchMaxResults === null ? "" : String(webSearchMaxResults);
  draftImageQuality = imageQuality;
  draftSwipeActions = { ...swipeActions };
  swipeLeftSelect.value = draftSwipeActions.left;
  swipeRightSelect.value = draftSwipeActions.right;
  modelSearch.value = "";
  draftPromptLibrary = clonePromptLibrary(promptLibrary);
  renderPromptList();
  loadPromptEditor();
  maxCompletionTokensInput.value = draftMaxCompletionTokens;
  userDisplayNameInput.value = draftUserDisplayName;
  assistantDisplayNameInput.value = draftAssistantDisplayName;
  exportFileNameInput.value = draftExportFileName;
  webSearchMaxUsesInput.value = draftWebSearchMaxUses;
  webSearchMaxResultsInput.value = draftWebSearchMaxResults;
  updateSettingsModel();
  renderModelList();
  updatePromptCount();
  updateIdentitySummary();
  updateToolSummaries();
  settingsSnapshot = settingsState();
  updateSettingsDirty();
  settingsScreen.classList.add("is-open");
  settingsScreen.setAttribute("aria-hidden", "false");
  syncInteractionState();
  settingsBack.focus();
  requestAnimationFrame(autoGrowSystemPrompt);
}

function openModelScreen() {
  settingsScreen.inert = true;
  modelScreen.classList.add("is-open");
  modelScreen.setAttribute("aria-hidden", "false");
  modelScroll.scrollTop = 0;
  modelSearch.value = "";
  renderModelList();
  modelsStatus.textContent = fetchedModels.length
    ? `本地已有 ${fetchedModels.length.toLocaleString()} 个模型，正在刷新…`
    : "准备拉取 OpenRouter 模型…";
  modelBack.focus();
  updateModelScrollTop();
  void fetchModels({ force: true });
}

function skipPanelMotionOnce(screen) {
  screen.classList.add("skip-motion");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    screen.classList.remove("skip-motion");
  }));
}

function closeModelScreen({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(modelScreen);
  modelScreen.classList.remove("is-open");
  modelScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  settingsModelOpen.focus();
}

function openPromptScreen() {
  settingsScreen.inert = true;
  promptScreen.classList.add("is-open");
  promptScreen.setAttribute("aria-hidden", "false");
  promptScroll.scrollTop = 0;
  promptBack.focus();
  requestAnimationFrame(autoGrowSystemPrompt);
}

function closePromptScreen({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(promptScreen);
  promptScreen.classList.remove("is-open");
  promptScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  updatePromptCount();
  settingsPromptOpen.focus();
}

function openIdentityScreen() {
  settingsScreen.inert = true;
  identityScreen.classList.add("is-open");
  identityScreen.setAttribute("aria-hidden", "false");
  identityBack.focus();
}

function closeIdentityScreen({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(identityScreen);
  identityScreen.classList.remove("is-open");
  identityScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  updateIdentitySummary();
  settingsIdentityOpen.focus();
}

function openWebSettingsScreen() {
  settingsScreen.inert = true;
  webSettingsScreen.classList.add("is-open");
  webSettingsScreen.setAttribute("aria-hidden", "false");
  webSettingsBack.focus();
}

function closeWebSettingsScreen({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(webSettingsScreen);
  webSettingsScreen.classList.remove("is-open");
  webSettingsScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  updateSettingsDirty();
  settingsWebOpen.focus();
}

function openImageSettingsScreen() {
  settingsScreen.inert = true;
  imageSettingsScreen.classList.add("is-open");
  imageSettingsScreen.setAttribute("aria-hidden", "false");
  imageSettingsBack.focus();
}

function closeImageSettingsScreen({ instant = false } = {}) {
  if (instant) skipPanelMotionOnce(imageSettingsScreen);
  imageSettingsScreen.classList.remove("is-open");
  imageSettingsScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  updateSettingsDirty();
  settingsImageOpen.focus();
}

function updateModelScrollTop() {
  const visible = modelScroll.scrollTop > 360;
  modelsScrollTop.classList.toggle("is-visible", visible);
}

function scrollModelsToTop() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  modelScroll.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

function closeSettings({ force = false, instant = false } = {}) {
  if (!force && settingsState() !== settingsSnapshot && !window.confirm("放弃还没保存的设置？")) {
    return;
  }
  modelScreen.classList.remove("is-open");
  modelScreen.setAttribute("aria-hidden", "true");
  promptScreen.classList.remove("is-open");
  promptScreen.setAttribute("aria-hidden", "true");
  identityScreen.classList.remove("is-open");
  identityScreen.setAttribute("aria-hidden", "true");
  webSettingsScreen.classList.remove("is-open");
  webSettingsScreen.setAttribute("aria-hidden", "true");
  imageSettingsScreen.classList.remove("is-open");
  imageSettingsScreen.setAttribute("aria-hidden", "true");
  settingsScreen.inert = false;
  if (instant) skipPanelMotionOnce(settingsScreen);
  settingsScreen.classList.remove("is-open");
  settingsScreen.setAttribute("aria-hidden", "true");
  syncInteractionState();
  const returnTarget = settingsTrigger;
  settingsTrigger = null;
  if (returnTarget instanceof HTMLElement) returnTarget.focus();
}

function saveSettings() {
  if (!updateMaxTokensUi() || !updateSearchSettingsUi()) {
    if (maxTokensValidationMessage()) maxCompletionTokensInput.focus();
    else if (boundedIntegerValidationMessage(draftWebSearchMaxUses, 1, 30)) {
      openWebSettingsScreen();
      webSearchMaxUsesInput.focus();
    } else {
      openWebSettingsScreen();
      webSearchMaxResultsInput.focus();
    }
    return;
  }
  if (settingsState() !== settingsSnapshot) {
    currentModel = draftModel || DEFAULT_MODEL;
    favoriteModels = normalizeFavorites(draftFavorites);
    reasoningEffort = draftReasoningEffort;
    promptLibrary = normalizePromptLibrary(draftPromptLibrary);
    systemPrompt = activePrompt(promptLibrary).content.trim();
    maxCompletionTokens = draftMaxCompletionTokens
      ? Number(draftMaxCompletionTokens)
      : null;
    userDisplayName = normalizeDisplayName(userDisplayNameInput.value, "你");
    assistantDisplayName = normalizeDisplayName(assistantDisplayNameInput.value, "助手");
    exportFileName = normalizeExportFileName(exportFileNameInput.value);
    webSearchMaxUses = draftWebSearchMaxUses ? Number(draftWebSearchMaxUses) : null;
    webSearchMaxResults = draftWebSearchMaxResults ? Number(draftWebSearchMaxResults) : null;
    imageQuality = normalizeImageQuality(draftImageQuality);
    swipeActions = normalizeSwipeActions(draftSwipeActions);
    localStorage.setItem(SWIPE_ACTIONS_KEY, JSON.stringify(swipeActions));
    localStorage.setItem(MODEL_KEY, currentModel);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteModels));
    localStorage.setItem(REASONING_EFFORT_KEY, reasoningEffort);
    localStorage.setItem(SYSTEM_PROMPTS_KEY, JSON.stringify(promptLibrary));
    localStorage.setItem(SYSTEM_PROMPT_KEY, systemPrompt);
    if (webSearchMaxUses === null) localStorage.removeItem(WEB_MAX_USES_KEY);
    else localStorage.setItem(WEB_MAX_USES_KEY, String(webSearchMaxUses));
    if (webSearchMaxResults === null) localStorage.removeItem(WEB_MAX_RESULTS_KEY);
    else localStorage.setItem(WEB_MAX_RESULTS_KEY, String(webSearchMaxResults));
    localStorage.setItem(IMAGE_QUALITY_KEY, imageQuality);
    localStorage.setItem(USER_NAME_KEY, userDisplayName);
    localStorage.setItem(ASSISTANT_NAME_KEY, assistantDisplayName);
    if (exportFileName) {
      localStorage.setItem(EXPORT_FILE_NAME_KEY, exportFileName);
    } else {
      localStorage.removeItem(EXPORT_FILE_NAME_KEY);
    }
    if (maxCompletionTokens === null) {
      localStorage.removeItem(MAX_COMPLETION_TOKENS_KEY);
    } else {
      localStorage.setItem(MAX_COMPLETION_TOKENS_KEY, String(maxCompletionTokens));
    }
    updateTopbar();
    updateMessageLabels();
    updateAttachmentState();
    renderConversationList();
    if (folderDetailIsOpen() && folderById(folderDetailId)) renderFolderDetail();
  }
  closeSettings({ force: true });
}
