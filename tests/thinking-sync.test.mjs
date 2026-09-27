// No dependencies or network: node --test tests/thinking-sync.test.mjs
// 思考彩蛋词库云同步：首次同步搬家/合并、合并冲突、拉取写回、离线保留、冲突二选一。
// 网络（Worker）、localStorage 和界面都是替身；只抠 thinking-words.js / thinking-sync.js 的真实函数。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { source as script } from "./source.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `production source extraction must be unique: ${pattern}`);
  return matches[0][0];
}
const fn = (name) => extract(new RegExp(`^(?:async )?function ${name}\\([^]*?^}$`, "gm"));
const code = [
  extract(/^const THINKING_SERIES = \[[^]*?^\];$/gm),
  ...["normalizeThinkingWords", "thinkingAllSeries", "thinkingLibraryDoc", "thinkingSameWords", "thinkingLocalFromDoc",
    "thinkingSyncedVersion", "applyThinkingLibraryDoc", "mergeThinkingFirstSync",
    "thinkingSyncRequest", "thinkingSyncExchange", "setThinkingSyncState", "thinkingSyncFailure", "pushThinkingLibrary",
    "pullThinkingLibrary", "resolveThinkingConflict"].map(fn),
].join("\n");

const KEYS = {
  THINKING_EGG_KEY: "egg", THINKING_TRANSLATE_KEY: "translate", THINKING_MARAUDER_KEY: "marauder",
  THINKING_SERIES_OFF_KEY: "off", THINKING_CUSTOM_KEY: "custom", THINKING_OVERRIDES_KEY: "overrides",
  THINKING_SYNC_VERSION_KEY: "syncVersion", THINKING_SYNC_DIRTY_KEY: "dirty",
};

