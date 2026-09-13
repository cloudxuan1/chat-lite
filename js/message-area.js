// 消息区杂项：滚到底、代码块复制、指针/键盘焦点框判定。
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 代码块右上角的「复制」：拷贝该块的原始代码
messagesEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".md-code-copy");
  if (!(button instanceof HTMLElement)) return;
  const code = button.closest("pre")?.querySelector("code")?.textContent || "";
  try {
    await writeClipboard(code);
    button.textContent = "已复制";
    button.classList.add("is-copied");
  } catch {
    button.textContent = "复制失败";
  }
  window.setTimeout(() => {
    button.textContent = "复制";
    button.classList.remove("is-copied");
  }, 1200);
});

// 记录最近一次是手指/鼠标还是键盘在操作，决定要不要画焦点框
document.addEventListener("pointerdown", () => { document.documentElement.dataset.input = "pointer"; }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Tab" || e.key.startsWith("Arrow")) document.documentElement.dataset.input = "keyboard"; }, true);
document.documentElement.dataset.input = "pointer";
