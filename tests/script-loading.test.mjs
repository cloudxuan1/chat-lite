// Execute classic scripts separately: concatenating them hides cross-file hoisting
// and event callbacks that can run while the next network response is pending.
// DOM/storage/timers are doubles; this is NOT browser or rendering acceptance.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { scripts } from './source.mjs';

for (const saved of [false, true]) {
  test(`classic loading initializes state before listeners (saved data: ${saved})`, () => {
    const storage = new Map(saved ? [['ember_system_prompt', 'keep this prompt']] : []);
    const listeners = new Map(), timers = new Map();
    let context, timerId = 0;
    const addEventListener = (type, fn) => {
      // Merely registering a callback does not read state, but the browser may
      // dispatch it before the next external script arrives.
      listeners.set(type, [...(listeners.get(type) || []), fn]);
    };
    const element = {
      addEventListener, hidden: true, style: {},
      classList: { contains: () => false },
      closest: () => null,
    };
    const document = {
      addEventListener, documentElement: { dataset: {} },
      getElementById: () => element, querySelector: () => element, querySelectorAll: () => [],
    };
    context = vm.createContext({
      document, crypto: webcrypto,
      window: {
        addEventListener, matchMedia: () => ({ matches: false, addEventListener }),
        getSelection: () => null,
      },
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: id => timers.delete(id),
    });
    assert.equal(scripts.at(-1).path, 'js/init.js');
    for (const script of scripts) {
      // init's rendering is outside this deliberately small DOM double.
      new vm.Script(script.source, { filename: script.path });
      if (script.path === 'js/init.js') break;
      vm.runInContext(script.source, context, { filename: script.path });
      // A user selection and its debounce may finish between any two files.
      for (const fn of listeners.get('selectionchange') || []) fn();
      for (const [id, fn] of timers) { timers.delete(id); fn(); }
    }
    for (const script of scripts.filter(script => script.path !== 'js/shared/store.js')) {
      assert.equal(/^let /m.test(script.source), false, `global state outside store: ${script.path}`);
    }
    assert.equal(vm.runInContext('conversationStore.conversations.length', context), 1);
    assert.equal(vm.runInContext('systemPrompt', context), saved ? 'keep this prompt' : '');
    assert.equal(vm.runInContext('folderEditorState', context), null);
    assert.equal(vm.runInContext('swipeGesture', context), null);
    assert.equal(vm.runInContext('typeof showGate', context), 'function');
    assert.ok(listeners.has('selectionchange'));
    assert.ok(listeners.has('submit'));
  });
}
