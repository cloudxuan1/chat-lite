// 回复中转站测试：跑 `node worker/reply-relay.test.mjs`。
// 存储、闹钟、waitUntil 是替身；上游是一条手动推字的假流。真运行时（workerd）的验证见 docs/交接.md。
import assert from "node:assert/strict";
import { ReplyRelay } from "./reply-relay.js";
import worker from "./worker.js";

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function mockCtx(initial = {}) {
  const data = new Map(Object.entries(initial));
  const ctx = {
    data,
    alarm: null,
    waits: [],
    storage: {
      async get(key) { return data.get(key); },
      async put(keyOrEntries, value) {
        if (typeof keyOrEntries === "string") data.set(keyOrEntries, value);
        else for (const [key, item] of Object.entries(keyOrEntries)) data.set(key, item);
      },
      async list({ prefix }) {
        return new Map([...data].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)));
      },
      async deleteAll() { data.clear(); },
      async setAlarm(time) { ctx.alarm = time; },
      async deleteAlarm() { ctx.alarm = null; },
    },
    waitUntil(promise) { ctx.waits.push(promise); },
  };
  return ctx;
}

// 假上游：手动推字、结束、中途断
function fakeUpstream() {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: () => controller.error(new Error("upstream reset")),
  };
}

function useFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

const startRequest = () => new Request("https://reply-relay/start", {
  method: "POST",
  body: JSON.stringify({ url: "https://upstream.invalid/chat", init: { method: "POST", body: "{}" } }),
});
const resumeRequest = (offset) => new Request(`https://reply-relay/resume?offset=${offset}`);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const storedText = (ctx) => [...ctx.data].filter(([key]) => key.startsWith("c:")).sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([, bytes]) => decoder.decode(bytes)).join("");

await test("手机断开后中转站照收；续传从断点给剩下的；ack 后删光", async () => {
  const up = fakeUpstream();
  const calls = useFetch(() => up.response);
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Reply-Status"), "running");
  const reader = res.body.getReader();
  up.push("data: a\n\n");
  const first = await reader.read();
  assert.equal(decoder.decode(first.value), "data: a\n\n");
  await reader.cancel();                     // 切后台：手机这头断了
  up.push("data: b\n\n");
  up.push("data: [DONE]\n\n");
  up.end();
  await Promise.all(ctx.waits);
  assert.equal(ctx.data.get("meta").status, "done");
  assert.equal(storedText(ctx), "data: a\n\ndata: b\n\ndata: [DONE]\n\n");
  assert.ok(ctx.alarm > Date.now() + 23 * 3600 * 1000);   // 24 小时后自动删

  const resumed = await relay.fetch(resumeRequest(first.value.byteLength));
  assert.equal(resumed.headers.get("X-Reply-Status"), "done");
  assert.equal(await resumed.text(), "data: b\n\ndata: [DONE]\n\n");
  assert.equal(calls.length, 1);

  const ack = await relay.fetch(new Request("https://reply-relay/ack", { method: "POST" }));
  assert.equal(ack.status, 204);
  assert.equal(ctx.data.size, 0);
  assert.equal(ctx.alarm, null);
  assert.equal((await relay.fetch(resumeRequest(0))).status, 404);
});

await test("还在收时续传：先补断点后的，再接着推新字", async () => {
  const up = fakeUpstream();
  useFetch(() => up.response);
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  const reader = res.body.getReader();
  up.push("data: 1\n\n");
  const first = await reader.read();
  await reader.cancel();
  up.push("data: 2\n\n");
  await tick();
  const resumed = await relay.fetch(resumeRequest(first.value.byteLength));
  assert.equal(resumed.headers.get("X-Reply-Status"), "running");
  const textPromise = resumed.text();
  up.push("data: 3\n\n");
  up.push("data: [DONE]\n\n");
  up.end();
  assert.equal(await textPromise, "data: 2\n\ndata: 3\n\ndata: [DONE]\n\n");
  await Promise.all(ctx.waits);
});