function harness({ custom = [], overrides = {}, off = [], synced = null, dirty = false, responses = [], seriesOpen = false } = {}) {
  const storage = new Map();
  if (synced !== null) storage.set("syncVersion", String(synced));
  if (dirty) storage.set("dirty", "1");
  const requests = [];
  const statuses = [];
  const screen = { classList: { contains: () => false } };
  const seriesScreen = { classList: { contains: () => seriesOpen } };
  const rendered = [];
  const context = {
    console, JSON, Map, Set, Object, Number, String, Boolean, Date, ...KEYS,
    WORKER_URL: "https://worker.example", accessPw: "pw",
    thinkingEggEnabled: true, thinkingTranslate: true, thinkingMarauder: true,
    thinkingSeriesOff: new Set(off), thinkingCustomSeries: custom, thinkingSeriesOverrides: overrides,
    thinkingSyncEnabled: true, thinkingSyncState: "idle", thinkingSyncMessage: "", thinkingSyncConflict: null,
    thinkingSyncTimer: 0, thinkingSyncApplying: false, thinkingSyncLastPull: 0,
    thinkingSyncBusy: false, thinkingSyncEpoch: 0,
    thinkingSettingsScreen: screen, thinkingSeriesScreen: seriesScreen,
    renderThinkingSeriesScreen: () => rendered.push("series"),
    saveThinkingSeriesScreen: () => true,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    persistThinkingEntries: (entries) => { for (const [k, v] of entries) storage.set(k, v); return true; },
    notifyThinkingSettingsChanged: () => {}, renderThinkingSync: () => {}, renderThinkingSettings: () => {},
    updateThinkingSummary: () => {}, currentThinkingSeries: () => (seriesOpen ? {} : null), closeThinkingSeriesScreen: () => rendered.push("closed"),
    showAppStatus: (m) => statuses.push(m), clearTimeout: () => {}, setTimeout: () => 0,
    scheduleThinkingPush: () => requests.push({ scheduled: true }),
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const next = responses.shift();
      if (!next) throw new Error("offline");
      return { status: next.status, json: async () => next.body };
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { h: context, storage, requests, statuses, rendered };
}

const cat = { id: "custom-cat", name: "猫猫系", words: [{ en: "Purring…", zh: "呼噜呼噜中" }] };
const cloudDoc = (series, settings = { egg: true, translate: false, marauder: true }) => ({ settings, series });
const cookingDefault = (h) => h.thinkingAllSeries().find((s) => s.id === "cooking");

test("云端为空：首次同步把本机词库（含改过的内置、自定义）以版本 0 搬上去", async () => {
  const { h, storage, requests } = harness({
    custom: [cat], overrides: { cooking: { name: "厨房系" } }, off: ["dawdle"],
    responses: [{ status: 200, body: { version: 0, data: null } }, { status: 200, body: { version: 1 } }],
  });
  await h.pullThinkingLibrary();
  assert.equal(requests[0].action, "thinking-words-get");
  const save = requests[1];
  assert.equal(save.action, "thinking-words-save");
  assert.equal(save.baseVersion, 0);
  const byId = Object.fromEntries(save.data.series.map((s) => [s.id, s]));
  assert.equal(byId.cooking.name, "厨房系");
  assert.equal(byId.cooking.builtin, true);
  assert.equal(byId.dawdle.enabled, false);
  assert.equal(byId["custom-cat"].builtin, false);
  assert.equal(storage.get("syncVersion"), "1");
  assert.equal(h.thinkingSyncState, "synced");
});

test("这台设备第一次同步、云端已有词库：并入本机独有的自定义系列，同 id / 同名同词不重复", async () => {
  const dog = { id: "custom-dog", name: "狗狗系", words: [{ en: "Woofing…", zh: "汪汪中" }] };
  const twin = { id: "custom-cat2", name: "猫猫系", words: [{ en: "Purring…", zh: "呼噜呼噜中" }] };
  const { h, requests, statuses } = harness({ custom: [cat, dog, twin] });
  const cloud = cloudDoc([{ ...cookingDefault(h), builtin: true, enabled: true }, { ...cat, builtin: false, enabled: true }]);
  requests.length = 0;
  const { h: h2, requests: r2, statuses: s2 } = harness({
    custom: [cat, dog, twin],
    responses: [{ status: 200, body: { version: 5, data: cloud } }, { status: 200, body: { version: 6 } }],
  });
  await h2.pullThinkingLibrary();
  const pushed = r2[1];
  assert.equal(pushed.baseVersion, 5);
  assert.deepEqual(pushed.data.series.map((s) => s.id), ["cooking", "custom-cat", "custom-dog"]);
  assert.equal(h2.thinkingTranslate, false, "云端的开关写回本机");
  assert.deepEqual(plain(h2.thinkingCustomSeries).map((s) => s.id), ["custom-cat", "custom-dog"]);
  assert.match(s2[0], /1 个自定义系列/);
  assert.equal(h2.thinkingSyncState, "synced");
  assert.equal(statuses.length + requests.length, 0);
});

test("第一次同步时内置系列两边改得不一样：进冲突，不写本机也不上传", async () => {
  const cloud = cloudDoc([{ id: "cooking", name: "云端厨房", builtin: true, enabled: true, words: [{ en: "Baking…", zh: "烘焙中" }] }]);
  const { h, storage, requests } = harness({
    overrides: { cooking: { name: "本机厨房" } },
    responses: [{ status: 200, body: { version: 3, data: cloud } }],
  });
  await h.pullThinkingLibrary();
  assert.equal(h.thinkingSyncState, "conflict");
  assert.equal(requests.length, 1);
  assert.equal(h.thinkingSeriesOverrides.cooking.name, "本机厨房");
  assert.equal(storage.get("syncVersion"), undefined);
  // 本机显式关闭的总开关和系列，同样不能在首次搬家时被默默打开。
  const flags = harness({ off: ["cooking"] }).h;
  assert.equal(flags.mergeThinkingFirstSync(cloud).conflict, true);
  flags.thinkingSeriesOff.clear();
  flags.thinkingEggEnabled = false;
  assert.equal(flags.mergeThinkingFirstSync(cloud).conflict, true);
});

test("本机没改、云端更新了（别的设备或 MCP 改的）：写回本机，内置只记和原版不同的部分", async () => {
  const { h, storage } = harness({ synced: 2, responses: [] });
  const cooking = cookingDefault(h);
  const cloud = cloudDoc([
    { ...cooking, builtin: true, enabled: true, words: [...cooking.words, { en: "Toasting…", zh: "烤面包中" }] },
    { id: "nonsense", name: "胡言乱语系", builtin: true, enabled: false, words: h.thinkingAllSeries().find((s) => s.id === "nonsense").words },
    { ...cat, builtin: false, enabled: true },
  ]);
  h.fetch = async () => ({ status: 200, json: async () => ({ version: 4, data: cloud }) });
  await h.pullThinkingLibrary();
  assert.equal(h.thinkingSyncState, "synced");
  assert.equal(storage.get("syncVersion"), "4");
  assert.equal(h.thinkingSeriesOverrides.cooking.words.at(-1).en, "Toasting…");
  assert.equal(h.thinkingSeriesOverrides.nonsense, undefined, "和原版一样的内置系列不记覆盖");
  assert.ok(h.thinkingSeriesOff.has("nonsense"));
  assert.deepEqual(plain(h.thinkingCustomSeries), [cat]);
});

test("本机有没上传的修改、云端版本没变：直接上传", async () => {
  const { h, storage, requests } = harness({
    synced: 4, dirty: true, custom: [cat],
    responses: [{ status: 200, body: { version: 4, data: cloudDoc([]) } }, { status: 200, body: { version: 5 } }],
  });
  await h.pullThinkingLibrary();
  assert.equal(requests[1].baseVersion, 4);
  assert.equal(storage.get("syncVersion"), "5");
  assert.equal(storage.get("dirty"), "0");
});

test("两边都改了：冲突；选「用云端的」写回本机，选「用这台的」带云端版本覆盖", async () => {
  const cloud = cloudDoc([{ ...cat, name: "云端猫", builtin: false, enabled: true }]);
  const first = harness({ synced: 4, dirty: true, custom: [cat], responses: [{ status: 200, body: { version: 7, data: cloud } }] });
  await first.h.pullThinkingLibrary();
  assert.equal(first.h.thinkingSyncState, "conflict");
  assert.equal(first.h.thinkingCustomSeries[0].name, "猫猫系", "选之前本机修改原样保留");
  first.h.resolveThinkingConflict(true);
  assert.equal(first.h.thinkingCustomSeries[0].name, "云端猫");
  assert.equal(first.storage.get("syncVersion"), "7");

  const second = harness({
    synced: 4, dirty: true, custom: [cat],
    responses: [{ status: 200, body: { version: 7, data: cloud } }, { status: 200, body: { version: 8 } }],
  });
  await second.h.pullThinkingLibrary();
  second.h.resolveThinkingConflict(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(second.requests[1].baseVersion, 7);
  assert.equal(second.requests[1].data.series.find((s) => s.id === "custom-cat").name, "猫猫系");
  assert.equal(second.storage.get("syncVersion"), "8");
});

test("上传时被抢先（409）进冲突；断网标成没同步上，本机修改和标记都留着", async () => {
  const conflict = harness({ synced: 2, dirty: true, responses: [{ status: 409, body: { current: { version: 3, data: cloudDoc([]) } } }] });
  await conflict.h.pushThinkingLibrary();
  assert.equal(conflict.h.thinkingSyncState, "conflict");
  assert.equal(conflict.h.thinkingSyncConflict.version, 3);

  const offline = harness({ synced: 2, dirty: true, custom: [cat], responses: [] });
  await offline.h.pushThinkingLibrary();
  assert.equal(offline.h.thinkingSyncState, "error");
  assert.equal(offline.storage.get("dirty"), "1");
  assert.deepEqual(plain(offline.h.thinkingCustomSeries), [cat]);

  const off = harness({ responses: [{ status: 503, body: { error: "记忆库未配置" } }] });
  await off.h.pullThinkingLibrary();
  assert.equal(off.h.thinkingSyncState, "unavailable");
});

test("关了云同步：不发任何请求", async () => {
  const { h, requests } = harness({ dirty: true });
  h.thinkingSyncEnabled = false;
  await h.pullThinkingLibrary();
  await h.pushThinkingLibrary();
  assert.equal(requests.length, 0);
});

test("写回云端新版时系列详情页开着：重画详情页，免得返回时把旧输入再存回去", async () => {
  const cloud = cloudDoc([{ ...cat, words: [...cat.words, { en: "Kneading…", zh: "踩奶中" }], builtin: false, enabled: true }]);
  const { h, rendered } = harness({ synced: 1, custom: [cat], seriesOpen: true, responses: [{ status: 200, body: { version: 2, data: cloud } }] });
  await h.pullThinkingLibrary();
  assert.deepEqual(rendered, ["series"]);
  assert.equal(h.thinkingCustomSeries[0].words.length, 2);
});

test("首次合并上传失败：保留待上传标记，重试会真正上传", async () => {
  const { h, storage, requests } = harness({ custom: [cat], responses: [
    { status: 200, body: { version: 5, data: cloudDoc([]) } },
    { status: 502, body: {} },
    { status: 200, body: { version: 5, data: cloudDoc([]) } },
    { status: 200, body: { version: 6 } },
  ] });
  await h.pullThinkingLibrary();
  assert.equal(storage.get("dirty"), "1");
  await h.pullThinkingLibrary();
  assert.equal(requests.at(-1).action, "thinking-words-save");
  assert.equal(storage.get("syncVersion"), "6");
});

test("首次同步同 id 自定义系列内容不同：保留本机并交给用户选", async () => {
  const { h, requests } = harness({ custom: [cat], responses: [
    { status: 200, body: { version: 3, data: cloudDoc([{ ...cat, name: "云端猫", builtin: false, enabled: true }]) } },
  ] });
  await h.pullThinkingLibrary();
  assert.equal(h.thinkingSyncState, "conflict");
  assert.equal(h.thinkingCustomSeries[0].name, cat.name);
  assert.equal(requests.length, 1);
});

test("拉取中修改不会并发上传；返回旧云端时保留本机并报冲突", async () => {
  const { h, storage } = harness({ synced: 1 });
  let release;
  let calls = 0;
  h.fetch = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const pulling = h.pullThinkingLibrary();
  h.thinkingCustomSeries = [cat];
  storage.set("dirty", "1");
  void h.pushThinkingLibrary();
  assert.equal(calls, 1);
  release({ status: 200, json: async () => ({ version: 2, data: cloudDoc([]) }) });
  await pulling;
  assert.equal(h.thinkingSyncState, "conflict");
  assert.equal(h.thinkingCustomSeries[0].id, cat.id);
});

test("冲突待选择时不能由延迟上传绕过选择", async () => {
  const { h, requests } = harness({ synced: 1, dirty: true });
  h.thinkingSyncState = "conflict";
  await h.pushThinkingLibrary();
  assert.equal(requests.length, 0);
});

test("关闭同步后在途拉取返回：不能再覆盖本机", async () => {
  const { h, storage } = harness({ synced: 1, custom: [cat] });
  let release;
  h.fetch = () => new Promise((resolve) => { release = resolve; });
  const pulling = h.pullThinkingLibrary();
  h.thinkingSyncEnabled = false;
  release({ status: 200, json: async () => ({ version: 2, data: cloudDoc([]) }) });
  await pulling;
  assert.equal(h.thinkingCustomSeries[0].id, cat.id);
  assert.equal(storage.get("syncVersion"), "1");
});

test("关开同步后旧响应失效，新拉取才更新本机", async () => {
  const { h, storage } = harness({ synced: 1, custom: [cat] });
  const pending = [];
  h.fetch = () => new Promise((resolve) => pending.push(resolve));
  const old = h.pullThinkingLibrary();
  h.thinkingSyncEpoch += 2;
  h.thinkingSyncState = "idle";
  await h.pullThinkingLibrary(); // 原请求未结束时仍不能并发
  assert.equal(pending.length, 1);
  pending.shift()({ status: 200, json: async () => ({ version: 2, data: cloudDoc([]) }) });
  await old;
  assert.equal(storage.get("syncVersion"), "1");
  assert.equal(pending.length, 1);
  pending.shift()({ status: 200, json: async () => ({ version: 3, data: cloudDoc([{ ...cat, builtin: false, enabled: true }]) }) });
  await new Promise((r) => setImmediate(r));
  assert.equal(storage.get("syncVersion"), "3");
});

test("详情页草稿存不下：拉取不能擦除输入或确认新版本", async () => {
  const { h, storage, rendered } = harness({ synced: 1, seriesOpen: true, responses: [
    { status: 200, body: { version: 2, data: cloudDoc([]) } },
  ] });
  h.saveThinkingSeriesScreen = () => false;
  await h.pullThinkingLibrary();
  assert.equal(h.thinkingSyncState, "error");
  assert.equal(storage.get("syncVersion"), "1");
  assert.deepEqual(rendered, []);
});
