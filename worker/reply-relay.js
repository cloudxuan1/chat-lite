// 回复中转站（Cloudflare Durable Object）：手机切后台、锁屏、网络抖一下，连接断了，
// 它照样把 OpenRouter 的回复收完、存着；网页回来拿「回复编号 + 已经收到多少字节」续上。
// 一个回复一个对象（Worker 用 idFromName(replyId) 找到它），只有 Worker 能调它，外面够不着。
//
// 字节怎么存：正在收的这台对象把整条回复留在内存里，续传直接从内存给，不漏也不重；
// 同时每攒 1 秒或 32KB 写一次盘，防对象被系统重启后什么都没了。
// 收完 24 小时自动删（轩定，写死）；网页存好回复会发 ack，提前删。
// 保活：开始请求和收字都挂在 ctx.waitUntil 上，配合 wrangler.toml 的 durable_object_io_tasks_prevent_eviction，
// 没有手机连着也能继续（每个挂着的操作最多保 15 分钟，不是整条回复的超时）。
// 另有每分钟一次的闹钟兜底：对象重启过、上游那条线没了，就标「中断」。
//
// 同一个编号绝不问两次模型：请求上游之前先在盘上落一个 starting 占位；
// 新对象看到 starting / running（结果不明）就按中断处理，看到 error 就原样回那个错。
// 「说完了」只认 SSE 里那行 `data: [DONE]`：上游没说 [DONE] 就收线，也算中断。

const FLUSH_BYTES = 32 * 1024;
const FLUSH_MS = 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const WATCHDOG_MS = 60 * 1000;
const CHUNK_PREFIX = "c:";
const ERROR_BODY_MAX = 8000;
const SSE_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };

// 回复编号：网页用 crypto.randomUUID() 生成
const REPLY_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export function isReplyId(value) {
  return typeof value === "string" && REPLY_ID_PATTERN.test(value);
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function chunkKey(seq) {
  return CHUNK_PREFIX + String(seq).padStart(6, "0");
}

// 和网页 readStream 同一个标准：一整行 data: [DONE] 才算模型说完了
function isDoneLine(line) {
  const text = line.trim();
  return text.startsWith("data:") && text.slice(5).trim() === "[DONE]";
}

export function sseDoneWatcher() {
  const decoder = new TextDecoder();
  let partial = "";
  let seen = false;
  return {
    push(bytes) {
      if (seen) return;
      const lines = (partial + decoder.decode(bytes, { stream: true })).split("\n");
      partial = lines.pop();
      seen = lines.some(isDoneLine);
    },
    // 最后一行可能没带换行
    seen: () => seen || isDoneLine(partial),
  };
}

export class ReplyRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.started = null;     // 本对象第一次 /start；同一编号重复 /start（网页重试）等它，再按记录回放
    this.beginning = false;  // 正在等上游响应头
    this.status = null;      // null（内存里没有）| "running" | "done" | "failed" | "error"
    this.errorReply = null;  // status 为 error 时：上游当时回的错 { status, body, contentType }
    this.pumping = false;
    this.log = [];           // 收到的全部字节，按到达顺序
    this.total = 0;
    this.saved = 0;          // 已经写盘的字节数
    this.savedSeq = 0;       // 已经写盘的块数
    this.createdAt = 0;
    this.flushTimer = null;
    this.flushing = Promise.resolve();
    this.subscribers = new Set();
    this.acked = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/start") {
      if (!this.started) {
        this.started = request.json().then((message) => this.begin(message));
        this.ctx.waitUntil(this.started.catch(() => {}));
        return this.started;
      }
      await this.started.catch(() => {});
      return this.replay();
    }
    if (url.pathname === "/resume") return this.resume(Number(url.searchParams.get("offset")));
    if (url.pathname === "/ack") {
      await this.clear();
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ error: "not found" }, 404);
  }

  async begin({ url, init }) {
    // 这个编号以前开始过（对象重启过、或网页重发）：按记录回放，不再问模型
    if (await this.ctx.storage.get("meta")) return this.replay();
    this.beginning = true;
    this.createdAt = Date.now();
    // 先落占位再请求上游：对象中途重启，新对象看到它就知道这一条已经问过了
    await this.ctx.storage.put("meta", { status: "starting", total: 0, createdAt: this.createdAt });
    await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
    let upstream;
    try {
      upstream = await fetch(url, init);
    } catch (err) {
      this.beginning = false;
      return this.failStart(502, JSON.stringify({ error: "连接 OpenRouter 失败：" + err.message }), "application/json");
    }
    const contentType = upstream.headers.get("Content-Type") || "";
    // 上游报错或不是流：记下来（同一编号再来原样回这个错），交给网页按错误显示
    if (!upstream.ok || !contentType.includes("text/event-stream") || !upstream.body) {
      const body = await upstream.text().catch(() => "");
      this.beginning = false;
      return this.failStart(upstream.status, body, contentType);
    }
    this.status = "running";
    this.pumping = true;
    this.beginning = false;
    await this.ctx.storage.put("meta", this.meta());
    const client = this.subscribe(0);
    this.ctx.waitUntil(this.pump(upstream.body));
    return new Response(client, { status: 200, headers: { ...SSE_HEADERS, "X-Reply-Status": "running" } });
  }

  async failStart(status, body, contentType) {
    this.status = "error";
    this.errorReply = { status, body: String(body).slice(0, ERROR_BODY_MAX), contentType };
    if (!this.acked) {
      await this.ctx.storage.put("meta", {
        status: "error", total: 0, createdAt: this.createdAt, finishedAt: Date.now(), error: this.errorReply,
      });
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
    }
    return this.errorResponse();
  }

  errorResponse() {
    const { status, body, contentType } = this.errorReply;
    return new Response(body, { status, headers: contentType ? { "Content-Type": contentType } : {} });
  }

  // 收字循环：不管有没有手机连着，一直收到上游结束
  async pump(body) {
    const reader = body.getReader();
    const done = sseDoneWatcher();
    let broken = false;
    try {
      while (true) {
        const { done: ended, value } = await reader.read();
        if (ended) break;
        if (!value?.byteLength) continue;
        done.push(value);
        this.push(value);
      }
    } catch {
      broken = true;
    }
    // 上游中途断了、或者没说 [DONE] 就收线：都算没说完，收到的照样能取，网页按「中断」处理
    const status = !broken && done.seen() ? "done" : "failed";
    this.pumping = false;
    this.status = status;
    for (const sub of this.subscribers) sub.end(status);
    this.subscribers.clear();
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.acked) {
      this.releaseMemory();
      return;
    }
    await this.flush();
    await this.ctx.storage.put("meta", { ...this.meta(), finishedAt: Date.now() });
    await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
  }

  push(value) {
    this.log.push(value);
    this.total += value.byteLength;
    for (const sub of this.subscribers) sub.send(value);
    if (this.total - this.saved >= FLUSH_BYTES) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, FLUSH_MS);
    }
  }

  // 把还没写盘的字节写成一块；一次只写一块，按顺序排队
  flush() {
    this.flushing = this.flushing.then(async () => {
      if (this.acked || this.saved >= this.total) return;
      const bytes = this.bytesFrom(this.saved);
      const seq = this.savedSeq + 1;
      await this.ctx.storage.put({
        [chunkKey(seq)]: bytes,
        meta: { ...this.meta(), total: this.saved + bytes.byteLength },
      });
      this.savedSeq = seq;
      this.saved += bytes.byteLength;
    }).catch(() => {});   // 写盘失败不影响连着的手机；下次再补
    return this.flushing;
  }

  meta() {
    return { status: this.status, total: this.saved, createdAt: this.createdAt };
  }

  bytesFrom(offset) {
    const out = new Uint8Array(Math.max(0, this.total - offset));
    let position = 0;
    let skip = offset;
    for (const part of this.log) {
      if (skip >= part.byteLength) {
        skip -= part.byteLength;
        continue;
      }
      const piece = skip ? part.subarray(skip) : part;
      out.set(piece, position);
      position += piece.byteLength;
      skip = 0;
    }
    return out;
  }

  // 给一个手机开一条流：先补 offset 之后已经收到的，还在收就接着推新字
  subscribe(offset) {
    let controller;
    const sub = {
      send: (bytes) => {
        try {
          controller.enqueue(bytes);
        } catch {
          this.subscribers.delete(sub);
        }
      },
      // 上游中途断了用 error：手机会来续，续的时候再告诉它「中断」
      end: (status) => {
        try {
          if (status === "failed") controller.error(new Error("upstream failed"));
          else controller.close();
        } catch { /* 手机早走了 */ }
      },
    };
    return new ReadableStream({
      start: (c) => {
        controller = c;
        const backlog = this.bytesFrom(offset);
        if (backlog.byteLength) c.enqueue(backlog);
        if (this.pumping) this.subscribers.add(sub);
        else c.close();
      },
      // 手机断开只是少一个听众，上游照收
      cancel: () => {
        this.subscribers.delete(sub);
      },
    });
  }

  // 内存里没有这条回复（对象重启过）：从盘上读回来。盘上还是 starting / running，
  // 说明上游那条线跟着旧对象没了、结果不明：标成中断，绝不再问一次模型
  async ensureLoaded() {
    if (this.beginning) await this.started?.catch(() => {});
    if (this.status) return true;
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return false;
    const stored = await this.ctx.storage.list({ prefix: CHUNK_PREFIX });
    this.log = [...stored.values()];
    this.total = this.log.reduce((sum, part) => sum + part.byteLength, 0);
    this.saved = this.total;
    this.savedSeq = this.log.length;
    this.createdAt = meta.createdAt || Date.now();
    this.status = meta.status;
    this.errorReply = meta.error || null;
    if (this.status === "starting" || this.status === "running") {
      this.status = "failed";
      await this.ctx.storage.put("meta", { ...this.meta(), finishedAt: Date.now() });
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
    }
    return true;
  }

  // 同一个编号又来 /start：照已有的结果给，不再问模型
  async replay() {
    if (this.acked || !(await this.ensureLoaded())) return jsonResponse({ error: "找不到这条回复，可能已经过期" }, 404);
    if (this.status === "error") return this.errorResponse();
    return this.resume(0);
  }

  async resume(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) return jsonResponse({ error: "offset 不对" }, 400);
    if (this.acked || !(await this.ensureLoaded())) return jsonResponse({ error: "找不到这条回复，可能已经过期" }, 404);
    if (this.status === "error") return jsonResponse({ error: "这条回复一开始就请求失败了" }, 410);
    if (offset > this.total) return jsonResponse({ error: "offset 超出已收到的长度" }, 416);
    const status = this.pumping ? "running" : this.status;
    return new Response(this.subscribe(offset), { status: 200, headers: { ...SSE_HEADERS, "X-Reply-Status": status } });
  }

  async alarm() {
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return;
    if (meta.status === "starting" || meta.status === "running") {
      if (this.pumping || this.beginning) {
        await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
        return;
      }
      // 对象重启过，上游那条线已经没了：标中断，留着让手机来取
      await this.ctx.storage.put("meta", { ...meta, status: "failed", finishedAt: Date.now() });
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
      return;
    }
    const expiresAt = (meta.finishedAt || meta.createdAt || 0) + KEEP_MS;
    if (Date.now() >= expiresAt - 1000) await this.clear();
    else await this.ctx.storage.setAlarm(expiresAt);
  }

  releaseMemory() {
    this.log = [];
    this.total = 0;
    this.saved = 0;
    this.savedSeq = 0;
  }

  // 网页存好了（或过期了）：删掉存的字节；之后再来续一律「找不到」
  async clear() {
    this.acked = true;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.flushing;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (!this.pumping) this.releaseMemory();   // 还在收的，收尾时再放
  }
}
