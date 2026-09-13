// 零依赖小工具。
// ===== 工具函数 =====
function normalizeSwipeActions(value) {
  const source = value && typeof value === "object" ? value : {};
  const pick = (item, fallback) => SWIPE_ACTION_OPTIONS.includes(item) ? item : fallback;
  return { left: pick(source.left, "pin"), right: pick(source.right, "move") };
}

function parseStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