await test("同一个编号重复开始（网页重试）：不再请求上游，从头给", async () => {
  const up = fakeUpstream();
  const calls = useFetch(() => up.response);
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  up.push("data: x\n\n");
  await tick();
  const again = await relay.fetch(startRequest());
  const textPromise = again.text();
  up.push("data: y\n\n");
  up.push("data: [DONE]\n\n");
  up.end();
  assert.equal(await textPromise, "data: x\n\ndata: y\n\ndata: [DONE]\n\n");
  assert.equal(calls.length, 1);
  await res.body.cancel();
  await Promise.all(ctx.waits);
});

await test("上游报错（不是流）：原样交回并记下；同一编号再来（含重启后）回同一个错，不再问模型", async () => {
  const calls = useFetch(() => new Response('{"error":{"message":"bad model"}}', { status: 400, headers: { "Content-Type": "application/json" } }));
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  assert.equal(res.status, 400);
  assert.match(await res.text(), /bad model/);
  assert.equal(ctx.data.get("meta").status, "error");
  assert.equal([...ctx.data.keys()].filter((key) => key.startsWith("c:")).length, 0);
  const again = await relay.fetch(startRequest());
  assert.equal(again.status, 400);
  const restarted = await new ReplyRelay(ctx, {}).fetch(startRequest());
  assert.equal(restarted.status, 400);
  assert.match(await restarted.text(), /bad model/);
  assert.equal(calls.length, 1);
  assert.equal((await relay.fetch(resumeRequest(0))).status, 410);
});

await test("上游没说 [DONE] 就收线：记成中断，续传带 failed", async () => {
  const up = fakeUpstream();
  useFetch(() => up.response);
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  const reader = res.body.getReader();
  up.push("data: A\n\n");
  const first = await reader.read();
  up.end();                                  // 没有 [DONE]
  await assert.rejects(reader.read());       // 连着的手机收到错误，会来续
  await Promise.all(ctx.waits);
  assert.equal(ctx.data.get("meta").status, "failed");
  const resumed = await relay.fetch(resumeRequest(first.value.byteLength));
  assert.equal(resumed.headers.get("X-Reply-Status"), "failed");
  assert.equal(await resumed.text(), "");
});

await test("请求上游前先落占位：响应头没回来对象就重启了，同一编号重发不再问模型、按中断处理", async () => {
  let release;
  const calls = useFetch(() => new Promise((resolve) => { release = resolve; }));   // 上游迟迟不回响应头
  const ctx = mockCtx();
  const first = new ReplyRelay(ctx, {});
  const pending = first.fetch(startRequest());
  await tick();
  await tick();
  assert.equal(ctx.data.get("meta").status, "starting");
  const restarted = new ReplyRelay(ctx, {});   // 旧对象没了，网页用同一编号重发
  const res = await restarted.fetch(startRequest());
  assert.equal(calls.length, 1);
  assert.equal(res.headers.get("X-Reply-Status"), "failed");
  assert.equal(await res.text(), "");
  assert.equal(ctx.data.get("meta").status, "failed");
  release(new Response("", { status: 500 }));
  await pending;
});

await test("ack 以后：还在收也不再给续传；收尾时把内存放掉", async () => {
  const up = fakeUpstream();
  useFetch(() => up.response);
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  up.push("data: x\n\ndata: [DONE]\n\n");
  await res.body.getReader().read();
  await relay.fetch(new Request("https://reply-relay/ack", { method: "POST" }));
  assert.equal((await relay.fetch(resumeRequest(0))).status, 404);
  up.end();
  await Promise.all(ctx.waits);
  assert.equal(relay.total, 0);
  assert.equal(ctx.data.size, 0);
});

await test("上游中途断了：连着的手机收到错误，续传拿到全部已收字节并标 failed", async () => {
  const up = fakeUpstream();
  useFetch(() => up.response);
  const ctx = mockCtx();
  const relay = new ReplyRelay(ctx, {});
  const res = await relay.fetch(startRequest());
  const reader = res.body.getReader();
  up.push("data: part\n\n");
  await reader.read();
  up.fail();
  await assert.rejects(reader.read());
  await Promise.all(ctx.waits);
  assert.equal(ctx.data.get("meta").status, "failed");
  const resumed = await relay.fetch(resumeRequest(0));
  assert.equal(resumed.headers.get("X-Reply-Status"), "failed");
  assert.equal(await resumed.text(), "data: part\n\n");
});

