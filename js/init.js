// 启动：先弹密码/摆好壳，存档从 IndexedDB 异步读完再画首屏。必须最后引入。
updateTopbar();
syncSidebarLayout();

// 没存过密码就先弹密码界面（密码不写在代码里，由你打开时手输一次）
if (!accessPw) showGate();
else syncInteractionState();

// 申请"持久存储"：Chrome/Android 上空间紧张时不会先清这个网址的数据；Safari 无视，不碍事
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// 读完存档才渲染会话列表和消息；孤儿图片清理也得等存档读完，不然空存档会把图全当孤儿删掉
void initializeConversationStore().then(() => {
  renderConversationList();
  renderActiveConversation();
  syncInteractionState();
  void cleanupOrphanedImageRecords().catch(() => {});
  if (conversationStoreLoadWarning) showAppStatus(conversationStoreLoadWarning);
});
