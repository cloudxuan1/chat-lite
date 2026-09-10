// No browser/network: production rendering, normalization, persistence and drag listeners
// run against a small DOM double that preserves node identity and detach/reinsert behavior.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { source as script } from "./source.mjs";
const plain = (value) => JSON.parse(JSON.stringify(value));
function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `unique production extraction: ${pattern}`);
  return matches[0][0];
}
const functions = [
  "createSessionId", "createConversationId", "visibleCharacters", "normalizeConversationTitle",
  "titleFromFirstMessage", "normalizeMessageAttachments", "normalizeStoredMessages", "validStoredDate",
  "createConversation", "createFolderId", "normalizeFolderName", "normalizeFolders",
  "normalizeConversationStore", "preserveCorruptConversationStore", "cloneConversationStore",
  "persistConversationStore", "persistFolderDraft", "renderFolderScreen", "commitFolderOrderFromDom",
].map((name) => extract(new RegExp(`^function ${name}\\([^]*?^}$`, "gm"))).join("\n");
const dragSource = extract(/^function rubberband\([^]*?^folderPageList\.addEventListener\("pointercancel", endFolderDrag\);$/gm);

// Deliberately small DOM double. Layout uses equal-height rows; CSS, native pointer
// capture/event retargeting, and touch hit-testing still require browser acceptance.
class Element {
  constructor() {
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.events = new Map();
    this.captures = [];
    this.classList = {
      add: (...names) => { this.className += ` ${names.join(" ")}`; },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((n) => !names.includes(n)).join(" "); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name),
    };
  }
  setAttribute() {}
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  detach() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  appendChild(child) { child.detach(); child.parent = this; this.children.push(child); return child; }
  replaceChildren() { this.children.forEach((child) => { child.parent = null; }); this.children = []; }
  matches(selector) {
    const [, name, pinned] = selector.match(/^\.([\w-]+)(?:\[data-pinned="(\d)"\])?$/) || [];
    return this.className.split(/\s+/).includes(name) && (pinned === undefined || this.dataset.pinned === pinned);
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { top: this.parent.children.indexOf(this) * 68, height: 68 }; }
  insertSibling(child, offset) {
    child.detach();
    child.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this) + offset, 0, child);
  }
  after(child) { this.insertSibling(child, 1); }
  before(child) { this.insertSibling(child, 0); }
  addEventListener(type, listener) { this.events.set(type, [...(this.events.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.events.set(type, (this.events.get(type) || []).filter((item) => item !== listener)); }
  setPointerCapture(id) { this.captures.push(id); }
}
function harness() {
  const date = "2026-09-01T00:00:00.000Z";
  const store = {
    version: 1, activeId: "c1",
    folders: ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, pinned: id < "d", collapsed: false, createdAt: date })),
    conversations: [{ id: "c1", title: "测试会话", titleSource: "manual", folderId: "c", sessionId: "session-1",
      createdAt: date, updatedAt: date, messages: [
        { role: "user", content: "图片", attachments: [{ id: "img-1", type: "image/png", size: 12, name: "test.png" }] },
        { role: "assistant", content: "第二版", variants: ["第一版", "第二版"], activeVariant: 1 },
      ] }],
  };
  const timers = new Map();
  let timerId = 0;
  const list = new Element();
  const context = vm.createContext({
    document: { createElement: () => new Element() }, folderPageList: list, crypto: { randomUUID },
    conversationStore: plain(store), conversationStoreRecoveryRaw: "", folderDrag: null, folderPageMenuId: null,
    pending: false, folderMenuId: null, conversationMenuId: null, movePickerId: null,
    CONVERSATIONS_KEY: "store", CORRUPT_CONVERSATIONS_BACKUP_KEY: "backup", CONVERSATION_TITLE_MAX_CHARACTERS: 48,
    MAX_IMAGES_PER_MESSAGE: 8, SUPPORTED_IMAGE_TYPES: new Set(["image/png"]),
    failWrites: false, writes: 0, persisted: plain(store), announcements: [], reducedMotion: false,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    window: { matchMedia: () => ({ matches: context.reducedMotion }) },
    folderScreenIsOpen: () => true, folderDetailIsOpen: () => false,
    renderConversationList() {}, buildFolderTile: () => new Element(),
    announceConversation: (message) => context.announcements.push(message),
    showAppStatus: (message) => { context.status = message; },
    localStorage: { setItem(key, value) {
      context.writes++;
      if (context.failWrites) throw new Error("QuotaExceededError");
      context.persisted = JSON.parse(value);
    } },
  });
  vm.runInContext(`${functions}\n${dragSource}\nrenderFolderScreen();`, context);
  const rows = () => list.querySelectorAll(".folder-page-row");
  const ids = () => rows().map((row) => row.dataset.folderId);
  const down = (id, pointerId = 1, target) => {
    const row = rows().find((item) => item.dataset.folderId === id);
    const event = { target: target || row.querySelector(".folder-page-handle"), pointerId, clientY: row.getBoundingClientRect().top + 34, preventDefault() {} };
    list.events.get("pointerdown")[0](event);
  };
  const move = (dy, pointerId = 1) => list.events.get("pointermove")[0]({ pointerId, clientY: context.folderDrag.startY + dy, preventDefault() {} });
  const up = (pointerId = 1) => list.events.get("pointerup")[0]({ pointerId });
  const settle = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  return { context, list, store, rows, ids, down, move, up, settle };
}
function expectSaved(h, order) {
  assert.deepEqual(h.ids(), order);
  assert.deepEqual(h.context.persisted.folders.map((folder) => folder.id), order);
  assert.deepEqual(plain(h.context.conversationStore), h.context.persisted);
  assert.deepEqual(h.context.persisted.conversations, h.store.conversations);
  assert.equal(new Set(order).size, h.store.folders.length);
  assert.ok(h.rows().every((row) => !row.style.transform));
  assert.ok(h.context.folderDrag === null, "drag state must be cleared");
}

