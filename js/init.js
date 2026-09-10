// 启动：首屏渲染，没密码先弹密码界面。必须最后引入。
updateTopbar();
renderConversationList();
renderActiveConversation();
void cleanupOrphanedImageRecords().catch(() => {});
syncSidebarLayout();
if (conversationStoreLoadWarning) showAppStatus(conversationStoreLoadWarning);

// 没存过密码就先弹密码界面（密码不写在代码里，由你打开时手输一次）
if (!accessPw) showGate();
else syncInteractionState();
