// 文件夹页事件绑定：点击、长按菜单、拖动排序、详情页。
folderPageList.addEventListener("click", (event) => {
  if (folderPageSwallowClick) {
    folderPageSwallowClick = false;
    return;
  }
  const menuButton = event.target.closest(".folder-page-menu [data-action]");
  if (menuButton instanceof HTMLElement) {
    const folderId = folderPageMenuId;
    const action = menuButton.dataset.action;
    folderPageMenuId = null;
    if (action === "fp-menu-new") {
      closeFolderScreen();
      createNewConversation({ folderId });
      return;
    }
    handleFolderAction(action, folderId);
    if (folderScreenIsOpen()) renderFolderScreen();
    return;
  }
  if (folderPageMenuId) {
    // 菜单开着时点别处：只关菜单，不进详情
    folderPageMenuId = null;
    renderFolderScreen();
    return;
  }
  const row = event.target.closest('[data-action="fp-open"]');
  if (row instanceof HTMLElement && row.dataset.folderId) openFolderDetail(row.dataset.folderId);
});
// 长按行（或桌面右键）弹出文件夹菜单：按住约 450ms 且手指没挪开就算长按
function openFolderPageMenu(folderId) {
  if (pending || !folderById(folderId)) return;
  folderPageMenuId = folderId;
  renderFolderScreen();
}
let folderLongPress = null;
const cancelFolderLongPress = () => {
  if (!folderLongPress) return;
  clearTimeout(folderLongPress.timer);
  folderLongPress = null;
};
folderPageList.addEventListener("pointerdown", (event) => {
  folderPageSwallowClick = false;
  const open = event.target.closest(".folder-page-open");
  if (!open || pending || folderPageMenuId || (event.pointerType === "mouse" && event.button !== 0)) return;
  cancelFolderLongPress();
  const folderId = open.dataset.folderId;
  folderLongPress = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      folderLongPress = null;
      folderPageSwallowClick = true;
      openFolderPageMenu(folderId);
    }, 450),
  };
});
folderPageList.addEventListener("pointermove", (event) => {
  if (!folderLongPress || event.pointerId !== folderLongPress.pointerId) return;
  if (Math.hypot(event.clientX - folderLongPress.x, event.clientY - folderLongPress.y) > 10) cancelFolderLongPress();
});
folderPageList.addEventListener("pointerup", cancelFolderLongPress);
folderPageList.addEventListener("pointercancel", cancelFolderLongPress);
folderPageList.addEventListener("contextmenu", (event) => {
  const open = event.target.closest(".folder-page-open");
  if (!open) return;
  event.preventDefault();
  cancelFolderLongPress();
  if (folderPageMenuId !== open.dataset.folderId) openFolderPageMenu(open.dataset.folderId);
});
folderDetailList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-action]");
  if (!(item instanceof HTMLElement)) return;
  const action = item.dataset.action;
  const conversationId = item.dataset.conversationId;
  const rerender = () => {
    if (folderScreenIsOpen()) renderFolderScreen();
    if (folderDetailIsOpen() && folderById(folderDetailId)) renderFolderDetail();
  };
  if (action === "fd-prompt") {
    folderDetailPromptOpen = !folderDetailPromptOpen;
    folderDetailConvMenuId = null;
    folderDetailPickerId = null;
    folderDetailMenuOpen = false;
    renderFolderDetail();
    if (!folderDetailPromptOpen) folderDetailList.querySelector('[data-action="fd-prompt"]')?.focus();
  } else if (action === "fd-prompt-set") {
    folderDetailPromptOpen = false;
    setFolderPrompt(folderDetailId, item.dataset.promptId || "");
    rerender();
    folderDetailList.querySelector('[data-action="fd-prompt"]')?.focus();
  } else if (action === "fp-new") {
    const folderId = folderDetailId;
    closeFolderScreen();
    createNewConversation({ folderId });
  } else if (action === "fp-switch" && conversationId) {
    closeFolderScreen();
    switchConversation(conversationId);
  } else if (action === "fd-menu" && conversationId) {
    folderDetailPromptOpen = false;
    const closing = folderDetailConvMenuId === conversationId || folderDetailPickerId === conversationId;
    folderDetailConvMenuId = closing ? null : conversationId;
    folderDetailPickerId = null;
    folderDetailMenuOpen = false;
    renderFolderDetail();
  } else if (action === "fd-pin" && conversationId) {
    folderDetailConvMenuId = null;
    if (!toggleConversationPinned(conversationId)) rerender();
  } else if (action === "fd-rename" && conversationId) {
    folderDetailConvMenuId = null;
    const target = conversationById(conversationId);
    const raw = target ? window.prompt("会话标题", target.title) : null;
    if (raw !== null && raw.trim()) saveConversationTitle(conversationId, raw);
    rerender();
  } else if (action === "fd-move-open" && conversationId) {
    folderDetailConvMenuId = null;
    folderDetailPickerId = conversationId;
    renderFolderDetail();
  } else if (action === "move-to" && conversationId) {
    folderDetailPickerId = null;
    moveConversationToFolder(conversationId, item.dataset.folderId || "");
    rerender();
  } else if (action === "move-out" && conversationId) {
    folderDetailPickerId = null;
    moveConversationToFolder(conversationId, "");
    rerender();
  } else if (action === "move-new-folder" && conversationId) {
    folderDetailPickerId = null;
    const folder = createFolderInteractive();
    if (folder) moveConversationToFolder(conversationId, folder.id);
    rerender();
  } else if (action === "fd-delete" && conversationId) {
    folderDetailConvMenuId = null;
    deleteConversation(conversationId);
    rerender();
  }
});

