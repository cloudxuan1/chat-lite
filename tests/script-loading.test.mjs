// Execute classic scripts separately, including event/timer gaps between files.
// DOM/storage/timers are doubles; this is NOT browser or rendering acceptance.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { scripts } from './source.mjs';

test('classic loading handles selection events between scripts', () => {
  const listeners = new Map(), timers = new Map(), storage = new Map();
  let timerId = 0;
  const addEventListener = (type, fn) => {
    listeners.set(type, [...(listeners.get(type) || []), fn]);
  };
  const element = {
    addEventListener, hidden: true, style: {},
    classList: { contains: () => false }, closest: () => null,
  };
  const context = vm.createContext({
    crypto: webcrypto,
    document: {
      addEventListener, documentElement: { dataset: {} },
      getElementById: () => element, querySelector: () => element, querySelectorAll: () => [],
    },
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
    const compiled = new vm.Script(script.source, { filename: script.path });
    // Check init's syntax without rendering against this small DOM double.
    if (script.path === 'js/init.js') break;
    compiled.runInContext(context);
    for (const fn of listeners.get('selectionchange') || []) fn();
    for (const [id, fn] of timers) { timers.delete(id); fn(); }
  }
  assert.ok(listeners.has('selectionchange'));
  // Check the repository's state-location rule once, outside event scenarios.
  for (const script of scripts.filter(script => script.path !== 'js/shared/store.js')) {
    assert.equal(/^let /m.test(script.source), false, 'global state outside store: ' + script.path);
  }
});
