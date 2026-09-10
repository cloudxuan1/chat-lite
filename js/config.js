// 可配置常量：Worker 地址、默认模型、localStorage 键名。
// ===== 可配置常量 =====
// 部署 Worker 后，把下面这行换成你的 Worker 真实地址（见 worker/README.md）。
const WORKER_URL = "https://ember-proxy.claude-bflwhp.workers.dev";
const DEFAULT_MODEL = "anthropic/claude-opus-4.6";

const PW_KEY = "ember_pw";  // 访问密码在本设备浏览器的存储键
const LEGACY_CHAT_KEY = "ember_messages";
const CONVERSATIONS_KEY = "ember_conversations_v1";
const CORRUPT_CONVERSATIONS_BACKUP_KEY = "ember_conversations_v1_corrupt_backup";
const CONVERSATION_TITLE_MAX_CHARACTERS = 48;
const SIDEBAR_OPEN_KEY = "ember_sidebar_desktop_open";
const LEGACY_REASONING_KEY = "ember_reasoning";
const MODEL_KEY = "ember_model";
const FAVORITES_KEY = "ember_model_favorites";
const MODEL_CATALOG_KEY = "ember_model_catalog";
const SYSTEM_PROMPT_KEY = "ember_system_prompt";  // 旧：单份提示词；现在只作兼容镜像（写当前使用那份）
const SYSTEM_PROMPTS_KEY = "ember_system_prompts"; // 新：提示词库 { activeId, items: [{ id, name, content }] }
const REASONING_EFFORT_KEY = "ember_reasoning_effort";
const MAX_COMPLETION_TOKENS_KEY = "ember_max_completion_tokens";
const USER_NAME_KEY = "ember_user_name";
const ASSISTANT_NAME_KEY = "ember_assistant_name";
const EXPORT_FILE_NAME_KEY = "ember_export_file_name";
const LEGACY_SESSION_KEY = "ember_session_id";
const WEB_KEY = "ember_web";
const WEB_MAX_USES_KEY = "ember_web_max_uses";
const WEB_MAX_RESULTS_KEY = "ember_web_max_results";
const IMAGE_QUALITY_KEY = "ember_image_quality";
const SWIPE_ACTIONS_KEY = "ember_swipe_actions";  // 会话行左滑/右滑绑定的动作 { left, right }
const SWIPE_ACTION_OPTIONS = ["move", "delete", "pin", "rename", "none"];
// 文件夹色块：马卡龙 10 色（淡底 + 同色系深一档的线条）；没选过的文件夹按 id 哈希取一个
const FOLDER_COLORS = [
  { key: "peach", name: "蜜桃", bg: "#fde3d3", fg: "#c96a3f" },
  { key: "coral", name: "珊瑚", bg: "#fbd9d2", fg: "#c4553f" },
  { key: "sakura", name: "樱花", bg: "#f9d7e2", fg: "#bd5478" },
  { key: "lavender", name: "薰衣草", bg: "#e8dcf5", fg: "#7b5fb3" },
  { key: "sky", name: "天蓝", bg: "#d6e4f7", fg: "#4a72a8" },
  { key: "mint", name: "薄荷", bg: "#cfe9e4", fg: "#3d8a80" },
  { key: "matcha", name: "抹茶", bg: "#d8ebd0", fg: "#5a8a4a" },
  { key: "lemon", name: "柠檬", bg: "#f8efc6", fg: "#a98416" },
  { key: "cream", name: "奶油", bg: "#f1e7d6", fg: "#9a7449" },
  { key: "mist", name: "雾灰", bg: "#e0e5ec", fg: "#5b6b80" },
];
// 文件夹图标（24 viewBox 线条图标，和其他图标同一套笔触）
const FOLDER_ICONS = [
  { key: "folder", name: "文件夹", path: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" },
  { key: "briefcase", name: "工作", path: "M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7 M3 13h18" },
  { key: "book", name: "学习", path: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" },
  { key: "pen", name: "写作", path: "m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z m13.8 7 3.2 3.2" },
  { key: "code", name: "代码", path: "m8 8-4 4 4 4 m8-8 4 4-4 4 m-2-10-4 16" },
  { key: "chat", name: "闲聊", path: "M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.1A8 8 0 1 1 21 12Z" },
  { key: "heart", name: "喜欢", path: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" },
  { key: "star", name: "收藏", path: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" },
  { key: "bulb", name: "灵感", path: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1 1 1.9h5c.1-.8.4-1.4 1-1.9A6 6 0 0 0 12 3Z" },
  { key: "sparkles", name: "AI", path: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" },
  { key: "flask", name: "研究", path: "M9 3h6 M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3" },
  { key: "globe", name: "世界", path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18" },
  { key: "plane", name: "旅行", path: "M21 3 3 10l7.5 3L14 21l7-18Z M10.5 13 21 3" },
  { key: "home", name: "生活", path: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" },
  { key: "cart", name: "购物", path: "M2 3h3l2.5 12h11L21 7H6.2 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" },
  { key: "coffee", name: "咖啡", path: "M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Z M16 10h2a2 2 0 0 1 0 4h-2 M4 21h13" },
  { key: "leaf", name: "植物", path: "M5 21c0-8 4-14 14-16-1 10-6 15-14 16Z M5 21c3-5 6-8 10-11" },
  { key: "music", name: "音乐", path: "M9 18V6l11-2v12 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" },
  { key: "camera", name: "照片", path: "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" },
  { key: "film", name: "影视", path: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M7 4v16 M17 4v16 M3 9h4 M3 15h4 M17 9h4 M17 15h4" },
  { key: "game", name: "游戏", path: "M6 11h4 M8 9v4 M15 12h.01 M18 10h.01 M7 6h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5h-1l-2-2h-4l-2 2H7a5 5 0 0 1-5-5v-2a5 5 0 0 1 5-5Z" },
  { key: "gift", name: "礼物", path: "M20 12v9H4v-9 M2 7h20v5H2Z M12 7v14 M12 7c-2-3-6-3-6 0h6Zm0 0c2-3 6-3 6 0h-6Z" },
  { key: "calendar", name: "日程", path: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M3 10h18 M8 3v4 M16 3v4" },
  { key: "flag", name: "重要", path: "M5 21V4 M5 4h12l-2 4 2 4H5" },
  { key: "bookmark", name: "书签", path: "M6 3h12v18l-6-4-6 4V3Z" },
  { key: "moon", name: "夜晚", path: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" },
  { key: "sun", name: "日常", path: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 m4.9 4.9 1.4 1.4 m17.7 17.7 1.4 1.4 m4.9 19.1 1.4-1.4 m17.7 6.3 1.4-1.4" },
  { key: "paw", name: "宠物", path: "M12 20c-3.3 0-5.5-1.8-5.5-4 0-2.2 2.5-4.5 5.5-4.5s5.5 2.3 5.5 4.5c0 2.2-2.2 4-5.5 4Z M8 8.5a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z M16 8.5a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z M4 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M20 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" },
  { key: "clawd", name: "Clawd", path: "M7.5 6h9A3.5 3.5 0 0 1 20 9.5v6a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 15.5v-6A3.5 3.5 0 0 1 7.5 6Z M9.5 11v2.5 M14.5 11v2.5 M4 12.5 1.8 11 M4 12.5l-2.2 1.5 M20 12.5l2.2-1.5 M20 12.5l2.2 1.5 M8.5 19v2 M12 19v2 M15.5 19v2" },
];
function folderColorByKey(key) {
  return FOLDER_COLORS.find((item) => item.key === key) || null;
}
function folderIconByKey(key) {
  return FOLDER_ICONS.find((item) => item.key === key) || null;
}
const IMAGE_DB_NAME = "ember_images_v1";
const IMAGE_DB_STORE = "images";
const MAX_IMAGES_PER_MESSAGE = 8;
const MAX_IMAGE_BYTES_PER_MESSAGE = 6 * 1024 * 1024;
const AUTO_IMAGE_MAX_DIMENSION = 2200;
const AUTO_IMAGE_QUALITY = .88;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const EFFORT_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
