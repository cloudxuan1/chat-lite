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
  if (folderDetailScreen.classList.contains("is-open")) {
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
function submitGate() {
  const v = gateInput.value.trim();
  if (!v) return;
  accessPw = v;
  imageCapabilityLookupAttempted = false;
  localStorage.setItem(PW_KEY, v);
  gateInput.value = "";
  hideGate();
}
gateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitGate();
});
