// 会话行左右滑（Outlook 式）：手势跟踪、露出按钮、执行动作。
// ===== 会话行左右滑（Outlook 式：左滑/右滑各绑一个动作，设置里可改）=====
const SWIPE_ACTION_META = {
  move: { label: "移到文件夹", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path></svg>' },
  delete: { label: "删除", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-2h4.6l.7 2"></path><path d="m7 7 .7 13h8.6L17 7"></path></svg>' },
  pin: { label: "置顶", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 15v6"></path></svg>' },
  rename: { label: "重命名", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"></path><path d="m13.8 7 3.2 3.2"></path></svg>' },
};
const SWIPE_REVEAL = 88;   // 滑一点松手后露出的按钮宽度

// 把会话行包成可滑动的行：动作按钮在下层贴边，行内容在上层跟手指平移
function wrapSwipeRow(content, conversation, surface) {
  const row = document.createElement("div");
  row.className = "swipe-row";
  row.dataset.conversationId = conversation.id;
  row.dataset.surface = surface;
  for (const side of ["left", "right"]) {
    const kind = swipeActions[side];
    const meta = SWIPE_ACTION_META[kind];
    if (!meta) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `swipe-action is-${kind}`;
    button.dataset.side = side;
    button.dataset.swipeAction = kind;
    button.dataset.conversationId = conversation.id;
    button.tabIndex = -1;
    button.setAttribute("aria-hidden", "true");
    const label = kind === "pin" && conversation.pinned ? "取消置顶" : meta.label;
    button.innerHTML = `${meta.icon}<span></span>`;
    button.querySelector("span").textContent = label;
    row.appendChild(button);
  }
  content.classList.add("swipe-content");
  row.appendChild(content);
  return row;
}
function resetSwipeState() {
  // 两个列表共用状态：重绘其中一个时，也要收回另一个仍在 DOM 里的行。
  if (swipeGesture) {
    const { row, pointerId } = swipeGesture;
    row.classList.remove("is-swiping", "will-commit");
    closeSwipeRow(row, false);
    try { row.releasePointerCapture(pointerId); } catch { /* 指针可能已被系统取消 */ }
  }
  closeSwipeRow(swipeOpenRow, false);
  swipeGesture = null;
  swipeOpenRow = null;
}
function setSwipeOffset(row, dx, animate) {
  const content = row.querySelector(".swipe-content");
  if (!content) return;
  row.classList.toggle("is-animating", animate);
  content.style.transform = dx ? `translateX(${dx}px)` : "";
  for (const button of row.querySelectorAll(".swipe-action")) {
    const active = button.dataset.side === "left" ? dx < 0 : dx > 0;
    button.style.width = active ? `${Math.abs(dx)}px` : "0px";
    button.classList.toggle("is-active", active);
  }
  row.classList.toggle("is-open", dx !== 0);
}
function closeSwipeRow(row = swipeOpenRow, animate = true) {
  if (!row || !row.isConnected) { if (row === swipeOpenRow) swipeOpenRow = null; return; }
  setSwipeOffset(row, 0, animate);
  row.classList.remove("will-commit");
  if (swipeOpenRow === row) swipeOpenRow = null;
}
function runSwipeAction(button) {
  const row = button.closest(".swipe-row");
  const conversationId = button.dataset.conversationId;
  const kind = button.dataset.swipeAction;
  const surface = row?.dataset.surface || "sidebar";
  if (pending) {
    announceConversation("回复完成后再操作。");
    closeSwipeRow(row);
    return;
  }
  const rerender = () => {
    renderConversationList();
    if (folderDetailIsOpen() && folderById(folderDetailId)) renderFolderDetail();
    if (folderScreenIsOpen()) renderFolderScreen();
  };
  if (kind === "move") {
    if (surface === "detail") {
      folderDetailConvMenuId = null;
      folderDetailMenuOpen = false;
      folderDetailPromptOpen = false;
      folderDetailPickerId = conversationId;
      renderFolderDetail();
    } else {
      movePickerId = conversationId;
      conversationMenuId = null;
      folderMenuId = null;
      renamingConversationId = null;
      renderConversationList();
    }
  } else if (kind === "delete") {
    deleteConversation(conversationId);
    rerender();
  } else if (kind === "pin") {
    if (!toggleConversationPinned(conversationId)) rerender();
  } else if (kind === "rename") {
    if (surface === "detail") {
      const target = conversationById(conversationId);
      const raw = target ? window.prompt("会话标题", target.title) : null;
      if (raw !== null && raw.trim()) saveConversationTitle(conversationId, raw);
      rerender();
    } else {
      conversationMenuId = null;
      folderMenuId = null;
      movePickerId = null;
      renamingConversationId = conversationId;
      renderConversationList();
    }
  } else {
    closeSwipeRow(row);
  }
}
document.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || swipeGesture) return;
  const row = event.target.closest(".swipe-row");
  if (swipeOpenRow && swipeOpenRow !== row) closeSwipeRow();
  if (!row || pending || (event.pointerType === "mouse" && event.button !== 0)) return;
  if (event.target.closest(".conversation-menu, .swipe-action, .conversation-rename-form")) return;
  if (!row.querySelector(".swipe-action")) return;
  const content = row.querySelector(".swipe-content");
  const current = content?.style.transform.match(/-?[\d.]+/);
  swipeGesture = {
    row,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    base: row === swipeOpenRow && current ? Number(current[0]) : 0,
    width: row.getBoundingClientRect().width,
    axis: null,
    dx: 0,
  };
});
document.addEventListener("pointermove", (event) => {
  const gesture = swipeGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const moveX = event.clientX - gesture.startX;
  const moveY = event.clientY - gesture.startY;
  if (!gesture.axis) {
    if (Math.hypot(moveX, moveY) < 8) return;
    // 先判断方向：竖着动就交给滚动，横着动才接管
    if (Math.abs(moveX) < Math.abs(moveY) * 1.2) { swipeGesture = null; return; }
    gesture.axis = "x";
    try { gesture.row.setPointerCapture(event.pointerId); } catch { /* 不支持时靠冒泡 */ }
    gesture.row.classList.add("is-swiping");
  }
  event.preventDefault();
  const hasLeft = Boolean(gesture.row.querySelector('.swipe-action[data-side="left"]'));
  const hasRight = Boolean(gesture.row.querySelector('.swipe-action[data-side="right"]'));
  let dx = gesture.base + moveX;
  if ((dx < 0 && !hasLeft) || (dx > 0 && !hasRight)) dx = rubberband(dx, gesture.width, 0.2);
  else if (Math.abs(dx) > gesture.width) dx = Math.sign(dx) * (gesture.width + rubberband(Math.abs(dx) - gesture.width, gesture.width));
  gesture.dx = dx;
  setSwipeOffset(gesture.row, dx, false);
  const canCommit = (dx < 0 && hasLeft) || (dx > 0 && hasRight);
  gesture.row.classList.toggle("will-commit", canCommit && Math.abs(dx) > gesture.width * 0.55);
});
const endSwipe = (event) => {
  const gesture = swipeGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  swipeGesture = null;
  if (!gesture.axis) return;
  const { row, dx, width } = gesture;
  row.classList.remove("is-swiping", "will-commit");
  // 系统接管滚动、切换应用等取消事件不是用户确认，绝不能执行快捷动作。
  if (event.type === "pointercancel") {
    closeSwipeRow(row);
    return;
  }
  // 滑完松手浏览器还会补一个 click，别让它当成点了会话
  swipeSwallowClick = true;
  window.setTimeout(() => { swipeSwallowClick = false; }, 400);
  const side = dx < 0 ? "left" : "right";
  const action = row.querySelector(`.swipe-action[data-side="${side}"]`);
  const reveal = side === "left" ? -SWIPE_REVEAL : SWIPE_REVEAL;
  if (action && Math.abs(dx) > width * 0.55) {
    // 滑过一半：停在露出状态，直接执行
    setSwipeOffset(row, reveal, true);
    swipeOpenRow = row;
    runSwipeAction(action);
  } else if (action && Math.abs(dx) > 40) {
    setSwipeOffset(row, reveal, true);
    swipeOpenRow = row;
  } else {
    closeSwipeRow(row);
  }
};
document.addEventListener("pointerup", endSwipe);
document.addEventListener("pointercancel", endSwipe);
document.addEventListener("click", (event) => {
  if (!swipeSwallowClick) return;
  if (event.target.closest(".swipe-row") && !event.target.closest(".swipe-action")) {
    swipeSwallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }
}, true);
document.addEventListener("click", (event) => {
  const button = event.target.closest(".swipe-action");
  if (!(button instanceof HTMLElement)) return;
  event.preventDefault();
  runSwipeAction(button);
});