for (const [id, dy, expected] of [
  ["a", 85, ["b", "a", "c", "d", "e"]],
  ["c", -150, ["c", "a", "b", "d", "e"]],
  ["e", -1000, ["a", "b", "c", "e", "d"]],
]) {
  test(`ordinary drag ${id} by ${dy}: persists only its group and preserves conversations`, () => {
    const h = harness(); h.down(id); h.move(dy); h.up(); h.settle(); expectSaved(h, expected);
  });
}

test("drag back to the same slot does not write storage", () => {
  const h = harness(); h.down("a"); h.move(90); h.move(0); h.up(); h.settle();
  expectSaved(h, ["a", "b", "c", "d", "e"]);
  assert.equal(h.context.writes, 0);
});

test("storage failure rolls the visible order back; a new drag can retry", () => {
  const h = harness(); h.context.failWrites = true;
  h.down("a"); h.move(85); h.up(); h.settle();
  expectSaved(h, ["a", "b", "c", "d", "e"]);
  assert.match(h.context.status, /本地存储已满/);
  assert.equal(h.context.announcements.length, 0);
  h.context.failWrites = false;
  h.down("a"); h.move(85); h.up(); h.settle();
  expectSaved(h, ["b", "a", "c", "d", "e"]);
});

for (const failFirstSave of [false, true]) {
  test(`second drag during settle uses live rows without adding folders (first save fails: ${failFirstSave})`, () => {
    const h = harness(); h.context.failWrites = failFirstSave;
    h.down("a"); h.move(85); h.up();
    assert.equal(h.context.folderDrag.settling, true);
    const staleHandle = h.rows().find((row) => row.dataset.folderId === "c").querySelector(".folder-page-handle");
    h.down("c", 2, staleHandle);
    assert.ok(h.rows().includes(h.context.folderDrag.row), "second drag must own a live row");
    assert.ok(h.context.folderDrag.from >= 0);
    assert.ok(h.list.captures.includes(2) || h.rows().some((row) => row.querySelector(".folder-page-handle").captures.includes(2)), "the active pointer must be captured by a connected element");
    h.context.failWrites = false;
    h.move(-150, 2); h.up(2); h.settle();
    expectSaved(h, failFirstSave ? ["c", "a", "b", "d", "e"] : ["c", "b", "a", "d", "e"]);
  });
}

test("a stale detached handle cannot start a drag", () => {
  const h = harness();
  const stale = h.rows()[0].querySelector(".folder-page-handle");
  vm.runInContext("renderFolderScreen()", h.context);
  h.down("a", 1, stale);
  assert.ok(h.context.folderDrag === null, "drag state must be cleared");
  assert.equal(h.context.writes, 0);
});

test("reduced-motion drag still persists the same result immediately", () => {
  const h = harness(); h.context.reducedMotion = true;
  h.down("a"); h.move(85); h.up(); expectSaved(h, ["b", "a", "c", "d", "e"]);
});
