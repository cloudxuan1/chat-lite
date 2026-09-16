// 访问密码界面。
// ===== 访问密码界面 =====
function showGate(msg) {
  gate.style.display = "flex";
  gateErr.textContent = msg || "";
  syncInteractionState();
  gateInput.focus();
}
function focusActiveLayerAfterGate() {
  let target = input;
  if (folderEditorIsOpen()) {
    target = folderEditorName;
  } else if (folderDetailScreen.classList.contains("is-open")) {
    target = folderDetailBack;
  } else if (folderScreen.classList.contains("is-open")) {
    target = folderBack;
  } else if (modelScreen.classList.contains("is-open")) {
    target = modelBack;
  } else if (promptScreen.classList.contains("is-open")) {
    target = promptBack;
  } else if (identityScreen.classList.contains("is-open")) {
    target = identityBack;
  } else if (webSettingsScreen.classList.contains("is-open")) {
    target = webSettingsBack;
  } else if (imageSettingsScreen.classList.contains("is-open")) {
    target = imageSettingsBack;
  } else if (settingsScreen.classList.contains("is-open")) {
    target = settingsBack;
  } else if (sidebarOpen && !desktopSidebarMedia.matches) {
    target = conversationList.querySelector('[aria-current="page"]') || conversationClose;
  }
  window.requestAnimationFrame(() => target.focus());
}
function hideGate() {
  gate.style.display = "none";
  syncInteractionState();
  focusActiveLayerAfterGate();
}
// 向 Worker 验密码：401 = 密码错；其他 2xx/4xx 都算对（旧版 Worker 没有 verify 会回 400，但密码错仍先 401）；
// 5xx 和网络断都抛错，让门禁提示重试而不是放行。
async function verifyAccessPassword(password) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", password }),
  });
  if (response.status === 401) return false;
  if (response.status >= 500) throw new Error(`服务返回 ${response.status}`);
  return true;
}
function setGateVerifying(on) {
  gateVerifying = on;
  gateInput.disabled = on;
  gateBtn.disabled = on;
  gateErr.classList.toggle("is-pending", on);
  gateErr.textContent = on ? "验证中…" : "";
}
async function submitGate() {
  if (gateVerifying) return;
  const v = gateInput.value.trim();
  if (!v) return;
  setGateVerifying(true);
  let ok = false;
  try {
    ok = await verifyAccessPassword(v);
  } catch {
    setGateVerifying(false);
    gateErr.textContent = "连不上服务器，请检查网络后重试";
    gateInput.focus();
    return;
  }
  setGateVerifying(false);
  if (!ok) {
    gateErr.textContent = "密码错误，请重新输入";
    gateInput.value = "";
    gateInput.focus();
    return;
  }
  accessPw = v;
  imageCapabilityLookupAttempted = false;
  localStorage.setItem(PW_KEY, v);
  gateInput.value = "";
  hideGate();
}
gateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitGate();
});
