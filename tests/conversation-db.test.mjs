// No dependencies or network: node --test tests/conversation-db.test.mjs
// 会话存档的 IndexedDB 路径：迁移、读记录、打不开退回 localStorage、排队合并写盘、写失败提示、损坏备份。
// IndexedDB 本身用 readConversationStoreRecord / writeConversationStoreRecord 两个替身代替，不等于浏览器验收。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { source as script } from "./source.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `production source extraction must be unique: ${pattern}`);
  return matches[0][0];
}

const functions = [
  "createSessionId", "createConversationId", "visibleCharacters", "normalizeConversationTitle",
  "titleFromFirstMessage", "normalizeMessageAttachments", "normalizeStoredMessages",
  "normalizeMemoryContext", "normalizeMemorySteps", "normalizeVariantSteps", "normalizeToolCalls", "normalizeReasoningDetailsList", "validStoredDate",
  "createConversation", "createFolderId", "normalizeFolderName", "normalizeFolders", "folderColorByKey", "folderIconByKey",
  "isRecoverableConversationStore", "preserveCorruptConversationStore", "normalizeConversationStore",
  "loadLegacyMessages", "loadLegacySessionId", "interpretConversationStoreRaw", "corruptConversationStoreWarning",
  "loadConversationStore", "loadConversationStoreFromDb", "initializeConversationStore",
  "persistConversationStore", "scheduleConversationStoreWrite", "drainConversationStoreWrites",
].map((name) => extract(new RegExp(`^(?:async )?function ${name}\\([^]*?^}$`, "gm"))).join("\n");
const constants = [
  "CONVERSATIONS_KEY", "CORRUPT_CONVERSATIONS_BACKUP_KEY", "LEGACY_CHAT_KEY", "LEGACY_SESSION_KEY", "CONVERSATION_TITLE_MAX_CHARACTERS",
  "CONVERSATION_STORE_RECORD_ID", "CONVERSATION_STORE_BACKUP_RECORD_ID", "CONVERSATION_STORE_OPEN_TIMEOUT_MS",
  "MAX_IMAGES_PER_MESSAGE", "SUPPORTED_IMAGE_TYPES", "MEMORY_CONTEXT_MAX_CHARS", "MEMORY_TOOL_NAMES", "FOLDER_COLORS", "FOLDER_ICONS",
].map((name) => extract(new RegExp(`^const ${name} = [^]*?;$`, "gm"))).join("\n");

const date = "2026-09-01T00:00:00.000Z";
function makeStore(count = 1) {
  return {
    version: 1, activeId: "c1",
    conversations: Array.from({ length: count }, (_, i) => ({
      id: `c${i + 1}`, title: `会话 ${i + 1}`, titleSource: "manual",
      messages: [{ role: "user", content: `问 ${i + 1}` }, { role: "assistant", content: `答 ${i + 1}` }],
      sessionId: `s${i + 1}`, createdAt: date, updatedAt: date,
    })),
  };
}

function harness({ record = null, readThrows = false, readHangs = false, writeFails = () => false } = {}) {
  const storage = new Map();
  const writes = [];
  let deferred = null;
  const context = {
    console, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    conversationStore: null, conversationStoreLoadWarning: "", conversationStoreRecoveryRaw: "",
    conversationStoreBackend: "", conversationStoreReady: false, conversationStoreReadOnly: false,
    conversationStorePendingWrite: null, conversationStoreWriting: false, conversationStoreWriteFailed: false,
    status: [], showAppStatus: (message) => context.status.push(message),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { context.localWrites = (context.localWrites || 0) + 1; storage.set(key, String(value)); },
    },
    timeouts: [], setTimeout: (fn) => { context.timeouts.push(fn); return context.timeouts.length; },
    readConversationStoreRecord: async () => {
      if (readThrows) throw new Error("打不开");
      if (readHangs) return new Promise(() => {});
      return record;
    },
    writeConversationStoreRecord: async (id, value) => {
      if (writeFails(id, writes.length)) throw new Error("写失败");
      if (context.slowWrites) {
        deferred = {};
        deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
        context.deferred = deferred;
        await deferred.promise;
      }
      writes.push([id, plain(value)]);
    },
  };
  vm.createContext(context);
  vm.runInContext(`${constants}\n${functions}`, context);
  return { context, storage, writes };
}

test("解析原始存档：原样 / 部分损坏 / 完全损坏 / 空", () => {
  const { context: c } = harness();
  const canonical = JSON.stringify(makeStore());
  const good = c.interpretConversationStoreRaw(canonical);
  assert.equal(good.needsWrite, false); assert.equal(good.corruptRaw, ""); assert.equal(good.partial, false);
  assert.equal(JSON.stringify(good.store), canonical);

  const partialRaw = JSON.stringify({ ...makeStore(), conversations: [...makeStore().conversations, "垃圾"] });
  const partial = c.interpretConversationStoreRaw(partialRaw);
  assert.equal(partial.partial, true); assert.equal(partial.corruptRaw, partialRaw); assert.equal(partial.needsWrite, true);
  assert.equal(partial.store.conversations.length, 1);

  const broken = c.interpretConversationStoreRaw("{not json");
  assert.equal(broken.partial, false); assert.equal(broken.corruptRaw, "{not json"); assert.equal(broken.needsWrite, true);
  assert.equal(broken.store.conversations.length, 1);

  const empty = c.interpretConversationStoreRaw(null);
  assert.equal(empty.corruptRaw, ""); assert.equal(empty.needsWrite, true);
});

