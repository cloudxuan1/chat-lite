// 密码门禁：提交时先向 Worker 验密码，验证中锁输入，错了留在门禁，网络断提示重试。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../js/gate.js", import.meta.url), "utf8");

function element() {
  const classes = new Set();
  return {
    value: "", textContent: "", disabled: false, focused: 0, style: {},
    classList: {
      toggle: (name, on) => { on ? classes.add(name) : classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    focus() { this.focused++; },
    addEventListener() {},
  };
}

function harness(fetchImpl) {
  const requests = [];
  const stored = {};
  const closedScreen = { classList: { contains: () => false } };
  const context = {
    WORKER_URL: "https://mock.invalid", PW_KEY: "ember_pw",
    accessPw: "", gateVerifying: false, imageCapabilityLookupAttempted: true, sidebarOpen: false,
    gate: element(), gateForm: element(), gateInput: element(), gateErr: element(), gateBtn: element(),
    input: element(), localStorage: { setItem: (k, v) => { stored[k] = v; } },
    syncInteractionState() {}, folderEditorIsOpen: () => false,
    folderDetailScreen: closedScreen, folderScreen: closedScreen, modelScreen: closedScreen,
    promptScreen: closedScreen, identityScreen: closedScreen, webSettingsScreen: closedScreen,
    imageSettingsScreen: closedScreen, settingsScreen: closedScreen,
    desktopSidebarMedia: { matches: true }, window: { requestAnimationFrame: (fn) => fn() },
    Error,
    fetch: async (_, options) => { requests.push(JSON.parse(options.body)); return fetchImpl(); },
  };
  context.gate.style.display = "flex";
  vm.createContext(context);
  vm.runInContext(source, context);
  return { c: context, requests, stored };
}

test("密码对：验证中锁输入，通过后存密码并关门禁", async () => {
  let resolve;
  const { c, requests, stored } = harness(() => new Promise((r) => { resolve = r; }));
  c.gateInput.value = " secret ";
  const done = c.submitGate();
  assert.equal(c.gateVerifying, true);
  assert.equal(c.gateInput.disabled, true);
  assert.equal(c.gateBtn.disabled, true);
  assert.equal(c.gateErr.textContent, "验证中…");
  assert.equal(c.gateErr.classList.contains("is-pending"), true);
  await c.submitGate();  // 验证中重复提交被忽略
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { action: "verify", password: "secret" });
  resolve({ status: 200 });
  await done;
  assert.equal(c.gateVerifying, false);
  assert.equal(c.gateInput.disabled, false);
  assert.equal(c.accessPw, "secret");
  assert.equal(stored.ember_pw, "secret");
  assert.equal(c.imageCapabilityLookupAttempted, false);
  assert.equal(c.gate.style.display, "none");
  assert.equal(c.gateErr.textContent, "");
  assert.equal(c.gateInput.value, "");
});

test("旧版 Worker 没有 verify 回 400：仍算密码对", async () => {
  const { c } = harness(async () => ({ status: 400 }));
  c.gateInput.value = "secret";
  await c.submitGate();
  assert.equal(c.accessPw, "secret");
  assert.equal(c.gate.style.display, "none");
});

test("密码错：留在门禁、清空输入、提示重输，不存密码", async () => {
  const { c, stored } = harness(async () => ({ status: 401 }));
  c.gateInput.value = "wrong";
  await c.submitGate();
  assert.equal(c.gateVerifying, false);
  assert.equal(c.gateInput.disabled, false);
  assert.equal(c.gateErr.textContent, "密码错误，请重新输入");
  assert.equal(c.gateErr.classList.contains("is-pending"), false);
  assert.equal(c.gateInput.value, "");
  assert.equal(c.accessPw, "");
  assert.deepEqual(stored, {});
  assert.equal(c.gate.style.display, "flex");
  assert.ok(c.gateInput.focused >= 1);
});

test("网络断或 5xx：提示重试，不放行也不存密码", async () => {
  for (const impl of [async () => { throw new TypeError("Failed to fetch"); }, async () => ({ status: 502 })]) {
    const { c, stored } = harness(impl);
    c.gateInput.value = "secret";
    await c.submitGate();
    assert.equal(c.gateErr.textContent, "连不上服务器，请检查网络后重试");
    assert.equal(c.gateInput.value, "secret");
    assert.equal(c.gateInput.disabled, false);
    assert.equal(c.accessPw, "");
    assert.deepEqual(stored, {});
    assert.equal(c.gate.style.display, "flex");
  }
});

test("空密码不发请求", async () => {
  const { c, requests } = harness(async () => ({ status: 200 }));
  c.gateInput.value = "   ";
  await c.submitGate();
  assert.equal(requests.length, 0);
  assert.equal(c.gate.style.display, "flex");
});
