// 新内容出来时的「贴底跟随」+「回到底部」箭头。
// 在最底下：新字出来跟着往下走；往上一翻就松开、不再拽；自己翻回底部或点箭头，再跟上。
const SCROLL_FOLLOW_SLACK = 80;   // 离底部不到这么多 px 算「在底部」，箭头也只在离得更远时出现

function scrollDistanceToBottom() {
  return messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop;
}

function updateScrollBottomButton() {
  const show = scrollDistanceToBottom() > SCROLL_FOLLOW_SLACK;
  scrollBottomButton.classList.toggle("is-visible", show);
  scrollBottomButton.tabIndex = show ? 0 : -1;
}

// 流式输出、图片加载完这类「自己冒出来」的内容用它：跟随中才滚到底，否则只更新箭头
function followToBottom() {
  if (scrollFollow) scrollToBottom();
  else updateScrollBottomButton();
}

messagesEl.addEventListener("scroll", () => {
  const top = messagesEl.scrollTop;
  const distance = scrollDistanceToBottom();
  // 顺序有讲究：先认「已经在最底」（内容变短被浏览器夹到底也算），再认「往上翻」，最后才是「翻回底部附近」
  if (distance <= 1) scrollFollow = true;
  else if (top < scrollFollowLastTop - 1) scrollFollow = false;
  else if (distance <= SCROLL_FOLLOW_SLACK) scrollFollow = true;
  scrollFollowLastTop = top;
  updateScrollBottomButton();
}, { passive: true });

scrollBottomButton.addEventListener("click", () => {
  scrollFollow = true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: reduced ? "auto" : "smooth" });
});