test("首次启动：IndexedDB 没记录就从 localStorage 搬一份，老键原样不动", async () => {
  const { context: c, storage, writes } = harness();
  const raw = JSON.stringify(makeStore(2));
  storage.set("ember_conversations_v1", raw);
  await c.initializeConversationStore();
  assert.equal(c.conversationStoreBackend, "indexeddb");
  assert.equal(c.conversationStoreReady, true);
  assert.equal(JSON.stringify(c.conversationStore), raw);
  assert.deepEqual(writes, [["store", JSON.parse(raw)]]);
  assert.equal(storage.get("ember_conversations_v1"), raw, "老存档留着当保险");
  assert.equal(c.localWrites, undefined, "没往 localStorage 写任何东西");
  assert.equal(c.conversationStoreLoadWarning, "");
});

test("有记录：直接用 IndexedDB 里的，不读 localStorage、不写盘", async () => {
  const stored = makeStore();
  const { context: c, storage, writes } = harness({ record: stored });
  storage.set("ember_conversations_v1", JSON.stringify(makeStore(3)));
  await c.initializeConversationStore();
  assert.equal(JSON.stringify(c.conversationStore), JSON.stringify(stored));
  assert.deepEqual(writes, []);
});

test("IndexedDB 打不开或超时：退回 localStorage 老路径并提示", async () => {
  const throwing = harness({ readThrows: true });
  throwing.storage.set("ember_conversations_v1", JSON.stringify(makeStore()));
  await throwing.context.initializeConversationStore();
  assert.equal(throwing.context.conversationStoreBackend, "local");
  assert.equal(throwing.context.conversationStoreReady, true);
  assert.equal(throwing.context.conversationStore.conversations[0].id, "c1");
  assert.match(throwing.context.conversationStoreLoadWarning, /本地数据库暂时打不开/);

  const hanging = harness({ readHangs: true });
  hanging.storage.set("ember_conversations_v1", JSON.stringify(makeStore()));
  const init = hanging.context.initializeConversationStore();
  await tick();
  assert.equal(hanging.context.timeouts.length, 1);
  hanging.context.timeouts[0]();
  await init;
  assert.equal(hanging.context.conversationStoreBackend, "local");
  assert.equal(hanging.context.conversationStore.conversations[0].id, "c1");
});

test("保存：同步返回 true、内存立刻更新、后台合并写盘只写最后一份", async () => {
  const { context: c, writes } = harness({ record: makeStore() });
  await c.initializeConversationStore();
  c.slowWrites = true;
  const v = (n) => ({ ...makeStore(), conversations: [{ ...makeStore().conversations[0], title: `第${n}版` }] });
  assert.equal(c.persistConversationStore(v(1)), true);
  assert.equal(c.conversationStore.conversations[0].title, "第1版");
  assert.equal(c.persistConversationStore(v(2)), true);
  assert.equal(c.persistConversationStore(v(3)), true);
  assert.equal(c.conversationStore.conversations[0].title, "第3版");
  await tick();
  c.deferred.resolve(); await tick(); await tick();
  c.deferred.resolve(); await tick(); await tick();
  assert.deepEqual(writes.map(([id, value]) => [id, value.conversations[0].title]), [["store", "第1版"], ["store", "第3版"]]);
  assert.equal(c.conversationStoreWriting, false);
  assert.deepEqual(c.status, []);
});

test("写盘失败：提示但不回滚，下次成功把提示清掉", async () => {
  let fail = true;
  const { context: c, writes } = harness({ record: makeStore(), writeFails: () => fail });
  await c.initializeConversationStore();
  const next = { ...makeStore(), conversations: [{ ...makeStore().conversations[0], title: "改过" }] };
  assert.equal(c.persistConversationStore(next), true);
  await tick(); await tick();
  assert.equal(c.conversationStore.conversations[0].title, "改过");
  assert.equal(c.status.at(-1), "会话没能写进本地数据库，改动先留在内存里；请下载备份后刷新重试。");
  fail = false;
  c.persistConversationStore(next);
  await tick(); await tick();
  assert.equal(c.status.at(-1), "");
  assert.equal(writes.length, 1);
});

test("存档损坏：先把原文备份进 IndexedDB 再覆盖；备份失败就只读", async () => {
  const partialRecord = { ...makeStore(), conversations: [...makeStore().conversations, "垃圾"] };
  const ok = harness({ record: partialRecord });
  await ok.context.initializeConversationStore();
  assert.deepEqual(ok.writes.map(([id]) => id), ["corrupt-backup", "store"]);
  assert.equal(ok.writes[0][1], JSON.stringify(partialRecord));
  assert.equal(ok.context.conversationStoreReadOnly, false);
  assert.match(ok.context.conversationStoreLoadWarning, /部分损坏.*已留作本机备份/);
  assert.equal(ok.context.persistConversationStore(makeStore()), true);

  const bad = harness({ record: partialRecord, writeFails: (id) => id === "corrupt-backup" });
  await bad.context.initializeConversationStore();
  assert.deepEqual(bad.writes, []);
  assert.equal(bad.context.conversationStoreReadOnly, true);
  assert.match(bad.context.conversationStoreLoadWarning, /暂不能保存/);
  assert.equal(bad.context.persistConversationStore(makeStore()), false);
  assert.match(bad.context.status.at(-1), /暂未保存/);
});
