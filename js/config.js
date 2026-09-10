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
