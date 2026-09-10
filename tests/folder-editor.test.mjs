// Real editor, save functions, normalization and document handlers in a VM.
// DOM, layout, frame/timer scheduling and storage are doubles, not browser tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
// Production source = the js/ files index.html loads, in order (see tests/source.mjs).
import { source as script } from './source.mjs';

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `unique production extraction: ${pattern}`);
  return matches[0][0];
}
const functions = ['folderColorByKey', 'folderIconByKey', 'folderTileColor', 'folderTileIcon', 'buildFolderTile',
  'normalizeFolderName', 'normalizeFolders', 'validStoredDate', 'folderById', 'createFolderInteractive', 'editFolder',
  'syncInteractionState', 'focusActiveLayerAfterGate']
  .map(name => extract(new RegExp(`^(?:async )?function ${name}\\([^]*?^}$`, 'gm'))).join('\n');
const constants = ['FOLDER_COLORS', 'FOLDER_ICONS']
  .map(name => extract(new RegExp(`^const ${name} = \\[[^]*?^\\];$`, 'gm'))).join('\n');
const editor = script.slice(script.indexOf('const folderEditor ='), script.indexOf('async function createFolderInteractive'));
const outside = extract(/^document\.addEventListener\("click", \(event\) => \{\n  if \(!event\.composedPath\(\)[^]*?^\}\);$/gm);
const detailClick = extract(/^folderDetailList\.addEventListener\("click", \(event\) => \{[^]*?^\}\);$/gm);
const plain = v => JSON.parse(JSON.stringify(v));

function harness({ mobile = false } = {}) {
  const nodes = new Map(), frames = [], timers = [], events = new Map();
  const document = { activeElement: null, getElementById: id => nodes.get(id), createElement: tag => new Element('', tag),
    addEventListener: (type, fn) => events.set(type, [...(events.get(type) || []), fn]), querySelector: () => null };
  class Element {
    constructor(id = '', tag = 'div') {
      this.id = id; this.tagName = tag.toUpperCase(); this.children = []; this.parent = null;
      this.dataset = {}; this.attributes = {}; this.hidden = false; this.inert = false; this.disabled = false;
      this.className = ''; this.value = ''; this.textContent = ''; this.events = new Map(); this.isConnected = true;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = { contains: name => this.className.split(' ').includes(name),
        add: (...names) => { this.className += ' ' + names.join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(n => !names.includes(n)).join(' '); } };
      if (id) nodes.set(id, this);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    replaceChildren(...children) { this.children.forEach(c => { c.isConnected = false; c.parent = null; }); this.children = []; children.forEach(c => this.appendChild(c)); }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    matches(selector) {
      return selector.split(',').some(s => {
        s = s.trim();
        if (s === '[inert]') return this.inert;
        if (s === '[data-action]') return Boolean(this.dataset.action);
        if (s.startsWith('#')) return this.id === s.slice(1);
        if (s.startsWith('.')) return this.classList.contains(s.slice(1));
        const tag = s.match(/^(button|input|select)(:not\(\[disabled\]\))?$/);
        return tag && this.tagName === tag[1].toUpperCase() && (!tag[2] || !this.disabled);
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    focus() { if (this.isConnected && !this.closest('[inert]')) document.activeElement = this; }
    select() { this.selectCount = (this.selectCount || 0) + 1; }
    addEventListener(type, fn) { this.events.set(type, [...(this.events.get(type) || []), fn]); }
  }
  document.body = new Element('body'); document.activeElement = document.body;
  const appShell = document.body.appendChild(new Element('app-shell'));
  const chatShell = appShell.appendChild(new Element('chat-shell'));
  const sidebar = appShell.appendChild(new Element('conversation-sidebar'));
  const modal = document.body.appendChild(new Element('folder-editor')); modal.className = 'folder-editor'; modal.hidden = true;
  const form = modal.appendChild(new Element('folder-editor-form', 'form'));
  for (const [id, tag] of [['title', 'h3'], ['preview', 'span'], ['name', 'input'], ['colors', 'div'], ['icons', 'div'],
    ['prompt', 'select'], ['error', 'p'], ['cancel', 'button'], ['save', 'button']]) {
    const el = form.appendChild(new Element(`folder-editor-${id}`, tag)); el.className = `folder-editor-${id}`;
  }
  modal.appendChild(new Element('folder-editor-scrim'));
  const previous = sidebar.appendChild(new Element('trigger', 'button'));
  document.activeElement = previous;
  const date = '2026-09-08T00:00:00.000Z';
  const store = { version: 1, activeId: 'c1', folders: [{ id: 'f1', name: '原名', pinned: true, collapsed: false,
    createdAt: date, color: 'peach', icon: 'book', promptId: 'p2' }],
    conversations: [{ id: 'c1', folderId: 'f1', sessionId: 'test-session', messages: [{ role: 'assistant', content: '保留消息' }] }] };
  let nextId = 0;
  const c = vm.createContext({ document, HTMLElement: Element, appShell, chatShell, conversationSidebar: sidebar,
    conversationStore: plain(store), pending: false, failWrites: false, writes: 0, persisted: plain(store),
    promptLibrary: { activeId: 'p1', items: [{ id: 'p1', name: '默认', content: '' }, { id: 'p2', name: '测试', content: 'test' }] },
    activePrompt: lib => lib.items.find(p => p.id === lib.activeId), createFolderId: () => `f_test_${++nextId}`,
    cloneConversationStore: () => plain(c.conversationStore),
    persistFolderDraft: draft => {
      if (c.failWrites) return false;
      draft.folders = c.normalizeFolders(draft.folders, date);
      c.writes++; c.conversationStore = plain(draft); c.persisted = plain(draft); return true;
    },
    announceConversation() {}, hideQuotePill() {}, closeQuickPanel() {}, renderConversationList() {}, renderFolderDetail() {}, renderFolderScreen() {},
    folderDetailMenuOpen: false, folderPageMenuId: null, folderDetailPromptOpen: false, folderDetailConvMenuId: null,
    folderDetailPickerId: null, conversationMenuId: null, folderMenuId: null, movePickerId: null, folderDetailId: 'f1',
    folderDetailList: new Element('folder-detail-list'),
    conversationById: id => c.conversationStore.conversations.find(item => item.id === id),
    moveConversationToFolder: (id, folderId) => { if (!c.failMove) c.conversationById(id).folderId = folderId; },
    folderScreenIsOpen: () => false, folderDetailIsOpen: () => false,
    anySettingsScreenOpen: () => c.settingsOpen, settingsOpen: false, gateIsOpen: () => c.gateOpen, gateOpen: false,
    sidebarOpen: true, desktopSidebarMedia: { matches: !mobile },
    requestAnimationFrame: fn => frames.push(fn),
    window: { requestAnimationFrame: fn => frames.push(fn), setTimeout: fn => timers.push(fn), matchMedia: () => ({ matches: false }) },
  });
  for (const name of ['topbarEl', 'messagesEl', 'composer', 'input', 'folderDetailScreen', 'folderScreen', 'modelScreen',
    'promptScreen', 'identityScreen', 'webSettingsScreen', 'imageSettingsScreen', 'settingsScreen', 'folderDetailBack',
    'folderBack', 'modelBack', 'promptBack', 'identityBack', 'webSettingsBack', 'imageSettingsBack', 'settingsBack', 'conversationClose']) {
    c[name] = chatShell.appendChild(new Element(name, name.endsWith('Screen') ? 'section' : 'button'));
  }
  c.conversationList = sidebar;
  vm.runInContext(constants + '\n' + functions + '\n' + editor + '\n' + outside + '\n' + detailClick, c);
  const emit = (id, type, values = {}) => {
    const target = typeof id === 'string' ? nodes.get(id) : id;
    const e = { target, key: '', shiftKey: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
      composedPath() { return [target]; }, ...values };
    for (let node = target; node; node = node.parent) {
      for (const fn of node.events.get(type) || []) fn(e);
      if (e.stopped) return e;
    }
    for (const fn of events.get(type) || []) fn(e);
    return e;
  };
  return { c, nodes, previous, modal, form, store, emit, frame: () => { for (const fn of frames.splice(0)) fn(); },
    timers: () => { for (const fn of timers.splice(0)) fn(); },
    state: () => vm.runInContext('folderEditorState', c),
    submit(name = '新名字') { nodes.get('folder-editor-name').value = name; emit('folder-editor-name', 'input'); emit('folder-editor-form', 'submit'); },
    pick(group, key) { const el = nodes.get(`folder-editor-${group}s`).children.find(b => b.dataset[group] === key); emit(el, 'click'); },
  };
}

test('new automatic color uses exactly the preview identity after save', async () => {
  const h = harness(); const done = h.c.createFolderInteractive(); h.frame();
  const id = h.state().previewId; const color = h.c.folderTileColor({ id });
  h.submit(); const folder = await done;
  assert.equal(folder.id, id); assert.deepEqual(plain(h.c.folderTileColor(folder)), plain(color));
  assert.equal(folder.color, undefined); assert.equal(h.c.writes, 1);
});

test('real editor saves all selections together and preserves conversations', async () => {
  const h = harness(); const done = h.c.editFolder('f1'); h.frame();
  assert.equal(h.nodes.get('folder-editor-name').value, '原名');
  assert.equal(h.nodes.get('folder-editor-prompt').value, 'p2');
  h.pick('color', 'mint'); h.pick('icon', 'clawd'); h.nodes.get('folder-editor-prompt').value = 'p1';
  h.submit(' 编辑后 '); assert.equal(await done, true);
  assert.deepEqual(h.c.persisted.folders[0], { ...h.store.folders[0], name: '编辑后', color: 'mint', icon: 'clawd', promptId: 'p1' });
  assert.deepEqual(h.c.persisted.conversations, h.store.conversations);
});

test('failed create keeps draft and Promise open; retry saves once with the same identity', async () => {
  const h = harness(); h.c.failWrites = true; const done = h.c.createFolderInteractive(); h.frame();
  const id = h.state().previewId; h.pick('color', 'sakura'); h.pick('icon', 'heart'); h.submit('保留草稿');
  assert.equal(h.c.folderEditorIsOpen(), true); assert.match(h.nodes.get('folder-editor-error').textContent, /未能保存/);
  assert.equal(h.nodes.get('folder-editor-name').value, '保留草稿'); assert.equal(h.state().icon, 'heart');
  assert.deepEqual(h.c.persisted, h.store); h.c.failWrites = false; h.submit('保留草稿');
  const folder = await done; assert.equal(folder.id, id); assert.equal(folder.color, 'sakura'); assert.equal(h.c.writes, 1);
  h.emit('folder-editor-form', 'submit'); assert.equal(h.c.writes, 1);
});

test('failed edit preserves every draft field; cancellation leaves stored folder unchanged', async () => {
  const h = harness(); h.c.failWrites = true; const done = h.c.editFolder('f1'); h.frame();
  h.pick('color', 'mint'); h.pick('icon', 'paw'); h.submit('未保存');
  assert.equal(h.c.folderEditorIsOpen(), true); assert.equal(h.state().color, 'mint');
  assert.equal(h.state().icon, 'paw'); assert.equal(h.nodes.get('folder-editor-prompt').value, 'p2');
  h.emit('folder-editor-cancel', 'click'); assert.equal(await done, false); assert.deepEqual(h.c.persisted, h.store);
});

test('deselect color, default icon and follow-settings omit optional keys', async () => {
  const h = harness(); const done = h.c.editFolder('f1'); h.frame();
  h.pick('color', 'peach'); h.pick('icon', 'folder'); h.nodes.get('folder-editor-prompt').value = '';
  h.submit(); assert.equal(await done, true);
  for (const key of ['color', 'icon', 'promptId']) assert.equal(Object.hasOwn(h.c.persisted.folders[0], key), false);
});

for (const mobile of [false, true]) test(`modal isolates background and wraps Tab (mobile: ${mobile})`, async () => {
  const h = harness({ mobile }); const done = h.c.openFolderEditor(); h.frame();
  assert.equal(h.c.appShell.inert, true); assert.equal(h.modal.inert, false);
  const e = h.emit('folder-editor-name', 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(e.prevented, true); assert.equal(h.c.document.activeElement, h.nodes.get('folder-editor-cancel'));
  const forward = h.emit('folder-editor-cancel', 'keydown', { key: 'Tab' });
  assert.equal(forward.prevented, true); assert.equal(h.c.document.activeElement, h.nodes.get('folder-editor-name'));
  h.emit('folder-editor-cancel', 'click'); await done; h.frame();
  assert.equal(h.c.appShell.inert, false); assert.equal(h.c.chatShell.inert, mobile); assert.equal(h.modal.inert, true);
  assert.equal(h.c.document.activeElement, h.previous);
});

test('editor clicks do not dismiss the underlying move picker; Escape cancels only editor', async () => {
  const h = harness(); h.c.movePickerId = 'c1'; const done = h.c.openFolderEditor(); h.frame();
  h.pick('color', 'mint'); assert.equal(h.c.movePickerId, 'c1');
  const e = h.emit('folder-editor-name', 'keydown', { key: 'Escape' });
  assert.equal(e.stopped, true); assert.equal(await done, null); assert.equal(h.c.movePickerId, 'c1');
});

test('close before opening frame cannot resurrect or steal focus', async () => {
  const h = harness(); const done = h.c.openFolderEditor(); h.c.closeFolderEditor(null); await done; h.frame();
  assert.equal(h.modal.classList.contains('is-open'), false); assert.equal(h.c.document.activeElement, h.previous);
});

test('reopening ignores the stale edit frame and its select-all', async () => {
  const h = harness(); const old = h.c.openFolderEditor({ folder: h.store.folders[0] });
  const next = h.c.openFolderEditor(); assert.equal(await old, null); h.frame();
  assert.equal(h.nodes.get('folder-editor-name').selectCount || 0, 0); assert.equal(h.c.folderEditorIsOpen(), true);
  h.timers(); assert.equal(h.modal.hidden, false); h.c.closeFolderEditor(null); await next;
});

test('authentication layer takes precedence over an open editor', async () => {
  const h = harness(); const done = h.c.openFolderEditor(); h.frame(); h.c.gateOpen = true; h.c.syncInteractionState();
  assert.equal(h.modal.inert, true); h.c.gateOpen = false; h.c.syncInteractionState(); h.c.focusActiveLayerAfterGate(); h.frame();
  assert.equal(h.modal.inert, false); assert.equal(h.c.document.activeElement, h.nodes.get('folder-editor-name'));
  h.c.closeFolderEditor(null); await done;
});

for (const action of ['create', 'edit']) test(`reply starting while ${action} editor is open prevents save`, async () => {
  const h = harness(); const done = action === 'create' ? h.c.createFolderInteractive() : h.c.editFolder('f1'); h.frame();
  h.c.pending = true; h.submit(); assert.equal(h.c.folderEditorIsOpen(), true); assert.deepEqual(h.c.persisted, h.store);
  h.c.pending = false; h.submit(); await done; assert.equal(h.c.writes, 1);
});

test('empty name cannot submit, scrim cancellation saves nothing', async () => {
  const h = harness(); const done = h.c.createFolderInteractive(); h.frame(); h.submit('   ');
  assert.equal(h.nodes.get('folder-editor-save').disabled, true); assert.equal(h.c.folderEditorIsOpen(), true);
  h.emit('folder-editor-scrim', 'click'); assert.equal(await done, null); assert.equal(h.c.writes, 0);
});

test('normalization retains allowed appearance keys and rejects arbitrary CSS/SVG payloads', () => {
  const h = harness(); const source = [h.store.folders[0], { ...h.store.folders[0], id: 'f2', color: 'url(https://example.invalid)', icon: '<svg onload=alert(1)>' }];
  const normalized = plain(h.c.normalizeFolders(source, source[0].createdAt));
  assert.deepEqual(normalized[0], source[0]); assert.equal(normalized[1].color, undefined); assert.equal(normalized[1].icon, undefined);
});

for (const outcome of ['cancel', 'move-failed', 'success']) test(`detail new-folder flow preserves picker except after successful move: ${outcome}`, async () => {
  const h = harness(); h.c.folderDetailPickerId = 'c1'; h.c.failMove = outcome === 'move-failed';
  const button = h.c.document.createElement('button'); button.dataset = { action: 'move-new-folder', conversationId: 'c1' };
  h.c.folderDetailList.appendChild(button); h.emit(button, 'click'); h.frame();
  assert.equal(h.c.folderDetailPickerId, 'c1');
  if (outcome === 'cancel') h.emit('folder-editor-cancel', 'click'); else h.submit();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.c.folderDetailPickerId, outcome === 'success' ? null : 'c1');
  assert.equal(h.c.conversationById('c1').folderId === 'f1', outcome !== 'success');
});
