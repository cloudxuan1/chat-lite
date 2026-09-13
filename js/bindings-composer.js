// 输入栏事件绑定：提交、自动长高、粘贴/附件图片、回车发送。
// ===== 交互绑定 =====
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});

// 输入框随内容自动长高
input.addEventListener("input", () => {
  // 只剩空白（比如把引用块删光只剩换行）就清空，占位文字和高度都回来
  if (input.value && !input.value.trim()) input.value = "";
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
  updateConversationActionState();
});
input.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  queueImageFiles(files);
});
imageAttach.addEventListener("click", () => imageFileInput.click());
imageFileInput.addEventListener("change", () => queueImageFiles(imageFileInput.files || []));
composerAttachments.addEventListener("click", (event) => {
  const remove = event.target.closest(".composer-image-remove");
  if (!remove) return;
  removePendingImage(remove.dataset.imageId);
});

// 桌面端：回车发送、Shift+回车换行；触屏设备保持回车换行，靠按钮发送
const isTouch = window.matchMedia("(pointer: coarse)").matches;
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !isTouch) {
    e.preventDefault();
    send();
  }
});