await test("对象重启过：盘上还是 running 的回复按中断交出已存字节", async () => {
  const ctx = mockCtx({
    meta: { status: "running", total: 9, createdAt: Date.now() - 5000 },
    "c:000001": encoder.encode("data: 1\n\n"),
  });
  const relay = new ReplyRelay(ctx, {});
  const resumed = await relay.fetch(resumeRequest(0));
  assert.equal(resumed.headers.get("X-Reply-Status"), "failed");
  assert.equal(await resumed.text(), "data: 1\n\n");
  assert.equal(ctx.data.get("meta").status, "failed");
  assert.equal((await relay.fetch(resumeRequest(10))).status, 416);
});

await test("闹钟：在收就续约；重启后没人在收就标中断；过期删光", async () => {
  const ctx = mockCtx({ meta: { status: "running", total: 0, createdAt: Date.now() } });
  const relay = new ReplyRelay(ctx, {});
  await relay.alarm();
  assert.equal(ctx.data.get("meta").status, "failed");
  ctx.data.set("meta", { status: "done", total: 0, finishedAt: Date.now() - 25 * 3600 * 1000 });
  await relay.alarm();
  assert.equal(ctx.data.size, 0);
});

// Worker 这一层：带编号的聊天交给中转站，续传 / ack 校验参数并补 CORS
function relayEnv() {
  const seen = [];
  const env = {
    ACCESS_PASSWORD: "pw",
    OPENROUTER_API_KEY: "key",
    REPLY_RELAY: {
      idFromName: (name) => `id:${name}`,
      get: (id) => ({
        fetch: async (url, init) => {
          seen.push({ id, url, body: init?.body ? JSON.parse(init.body) : null });
          return new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream", "X-Reply-Status": "done" } });
        },
      }),
    },
  };
  return { env, seen };
}
const post = (payload) => new Request("https://worker.invalid/", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://cloudxuan1.github.io" },
  body: JSON.stringify({ password: "pw", ...payload }),
});
const REPLY_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

await test("Worker：带 replyId 的聊天交给中转站，响应带 CORS 和 X-Reply-Status", async () => {
  const { env, seen } = relayEnv();
  const res = await worker.fetch(post({ messages: [{ role: "user", content: "hi" }], replyId: REPLY_ID }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Expose-Headers"), "X-Reply-Status");
  assert.equal(res.headers.get("X-Reply-Status"), "done");
  assert.equal(seen[0].id, `id:${REPLY_ID}`);
  assert.equal(seen[0].url, "https://reply-relay/start");
  assert.equal(seen[0].body.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(JSON.parse(seen[0].body.init.body).messages.at(-1).role, "user");
});

await test("Worker：replyId / offset 不合法回 400；没绑中转站时续传 503", async () => {
  const { env } = relayEnv();
  assert.equal((await worker.fetch(post({ messages: [{ role: "user", content: "hi" }], replyId: "short" }), env)).status, 400);
  assert.equal((await worker.fetch(post({ action: "reply-resume", replyId: REPLY_ID, offset: -1 }), env)).status, 400);
  assert.equal((await worker.fetch(post({ action: "reply-resume", replyId: "../x", offset: 0 }), env)).status, 400);
  const { REPLY_RELAY, ...bare } = env;
  assert.equal((await worker.fetch(post({ action: "reply-resume", replyId: REPLY_ID, offset: 0 }), bare)).status, 503);
});

await test("Worker：续传和 ack 转给同一编号的中转站", async () => {
  const { env, seen } = relayEnv();
  const resumed = await worker.fetch(post({ action: "reply-resume", replyId: REPLY_ID, offset: 12 }), env);
  assert.equal(await resumed.text(), "data: [DONE]\n\n");
  const ack = await worker.fetch(post({ action: "reply-ack", replyId: REPLY_ID }), env);
  assert.deepEqual(await ack.json(), { ok: true });
  assert.deepEqual(seen.map((item) => item.url), ["https://reply-relay/resume?offset=12", "https://reply-relay/ack"]);
});
