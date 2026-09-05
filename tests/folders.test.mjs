// No dependencies or network: node --test tests/folders.test.mjs
// Runs production functions/listeners extracted from the single-page app in a VM.
// DOM, rendering, dialogs and storage are test doubles, NOT a browser/E2E test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
// Optional historical source lets us prove the regressions fail before a fix.
const html = process.env.CHAT_LITE_TEST_REF
  ? execFileSync("git", ["show", `${process.env.CHAT_LITE_TEST_REF}:index.html`], { cwd: root, encoding: "utf8" })
  : readFileSync(new URL("index.html", root), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "index.html must contain the app script");
const plain = (value) => JSON.parse(JSON.stringify(value));
const date = "2026-09-01T00:00:00.000Z";

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `production source extraction must be unique: ${pattern}`);
  return matches[0][0];
}

const functions = [
  "createSessionId", "createConversationId", "visibleCharacters", "normalizeConversationTitle",
  "titleFromFirstMessage", "normalizeMessageAttachments", "normalizeStoredMessages", "validStoredDate",
  "createConversation", "createFolderId", "normalizeFolderName", "normalizeFolders", "folderById",
  "isRecoverableConversationStore", "preserveCorruptConversationStore", "normalizeConversationStore",
  "loadConversationStore", "cloneConversationStore", "getActiveConversation", "conversationById",
  "persistConversationStore", "persistFolderDraft", "moveConversationToFolder", "createFolderInteractive",
  "renameFolder", "toggleFolderPinned", "deleteFolder", "restoreFromBackup", "createNewConversation",
  "focusConversationMore", "conversationPreview", "formatConversationTime", "buildConversationItem",
].map((name) => extract(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }$`, "gm"))).join("\n");
const constants = [
  "CONVERSATIONS_KEY", "CORRUPT_CONVERSATIONS_BACKUP_KEY", "CONVERSATION_TITLE_MAX_CHARACTERS",
  "MAX_IMAGES_PER_MESSAGE", "SUPPORTED_IMAGE_TYPES",
].map((name) => extract(new RegExp(`^  const ${name} = [^]*?;$`, "gm"))).join("\n");
const clickListener = extract(/^  conversationList\.addEventListener\("click", \(event\) => \{[^]*?^  \}\);$/gm);
const escapeListener = extract(/^  document\.addEventListener\("keydown", \(event\) => \{[^]*?^  \}\);$/gm);

function conversation(id, folderId) {
  return {
    id, title: `会话 ${id}`, titleSource: "manual",
    messages: [
      { role: "user", content: "图片说明", attachments: [{ id: "image-1", name: "test.png", type: "image/png", size: 12 }] },
      { role: "assistant", content: "第二版", variants: ["第一版", "第二版"], activeVariant: 1 },
    ],
    sessionId: `session-${id}`, createdAt: date, updatedAt: date,
    ...(folderId ? { folderId } : {}),
  };
}

function fixture() {
  return {
    version: 1, activeId: "c1",
    folders: [
      { id: "f1", name: "文件夹一", pinned: true, collapsed: false, createdAt: date },
      { id: "f2", name: "文件夹二", pinned: true, collapsed: true, createdAt: date },
      { id: "f3", name: "未置顶", pinned: false, collapsed: true, createdAt: date },
    ],
    conversations: [conversation("c1", "f1"), conversation("c2")],
  };
}

function harness(store = fixture()) {
  let context;
  const frames = [];
  const storage = new Map();
  const calls = { renders: [], announcements: [], statuses: [], backups: [], folderRenders: 0, detailRenders: 0 };
  class Element {
    dataset = {};
    attributes = {};
    children = [];
    className = "";
    classList = {
      add: (name) => { this.className += ` ${name}`; },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    focus() { context.focused = this; }
    closest() { return this; }
  }
  const entry = new Element();
  entry.dataset.action = "open-folders";
  let moreButtons = [];
  const conversationList = {
    addEventListener: (type, listener) => { conversationList[type] = listener; },
    contains: (target) => target instanceof Element,
    querySelectorAll: (selector) => {
      assert.equal(selector, ".conversation-more");
      return moreButtons;
    },
    querySelector: (selector) => {
      assert.equal(selector, '[data-action="open-folders"]');
      return entry;
    },
  };
  const document = {
    createElement: () => new Element(),
    addEventListener: (type, listener) => { document[type] = listener; },
  };
  context = vm.createContext({
    conversationStore: plain(store), conversationStoreRecoveryRaw: "", conversationStoreLoadWarning: "",
    conversationMenuId: null, movePickerId: null, folderMenuId: null, renamingConversationId: null,
    folderDetailMenuOpen: false, folderDetailId: "f1", sidebarOpen: false, pending: false,
    folderScreenOpen: false, folderDetailOpen: false, failWrites: false, failOnWrite: 0, writeCount: 0, promptResult: null,
    confirmResult: true, focused: null, conversationList, document, HTMLElement: Element,
    crypto: { randomUUID },
    window: {
      requestAnimationFrame: (callback) => frames.push(callback),
      prompt: () => context.promptResult,
      confirm: () => context.confirmResult,
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        context.writeCount++;
        if (context.failWrites || context.writeCount === context.failOnWrite) throw new Error("QuotaExceededError");
        storage.set(key, String(value));
      },
    },
    folderScreenIsOpen: () => context.folderScreenOpen,
    folderDetailIsOpen: () => context.folderDetailOpen,
    renderFolderScreen: () => { calls.folderRenders++; },
    renderFolderDetail: () => { calls.detailRenders++; },
    renderConversationList: () => {
      calls.renders.push([context.conversationMenuId, context.movePickerId, context.folderMenuId]);
      moreButtons = context.conversationStore.conversations.filter((item) => {
        const folder = context.conversationStore.folders?.find((folder) => folder.id === item.folderId);
        return !folder || (folder.pinned && !folder.collapsed);
      }).map((item) => {
        const button = new Element();
        button.dataset.conversationId = item.id;
        return button;
      });
    },
    renderActiveConversation: () => {},
    buildMovePicker: () => new Element(),
    announceConversation: (message) => calls.announcements.push(message),
    showAppStatus: (message) => calls.statuses.push(message),
    setBackupStatus: (message) => calls.backups.push(message),
    mergePromptLibraryFromBackup: () => 0,
    desktopSidebarMedia: { matches: true }, input: new Element(),
  });
  for (const name of ["folderDetailScreen", "folderScreen", "modelScreen", "promptScreen", "identityScreen",
    "webSettingsScreen", "imageSettingsScreen", "settingsScreen", "quickPanel"]) context[name] = new Element();
  vm.runInContext(`${constants}\n${functions}\n${clickListener}\n${escapeListener}`, context);
  const key = vm.runInContext("CONVERSATIONS_KEY", context);
  storage.set(key, JSON.stringify(store));
  const flush = () => { while (frames.length) frames.shift()(); };
  return {
    context, calls, storage, key, entry, flush,
    click(action, id = "c1", folderId = "") {
      const target = new Element();
      target.dataset = { action, conversationId: id, folderId };
      conversationList.click({ target });
      flush();
    },
    async restore(backupStore) {
      const button = new Element();
      await context.restoreFromBackup({ text: async () => JSON.stringify({ app: "chat-lite", store: backupStore }) }, button);
      assert.equal(button.disabled, false);
      assert.doesNotMatch(calls.backups.at(-1), /恢复失败/);
    },
  };
}

test("the complete inline application script parses", () => { new vm.Script(script); });

for (const [name, target] of [["pinned to pinned", "f2"], ["same folder", "f1"], ["move out", ""], ["unpinned destination", "f3"]]) {
  test(`move: ${name} saves, closes all menus before rendering and restores focus`, () => {
    const h = harness();
    const { context: c } = h;
    const before = plain(c.conversationStore.conversations[0]);
    c.movePickerId = "c1";
    c.folderScreenOpen = c.folderDetailOpen = true;
    h.click(target ? "move-to" : "move-out", "c1", target);
    assert.deepEqual(h.calls.renders, [[null, null, null]]);
    assert.equal(c.movePickerId, null);
    const expected = { ...before };
    if (target) expected.folderId = target;
    else delete expected.folderId;
    assert.deepEqual(plain(c.conversationStore.conversations[0]), expected);
    assert.deepEqual(JSON.parse(h.storage.get(h.key)), plain(c.conversationStore));
    if (target) assert.equal(c.folderById(target).collapsed, false);
    assert.equal(c.focused, target === "f3" ? h.entry : c.conversationList.querySelectorAll(".conversation-more")[0]);
    assert.equal(h.calls.folderRenders, 1);
    assert.equal(h.calls.detailRenders, 1);
  });
}

test("failed move keeps storage, memory and picker intact; retry succeeds", () => {
  const h = harness();
  const { context: c } = h;
  const before = JSON.stringify(c.conversationStore);
  c.movePickerId = "c1";
  c.failWrites = true;
  h.click("move-to", "c1", "f2");
  assert.equal(JSON.stringify(c.conversationStore), before);
  assert.equal(h.storage.get(h.key), before);
  assert.equal(c.movePickerId, "c1");
  assert.equal(h.calls.renders.length, 0);
  assert.equal(h.calls.announcements.length, 0);
  assert.match(h.calls.statuses.at(-1), /存储已满/);
  c.failWrites = false;
  h.click("move-to", "c1", "f2");
  assert.equal(c.movePickerId, null);
  assert.equal(c.conversationById("c1").folderId, "f2");
});

test("pending reply and stale destinations cannot move or unclassify a conversation", () => {
  const h = harness();
  const before = JSON.stringify(h.context.conversationStore);
  h.context.pending = true;
  h.click("move-to", "c1", "f2");
  h.context.pending = false;
  h.click("move-to", "c1", "missing-folder");
  h.click("move-to", "missing-conversation", "f2");
  assert.equal(JSON.stringify(h.context.conversationStore), before);
  assert.equal(h.calls.renders.length, 0);
});

test("new-folder move closes the picker and focuses the folder entry", () => {
  const h = harness();
  h.context.movePickerId = "c1";
  h.context.promptResult = "新文件夹";
  h.click("move-new-folder");
  const added = h.context.conversationStore.folders.at(-1);
  assert.equal(added.name, "新文件夹");
  assert.equal(h.context.conversationById("c1").folderId, added.id);
  assert.equal(h.context.movePickerId, null);
  assert.equal(h.context.focused, h.entry);
});

for (const failOnWrite of [1, 2]) {
  test(`new-folder move remains retryable when save ${failOnWrite} fails`, () => {
    const h = harness();
    const c = h.context;
    c.movePickerId = "c1";
    c.promptResult = "新文件夹";
    c.failOnWrite = failOnWrite;
    h.click("move-new-folder");
    assert.equal(c.conversationById("c1").folderId, "f1");
    assert.equal(c.movePickerId, "c1");
    assert.equal(c.conversationStore.folders.length, failOnWrite === 1 ? 3 : 4);
    assert.equal(h.calls.announcements.some((message) => message.startsWith("已移到")), false);
    assert.deepEqual(JSON.parse(h.storage.get(h.key)), plain(c.conversationStore));
    c.failOnWrite = 0;
    h.click("move-to", "c1", c.conversationStore.folders.at(-1).id);
    assert.equal(c.movePickerId, null);
  });
}

for (const promptResult of [null, "   "]) {
  test(`cancel/empty new folder leaves the move picker available (${JSON.stringify(promptResult)})`, () => {
    const h = harness();
    h.context.movePickerId = "c1";
    h.context.promptResult = promptResult;
    const before = JSON.stringify(h.context.conversationStore);
    h.click("move-new-folder");
    assert.equal(JSON.stringify(h.context.conversationStore), before);
    assert.equal(h.context.movePickerId, "c1");
  });
}

test("more button closes its own picker or replaces another conversation/folder menu", () => {
  const h = harness();
  const c = h.context;
  c.movePickerId = "c1";
  h.click("menu");
  assert.deepEqual(h.calls.renders.at(-1), [null, null, null]);
  assert.equal(c.focused.dataset.conversationId, "c1");
  c.movePickerId = "c2";
  h.click("menu");
  assert.deepEqual(h.calls.renders.at(-1), ["c1", null, null]);
  c.conversationMenuId = null;
  c.folderMenuId = "f2";
  h.click("menu");
  assert.deepEqual(h.calls.renders.at(-1), ["c1", null, null]);
  h.click("menu");
  assert.deepEqual(h.calls.renders.at(-1), [null, null, null]);
});

for (const mode of ["closed", "normal menu", "move picker"]) {
  test(`more button aria-expanded matches ${mode}`, () => {
    const { context: c } = harness();
    if (mode === "normal menu") c.conversationMenuId = "c1";
    if (mode === "move picker") c.movePickerId = "c1";
    const item = c.buildConversationItem(c.conversationById("c1"));
    const more = item.children.find((child) => child.className === "conversation-more");
    assert.equal(more.attributes["aria-expanded"], String(mode !== "closed"));
  });
}

test("Escape closes the move picker and returns focus to its trigger", () => {
  const h = harness();
  h.context.movePickerId = "c1";
  h.context.document.keydown({ key: "Escape" });
  h.flush();
  assert.equal(h.context.movePickerId, null);
  assert.equal(h.context.focused?.dataset.conversationId, "c1");
});

test("canonical pre-folder storage loads byte-for-byte without a corruption warning", () => {
  const store = { version: 1, activeId: "c1", conversations: [conversation("c1")] };
  const h = harness(store);
  assert.equal(JSON.stringify(h.context.loadConversationStore()), JSON.stringify(store));
  assert.equal(h.storage.get(h.key), JSON.stringify(store));
  assert.equal(h.context.conversationStoreLoadWarning, "");
  assert.equal(h.storage.size, 1);
});

test("missing folder references become unclassified without losing messages, image metadata or variants", () => {
  const h = harness();
  const input = { version: 1, activeId: "c1", conversations: [conversation("c1", "missing")] };
  const output = plain(h.context.normalizeConversationStore(input));
  assert.deepEqual(output.conversations, [conversation("c1")]);
  assert.equal("folders" in output, false);
});

test("deleting a folder only unclassifies members; cancellation/failure is non-destructive", () => {
  const h = harness();
  const before = JSON.stringify(h.context.conversationStore);
  h.context.confirmResult = false;
  h.context.deleteFolder("f1");
  assert.equal(JSON.stringify(h.context.conversationStore), before);
  h.context.confirmResult = true;
  h.context.failWrites = true;
  h.context.deleteFolder("f1");
  assert.equal(JSON.stringify(h.context.conversationStore), before);
  h.context.failWrites = false;
  h.context.deleteFolder("f1");
  assert.equal(h.context.folderById("f1"), null);
  assert.deepEqual(plain(h.context.conversationStore.conversations), [conversation("c1"), conversation("c2")]);
  assert.equal(h.context.conversationStore.activeId, "c1");
});

test("renaming and pinning folders preserve conversations and persist folder state", () => {
  const h = harness();
  const before = plain(h.context.conversationStore.conversations);
  h.context.promptResult = " 新名字 ";
  h.context.renameFolder("f1");
  h.context.toggleFolderPinned("f1");
  assert.equal(h.context.folderById("f1").name, "新名字");
  assert.equal(h.context.folderById("f1").pinned, false);
  assert.equal(h.context.folderById("f1").collapsed, true);
  h.context.toggleFolderPinned("f1");
  assert.equal(h.context.folderById("f1").collapsed, false);
  assert.deepEqual(plain(h.context.conversationStore.conversations), before);
  assert.deepEqual(JSON.parse(h.storage.get(h.key)), plain(h.context.conversationStore));
});

test("new conversations inherit the active folder; explicit destination overrides it", () => {
  const h = harness();
  h.context.createNewConversation();
  const created = h.context.getActiveConversation();
  assert.equal(created.folderId, "f1");
  assert.notEqual(created.sessionId, "session-c1");
  assert.equal(h.context.conversationStore.conversations.length, 3);
  h.context.createNewConversation({ folderId: "f2" });
  assert.equal(h.context.getActiveConversation().id, created.id, "reuse the blank default conversation");
  assert.equal(h.context.getActiveConversation().folderId, "f2");
  assert.equal(h.context.conversationStore.conversations.length, 3);
});

test("reusing a blank conversation does not change its folder when storage is full", () => {
  const h = harness();
  h.context.createNewConversation();
  const before = JSON.stringify(h.context.conversationStore);
  h.context.failWrites = true;
  h.context.createNewConversation({ folderId: "f2" });
  assert.equal(JSON.stringify(h.context.conversationStore), before);
  assert.equal(h.storage.get(h.key), before);
  assert.match(h.calls.statuses.at(-1), /存储已满/);
});

test("backup restore adds new folders/conversations, but keeps existing content and intentional classification", async () => {
  const h = harness();
  const existing = plain(h.context.conversationStore.conversations);
  const backup = fixture();
  backup.folders[0].name = "旧名字";
  backup.conversations[0].folderId = "f2";
  backup.conversations[1].folderId = "f1"; // The existing c2 was deliberately moved out locally.
  backup.folders.push({ id: "f4", name: "导入", pinned: false, collapsed: false, createdAt: date });
  backup.conversations.push(conversation("c3", "f4"));
  await h.restore(backup);
  assert.deepEqual(plain(h.context.conversationStore.conversations.slice(0, 2)), existing);
  assert.equal(h.context.folderById("f1").name, "文件夹一");
  assert.deepEqual(plain(h.context.conversationById("c3")), conversation("c3", "f4"));
  const once = JSON.stringify(h.context.conversationStore);
  await h.restore(backup);
  assert.equal(JSON.stringify(h.context.conversationStore), once);
  assert.match(h.calls.backups.at(-1), /已恢复 0 个对话/);
});

test("pre-folder backups remain importable", async () => {
  const h = harness();
  await h.restore({ version: 1, activeId: "old", conversations: [conversation("old")] });
  assert.deepEqual(plain(h.context.conversationById("old")), conversation("old"));
  assert.equal(h.context.conversationStore.folders.length, 3);
});
