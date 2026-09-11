// 运行时状态（所有 let 变量）。新界面读写状态只走这里；加新状态先在这里声明。
// 注意：这里在页面加载时会调用上面各文件定义的 loadXxx()，所以必须排在它们之后引入。
let conversationStoreLoadWarning = "";
let conversationStoreRecoveryRaw = "";
let conversationStore = loadConversationStore();
let pending = false;        // 是否正在等回复，防止重复发送
let accessPw = localStorage.getItem(PW_KEY) || "";  // 访问密码，存在本设备浏览器
let currentModel = localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
let favoriteModels = loadFavorites();
let fetchedModels = loadModelCatalog();
let promptLibrary = loadPromptLibrary();
let systemPrompt = activePrompt(promptLibrary).content;
let reasoningEffort = loadReasoningEffort();
let maxCompletionTokens = loadMaxCompletionTokens();
let userDisplayName = normalizeDisplayName(localStorage.getItem(USER_NAME_KEY), "你");
let assistantDisplayName = normalizeDisplayName(localStorage.getItem(ASSISTANT_NAME_KEY), "助手");
let exportFileName = normalizeExportFileName(localStorage.getItem(EXPORT_FILE_NAME_KEY));
let webSearchEnabled = localStorage.getItem(WEB_KEY) !== "0";
let webSearchMaxUses = loadBoundedInteger(WEB_MAX_USES_KEY, 1, 30);
let webSearchMaxResults = loadBoundedInteger(WEB_MAX_RESULTS_KEY, 1, 25);
let imageQuality = normalizeImageQuality(localStorage.getItem(IMAGE_QUALITY_KEY));
let modelsLoadedThisPage = false;
let modelsLoading = false;
let draftModel = currentModel;
let draftFavorites = favoriteModels.map((item) => ({ ...item }));
let draftReasoningEffort = reasoningEffort;
let draftPromptLibrary = clonePromptLibrary(promptLibrary);
let draftMaxCompletionTokens = maxCompletionTokens === null ? "" : String(maxCompletionTokens);
let draftUserDisplayName = userDisplayName;
let draftAssistantDisplayName = assistantDisplayName;
let draftExportFileName = exportFileName;
let draftWebSearchMaxUses = webSearchMaxUses === null ? "" : String(webSearchMaxUses);
let draftWebSearchMaxResults = webSearchMaxResults === null ? "" : String(webSearchMaxResults);
let draftImageQuality = imageQuality;
let swipeActions = normalizeSwipeActions(parseStoredJson(SWIPE_ACTIONS_KEY, null));
let draftSwipeActions = { ...swipeActions };
let settingsSnapshot = "";
let settingsTrigger = null;
let conversationMenuId = null;
let folderMenuId = null;     // 打开了「…」菜单的文件夹
let movePickerId = null;     // 打开了「移到文件夹」选择列表的会话
let folderDetailId = null; // 打开了详情页的文件夹
let folderDetailMenuOpen = false;
let folderDetailConvMenuId = null;   // 详情页里打开了「…」的会话
let folderDetailPickerId = null;     // 详情页里打开了「移到文件夹」的会话
let folderDetailPromptOpen = false;  // 详情页里打开了「提示词」选择列表
let folderDrag = null;               // 文件夹页正在拖动排序的行
let folderPageMenuId = null;         // 文件夹页里长按/右键打开了菜单的文件夹
let folderPageSwallowClick = false;  // 长按弹出菜单后，松手带出的那一次 click 要吞掉
let renamingConversationId = null;
let conversationSidebarTrigger = null;
let pendingImages = [];
let imageProcessingQueue = Promise.resolve();
let imageProcessingJobs = 0;
let imageCapabilityLookupAttempted = false;
let messageObjectUrls = [];
let sidebarOpen = desktopSidebarMedia.matches && loadSidebarPreference();
let swipeGesture = null;    // 正在进行的滑动
let swipeOpenRow = null;    // 当前停在露出按钮状态的行
let swipeSwallowClick = false;
let folderEditorState = null;   // { resolve, commit, previewId, color, icon, previousFocus }
let folderLongPress = null;
let quoteText = "";
let quoteTimer = 0;
