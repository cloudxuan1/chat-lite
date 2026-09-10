// Production gesture and document-click listeners; DOM and actions are doubles.
// Native touch capture, scrolling and layout still need browser acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
// Production source = the js/ files index.html loads, in order (see tests/source.mjs).
import { source } from './source.mjs';
const swipe = source.slice(source.indexOf('const SWIPE_ACTION_META'), source.indexOf('function focusConversationMore'));
const outside = source.match(/^document\.addEventListener\("click", \(event\) => \{\n  if \(!event\.composedPath\(\)[\s\S]*?^\}\);/m)[0];
class Element {
  constructor(className = '', parent = null) {
    this.className = className; this.parent = parent; this.children = []; this.dataset = {}; this.style = { transform: '' }; this.isConnected = true;
    parent?.children.push(this);
    this.classList = { add: (...names) => names.forEach(n => this.classList.toggle(n, true)), remove: (...names) => names.forEach(n => this.classList.toggle(n, false)),
      toggle: (name, on) => { const names = new Set(this.className.split(' ')); on ? names.add(name) : names.delete(name); this.className = [...names].join(' '); } };
  }
  matches(selector) {
    return selector.split(',').some(s => { const m = s.trim().match(/^\.([\w-]+)(?:\[data-side="(\w+)"\])?$/); return m && this.className.split(' ').includes(m[1]) && (!m[2] || this.dataset.side === m[2]); });
  }
  closest(s) { return this.matches(s) ? this : this.parent?.closest(s) || null; }
  querySelectorAll(s) { return this.children.flatMap(c => [...(c.matches(s) ? [c] : []), ...c.querySelectorAll(s)]); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  setPointerCapture(id) { this.capture = id; }
  releasePointerCapture() { this.capture = null; }
  hasPointerCapture(id) { return this.capture === id; }
  getBoundingClientRect() { return { width: 300 }; }
}
function harness(surface = 'sidebar') {
  const listeners = new Map(), timers = [];
  const document = { addEventListener(type, fn, capture) { const list = listeners.get(type) || []; list.push({ fn, capture: !!capture }); listeners.set(type, list); }, querySelector() { return null; } };
  const calls = [];
  const c = vm.createContext({ document, HTMLElement: Element, pending: false, window: { setTimeout: fn => timers.push(fn) },
    folderDetailConvMenuId: null, folderDetailPickerId: null, folderDetailPromptOpen: false, folderDetailMenuOpen: false,
    movePickerId: null, conversationMenuId: null, folderMenuId: null, folderPageMenuId: null, renamingConversationId: null,
    folderDetailId: 'f1', folderById: () => ({}), folderDetailIsOpen: () => surface === 'detail', folderScreenIsOpen: () => false,
    closeQuickPanel() {}, folderEditorIsOpen: () => false, announceConversation() {}, renderFolderScreen() {},
    deleteConversation: id => calls.push(['delete', id]), toggleConversationPinned: id => { calls.push(['pin', id]); return true; },
    rubberband: x => x * 0.2,
  });
  vm.runInContext(swipe + '\n' + outside, c);
  c.renderConversationList = c.renderFolderDetail = () => vm.runInContext('resetSwipeState()', c);
  const row = new Element('swipe-row'); row.dataset = { surface, conversationId: 'c1' };
  const content = new Element(`swipe-content ${surface === 'detail' ? 'folder-page-item-row' : 'conversation-item'}`, row);
  const button = new Element('conversation-button', content);
  for (const [side, kind] of [['left', 'move'], ['right', 'delete']]) { const action = new Element('swipe-action', row); action.dataset = { side, swipeAction: kind, conversationId: 'c1' }; }
  const emit = (type, props = {}) => {
    const event = { type, target: button, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 0, clientY: 0,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediate = this.stopped = true; }, composedPath() { return [this.target]; }, ...props };
    for (const capture of [true, false]) { for (const l of listeners.get(type) || []) { if (l.capture !== capture) continue; l.fn(event); if (event.immediate) break; } if (event.stopped) break; }
    return event;
  };
  const drag = (dx, end = 'pointerup') => { emit('pointerdown'); emit('pointermove', { clientX: dx }); emit(end, { clientX: dx }); };
  return { c, row, content, button, calls, emit, drag, eval: code => vm.runInContext(code, c) };
}
for (const surface of ['sidebar', 'detail']) {
  test(`${surface}: tapping revealed move keeps its picker open after document click`, () => {
    const h = harness(surface); h.drag(-65);
    h.emit('click', { target: h.row }); // synthetic click after swipe
    h.emit('click', { target: h.row.querySelector('.swipe-action[data-side="left"]') });
    assert.equal(surface === 'detail' ? h.c.folderDetailPickerId : h.c.movePickerId, 'c1');
  });
  test(`${surface}: cancelled long swipe never executes delete`, () => {
    const h = harness(surface); h.drag(220, 'pointercancel');
    assert.deepEqual(h.calls, []); assert.equal(h.content.style.transform, '');
    assert.doesNotMatch(h.row.className, /is-swiping|is-open/);
  });
}
test('ordinary long swipe executes once; short swipe only reveals', () => {
  const h = harness(); h.drag(65); assert.deepEqual(h.calls, []);
  h.eval('resetSwipeState()'); h.drag(220); assert.deepEqual(h.calls, [['delete', 'c1']]);
});
test('vertical movement is left to scrolling', () => {
  const h = harness(); h.emit('pointerdown'); h.emit('pointermove', { clientX: 12, clientY: 80 }); h.emit('pointerup');
  assert.equal(h.content.style.transform, ''); assert.deepEqual(h.calls, []);
});
test('a repaint in the other list closes the still-connected revealed row', () => {
  const h = harness(); h.drag(-65); h.eval('resetSwipeState()');
  assert.equal(h.content.style.transform, ''); assert.doesNotMatch(h.row.className, /is-open/);
});
test('a repaint cancels an in-progress swipe and clears its visual state', () => {
  const h = harness(); h.emit('pointerdown'); h.emit('pointermove', { clientX: 220 }); h.eval('resetSwipeState()'); h.emit('pointerup');
  assert.equal(h.content.style.transform, ''); assert.doesNotMatch(h.row.className, /is-swiping|is-open|will-commit/); assert.deepEqual(h.calls, []);
});
test('second finger cannot replace the active gesture', () => {
  const h = harness(); h.emit('pointerdown'); h.emit('pointermove', { clientX: -60 });
  h.emit('pointerdown', { pointerId: 2, isPrimary: false }); h.emit('pointerup', { pointerId: 2, isPrimary: false });
  h.emit('pointerup'); assert.equal(h.content.style.transform, 'translateX(-88px)');
});
test('outside pointerdown closes a revealed row', () => {
  const h = harness(); h.drag(-65); h.emit('pointerdown', { target: new Element() }); assert.equal(h.content.style.transform, '');
});
test('pending reply prevents swipe actions', () => {
  const h = harness(); h.c.pending = true; h.drag(220); assert.deepEqual(h.calls, []); assert.equal(h.content.style.transform, '');
});
