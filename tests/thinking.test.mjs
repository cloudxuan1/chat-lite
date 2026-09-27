// Regression checks for live settings, failed saves, and interrupted animations.
// Timers/DOM are doubles; this does not replace iPhone Safari acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { scripts } from "./source.mjs";

class Element extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.nodes = new Map();
    this.dataset = {};
    this.attrs = new Map();
    this.value = this.textContent = "";
    this.isConnected = true;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
    };
  }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return this.children; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name); }
  focus() {}
}

function harness() {
  let now = 0, seq = 0;
  const timers = new Map(), storage = new Map();
  const document = new EventTarget();
  document.createElement = document.createElementNS = () => new Element();
  const h = {
    document, Event, Set, console,
    window: { matchMedia: () => ({ matches: h.reduced }), confirm: () => true },
    reduced: true, failKey: null,
    performance: { now: () => now },
    setTimeout: (fn, ms = 0) => { timers.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (id) => timers.delete(id),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (key === h.failKey) throw new Error("QuotaExceededError");
        storage.set(key, value);
      },
      removeItem: (key) => storage.delete(key),
    },
    thinkingEggEnabled: true, thinkingTranslate: false, thinkingMarauder: false,
    thinkingSeriesOff: new Set(["cooking", "nonsense", "dawdle", "magic", "dumbledore"]),
    thinkingCustomSeries: [{ id: "custom-test", name: "测试", words: [{ en: "Old", zh: "旧词" }] }],
    thinkingSeriesOverrides: {}, thinkingEditingSeries: null,
    reasoningClipSeq: 0, skipPanelMotionOnce() {}, updateSettingsDirty() {},
  };
  h.requestAnimationFrame = (fn) => h.setTimeout(fn);
  for (const key of ["EGG", "TRANSLATE", "MARAUDER", "SERIES_OFF", "CUSTOM", "OVERRIDES"]) {
    h[`THINKING_${key}_KEY`] = key;
  }
  for (const match of scripts.find((s) => s.path === "js/shared/dom.js").source.matchAll(/^const (\w+) = document.getElementById/gm)) {
    h[match[1]] = new Element();
  }
  // New failure notices are UI doubles even when running against the old ref.
  h.thinkingSettingsStatus ||= new Element();
  h.thinkingSeriesStatus ||= new Element();
  h.thinkingSeriesStatus.hidden = true;
  vm.createContext(h);
  for (const path of ["js/reasoning-icon.js", "js/thinking-words.js", "js/thinking-settings.js"]) {
    vm.runInContext(scripts.find((s) => s.path === path).source, h, { filename: path });
  }
  h.reasoningIconBeats = () => ({ cycle: 4, fresh: [0.3, 2.3], flip: [1.3, 3.3] });
  h.tick = (ms) => {
    const end = now + ms;
    for (let i = 0; i < 1000; i++) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) { now = end; return; }
      now = entry[1].at;
      timers.delete(entry[0]);
      entry[1].fn();
    }
    throw new Error("Timer loop did not settle");
  };
  h.click = (name) => h[name].dispatchEvent(new Event("click"));
  return { h, storage, timers };
}

test("保存失败保留词库和输入，返回时重试；开关失败不改变状态", () => {
  const { h, storage } = harness();
  const original = JSON.stringify(h.thinkingCustomSeries);
  storage.set("CUSTOM", original);
  h.thinkingEditingSeries = "custom-test";
  h.thinkingSeriesScreen.classList.add("is-open");
  h.thinkingSeriesName.value = "新名字";
  h.thinkingWords.appendChild(h.thinkingWordRow({ en: "New", zh: "新词" }));
  h.failKey = "CUSTOM";
  assert.doesNotThrow(() => h.saveThinkingSeriesScreen());
  assert.equal(JSON.stringify(h.thinkingCustomSeries), original);
  assert.equal(storage.get("CUSTOM"), original);
  assert.equal(h.thinkingSeriesStatus.hidden, false);
  h.closeThinkingSeriesScreen();
  assert.equal(h.thinkingSeriesScreen.classList.contains("is-open"), true);
  assert.equal(h.thinkingSeriesName.value, "新名字");
  h.failKey = null;
  h.closeThinkingSeriesScreen();
  assert.equal(h.thinkingSeriesScreen.classList.contains("is-open"), false);
  assert.equal(JSON.parse(storage.get("CUSTOM"))[0].words[0].en, "New");
  h.failKey = "EGG";
  h.click("thinkingEggToggle");
  assert.equal(h.thinkingEggEnabled, true);

  // 删除涉及两个键：第二个写失败时，第一个也必须回到删除前。
  h.thinkingEditingSeries = "custom-test";
  h.thinkingSeriesOff.add("custom-test");
  const offBefore = JSON.stringify([...h.thinkingSeriesOff]);
  storage.set("SERIES_OFF", offBefore);
  h.failKey = "CUSTOM";
  h.click("thinkingSeriesDelete");
  assert.equal(storage.get("SERIES_OFF"), offBefore);
  assert.equal(h.thinkingCustomSeries.length, 1);
  assert.equal(h.thinkingSeriesOff.has("custom-test"), true);
});

test("思考中改词、关闭系列/总开关立即生效；收尾后移除监听", () => {
  const { h, timers } = harness();
  const title = new Element(), root = new Element();
  const controller = h.startThinkingTitle(title, null, root);
  const face = title.children[0];
  assert.equal(face.textContent, "Old");
  h.thinkingEditingSeries = "custom-test";
  h.thinkingSeriesName.value = "测试";
  h.thinkingWords.appendChild(h.thinkingWordRow({ en: "New", zh: "新词" }));
  h.saveThinkingSeriesScreen();
  h.tick(2400);
  assert.equal(face.textContent, "New");
  h.click("thinkingSeriesEnabled");
  h.tick(4000);
  assert.equal(face.textContent, "Thinking…");
  h.click("thinkingSeriesEnabled");
  h.click("thinkingEggToggle");
  h.tick(4000);
  assert.equal(face.textContent, "Thinking…");
  h.click("thinkingEggToggle");
  h.tick(4000);
  assert.equal(face.textContent, "New");
  controller.finish();
  h.click("thinkingEggToggle");
  h.tick(4000);
  assert.equal(face.textContent, "思考完成");
  assert.equal(timers.size, 0);
});

test("翻面期间改设置/收尾，不会被旧翻面回调覆盖", () => {
  const { h } = harness();
  h.reduced = false;
  const face = new Element();
  face.textContent = "Thinking…";
  h.setThinkingWord(face, "旧中文");
  h.setThinkingWord(face, "Thinking…", { animate: false });
  h.tick(200);
  assert.equal(face.textContent, "Thinking…");
  assert.equal(face.classList.contains("is-flipping"), false);
});
