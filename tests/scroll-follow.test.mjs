// 流式输出「贴底跟随」：往上翻后不再被拽到底，翻回底部或点箭头再跟上。
// 用真实的 js/scroll-follow.js 和 message-area.js 里的 scrollToBottom；滚动容器是替身，不代表浏览器验收。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { scripts } from "./source.mjs";

const followSource = scripts.find((script) => script.path === "js/scroll-follow.js").source;
const scrollToBottomSource = scripts
  .find((script) => script.path === "js/message-area.js")
  .source.match(/function scrollToBottom\(\) \{[\s\S]*?\n\}/)[0];

function setup() {
  const listeners = {};
  let top = 0;
  const messagesEl = {
    scrollHeight: 1000,
    clientHeight: 400,
    get scrollTop() { return top; },
    // 像浏览器一样夹在 0 到最底之间，位置变了才发 scroll 事件
    set scrollTop(value) {
      const next = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
      if (next === top) return;
      top = next;
      listeners.scroll?.();
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    scrollTo({ top: value }) { this.scrollTop = value; },
  };
  const button = {
    visible: false,
    tabIndex: -1,
    classList: { toggle(name, on) { if (name === "is-visible") button.visible = on; } },
    addEventListener(type, fn) { listeners[`button-${type}`] = fn; },
  };
  const context = vm.createContext({
    messagesEl,
    scrollBottomButton: button,
    window: { matchMedia: () => ({ matches: false }) },
  });
  vm.runInContext(`let scrollFollow = true; let scrollFollowLastTop = 0;\n${scrollToBottomSource}\n${followSource}`, context);
  const grow = (by) => { messagesEl.scrollHeight += by; };
  return { context, messagesEl, button, listeners, grow };
}

test("往上翻以后新字不再把画面拽到底，翻回底部附近又自动跟上", () => {
  const { context, messagesEl, button, grow } = setup();
  context.scrollToBottom();                 // 发消息：强制到底
  assert.equal(messagesEl.scrollTop, 600);
  grow(100);
  context.followToBottom();                 // 在底部：跟着走
  assert.equal(messagesEl.scrollTop, 700);

  messagesEl.scrollTop = 680;               // 往上轻轻一拨就松开
  grow(300);
  context.followToBottom();
  assert.equal(messagesEl.scrollTop, 680);
  assert.equal(button.visible, true);
  assert.equal(button.tabIndex, 0);

  messagesEl.scrollTop = 960;               // 自己翻回离底 40px：重新跟上
  grow(100);
  context.followToBottom();
  assert.equal(messagesEl.scrollTop, 1100);
  assert.equal(button.visible, false);
});

test("内容变短被浏览器夹到底不算往上翻，仍然跟随", () => {
  const { context, messagesEl } = setup();
  messagesEl.scrollHeight = 2000;
  context.scrollToBottom();
  assert.equal(messagesEl.scrollTop, 1600);
  messagesEl.scrollHeight = 1200;           // 记忆工具换轮：气泡清空，内容变短
  messagesEl.scrollTop = messagesEl.scrollTop;
  assert.equal(messagesEl.scrollTop, 800);
  messagesEl.scrollHeight = 1500;
  context.followToBottom();
  assert.equal(messagesEl.scrollTop, 1100);
});

test("点回到底部箭头：滚到底并恢复跟随", () => {
  const { context, messagesEl, button, listeners, grow } = setup();
  context.scrollToBottom();
  messagesEl.scrollTop = 200;
  grow(500);
  context.followToBottom();
  assert.equal(messagesEl.scrollTop, 200);
  assert.equal(button.visible, true);
  listeners["button-click"]();
  assert.equal(messagesEl.scrollTop, 1100);
  assert.equal(button.visible, false);
  grow(100);
  context.followToBottom();
  assert.equal(messagesEl.scrollTop, 1200);
});