// 文件夹页拖动排序：拖柄按下即开始（touch-action:none 让手指拖动不滚页面）。
// 拖动中被拖的行用 transform 1:1 跟手指走（保留按下时的抓取偏移），同组其他行按让位方向平移；
// 拖出组的边界时橡皮筋式减速；松手后先过渡落回目标槽位，再真正改 DOM 顺序并落盘。
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
function folderDragTargetOffset(drag) {
  const { heights, from, to } = drag;
  if (to === from) return 0;
  let total = 0;
  if (to > from) for (let i = from + 1; i <= to; i++) total += heights[i];
  else for (let i = to; i < from; i++) total -= heights[i];
  return total;
}
// 落位完成：清掉所有 transform / 状态类，需要时按结果改 DOM 顺序并保存
function finishFolderDrag(drag) {
  if (drag.finished) return;
  drag.finished = true;
  clearTimeout(drag.settleTimer);
  const { row, rows, from, to, card } = drag;
  row.removeEventListener("transitionend", drag.onSettled);
  row.classList.remove("is-dragging", "is-settling");
  for (const other of rows) other.style.transform = "";
  card?.classList.remove("is-reordering");
  if (folderDrag === drag) folderDrag = null;
  if (to === from) return;
  if (to > from) rows[to].after(row);
  else rows[to].before(row);
  commitFolderOrderFromDom();
}
folderPageList.addEventListener("pointerdown", (event) => {
  let handle = event.target.closest(".folder-page-handle");
  if (!handle || pending) return;
  if (folderPageMenuId) {
    folderPageMenuId = null;
    renderFolderScreen();
    return;
  }
  if (folderDrag) {
    // 上一次还在落位过渡中就又按下：先立刻结束上一次（从当前状态直接定稿），再开始新的
    if (!folderDrag.settling) return;
    const folderId = handle.closest(".folder-page-row")?.dataset.folderId;
    finishFolderDrag(folderDrag);
    // 定稿会重绘列表（保存失败也会回滚重绘），必须重新取得当前行，不能继续拖旧 DOM。
    handle = [...folderPageList.querySelectorAll(".folder-page-row")]
      .find((item) => item.dataset.folderId === folderId)?.querySelector(".folder-page-handle");
    if (!handle) return;
  }
  const row = handle.closest(".folder-page-row");
  if (!row) return;
  const rows = [...folderPageList.querySelectorAll(`.folder-page-row[data-pinned="${row.dataset.pinned}"]`)];
  const from = rows.indexOf(row);
  if (from < 0) return;
  event.preventDefault();
  // 容器不会随行重绘而被移除，连续拖动时仍能接收后续 pointermove / pointerup。
  try { folderPageList.setPointerCapture(event.pointerId); } catch { /* 不支持时靠冒泡继续拖 */ }
  const rects = rows.map((item) => item.getBoundingClientRect());
  folderDrag = {
    pointerId: event.pointerId,
    row,
    rows,
    card: row.closest(".folder-page-card"),
    tops: rects.map((rect) => rect.top),
    heights: rects.map((rect) => rect.height),
    from,
    to: from,
    startY: event.clientY,
    settling: false,
    finished: false,
  };
  folderDrag.card?.classList.add("is-reordering");
  row.classList.add("is-dragging");
});
folderPageList.addEventListener("pointermove", (event) => {
  const drag = folderDrag;
  if (!drag || drag.settling || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  const { row, rows, tops, heights, from } = drag;
  const last = rows.length - 1;
  const height = heights[from];
  let dy = event.clientY - drag.startY;
  // 组的上下边界：越界后只跟一部分，越远跟得越少
  const minDy = tops[0] - tops[from];
  const maxDy = tops[last] + heights[last] - (tops[from] + height);
  const groupHeight = tops[last] + heights[last] - tops[0];
  if (dy < minDy) dy = minDy + rubberband(dy - minDy, groupHeight);
  else if (dy > maxDy) dy = maxDy + rubberband(dy - maxDy, groupHeight);
  row.style.transform = `translateY(${dy}px)`;
  // 目标槽位：被拖的行中心越过某行原来的中心，就算换到那一边
  const center = tops[from] + height / 2 + dy;
  let to = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i !== from && tops[i] + heights[i] / 2 < center) to++;
  }
  if (to === drag.to) return;
  drag.to = to;
  for (let i = 0; i < rows.length; i++) {
    if (i === from) continue;
    let shift = 0;
    if (from < to && i > from && i <= to) shift = -height;
    else if (from > to && i >= to && i < from) shift = height;
    rows[i].style.transform = shift ? `translateY(${shift}px)` : "";
  }
});
const endFolderDrag = (event) => {
  const drag = folderDrag;
  if (!drag || drag.settling || event.pointerId !== drag.pointerId) return;
  drag.settling = true;
  const { row } = drag;
  const target = folderDragTargetOffset(drag);
  const current = row.style.transform;
  const next = target ? `translateY(${target}px)` : "";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || current === next || (!current && !next)) {
    finishFolderDrag(drag);
    return;
  }
  // 松手：从当前位置过渡到槽位，过渡结束再定稿（超时兜底，防 transitionend 不触发）
  drag.onSettled = (e) => { if (e.propertyName === "transform") finishFolderDrag(drag); };
  row.addEventListener("transitionend", drag.onSettled);
  row.classList.remove("is-dragging");
  row.classList.add("is-settling");
  row.style.transform = next;
  drag.settleTimer = setTimeout(() => finishFolderDrag(drag), 400);
};
folderPageList.addEventListener("pointerup", endFolderDrag);
folderPageList.addEventListener("pointercancel", endFolderDrag);
folderDetailMore.addEventListener("click", () => {
  folderDetailMenuOpen = !folderDetailMenuOpen;
  folderDetailConvMenuId = null;
  folderDetailPickerId = null;
  folderDetailPromptOpen = false;
  renderFolderDetail();
  if (!folderDetailMenuOpen) folderDetailMore.focus();
});
folderDetailMenuHost.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!(button instanceof HTMLElement)) return;
  folderDetailMenuOpen = false;
  handleFolderAction(button.dataset.action, folderDetailId);
  if (folderDetailIsOpen()) renderFolderDetail();
});
folderDetailBack.addEventListener("click", () => closeFolderDetail());
folderNew.addEventListener("click", () => {
  const folder = createFolderInteractive();
  if (folder) openFolderDetail(folder.id);
});
folderBack.addEventListener("click", () => closeFolderScreen());
