// 回复中转站（Cloudflare Durable Object）：手机切后台、锁屏、网络抖一下，连接断了，
// 它照样把 OpenRouter 的回复收完、存着；网页回来拿「回复编号 + 已经收到多少字节」续上。
// 一个回复一个对象（Worker 用 idFromName(replyId) 找到它），只有 Worker 能调它，外面够不着。
//
// 字节怎么存：正在收的这台对象把整条回复留在内存里，续传直接从内存给，不漏也不重；
// 同时每攒 1 秒或 32KB 写一次盘，防对象被系统重启后什么都没了。
// 收完 24 小时自动删（轩定，写死）；网页存好回复会发 ack，提前删。
// 保活：收字的循环挂在 ctx.waitUntil 上，配合 wrangler.toml 的 durable_object_io_tasks_prevent_eviction，
// 没有手机连着也能继续收（单次最长 15 分钟）。另有每分钟一次的闹钟兜底：对象重启过、上游那条线没了，就标「中断」。

const FLUSH_BYTES = 32 * 1024;
const FLUSH_MS = 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const WATCHDOG_MS = 60 * 1000;
const CHUNK_PREFIX = "c:";
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

export class ReplyRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.started = null;     // 第一次 start 的结果；同一编号重复 start（网页重试）等它，再按续传处理
    this.status = null;      // null（内存里没有）| "running" | "done" | "failed"
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
        return this.started;
      }
      await this.started.catch(() => {});
      return this.resume(0);
    }
    if (url.pathname === "/resume") return this.resume(Number(url.searchParams.get("offset")));
    if (url.pathname === "/ack") {
      await this.clear();
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ error: "not found" }, 404);
  }

  async begin({ url, init }) {
    // 对象重启前已经开始过这个编号：不再请求上游（免得收两份钱），按续传处理
    if (await this.ctx.storage.get("meta")) return this.resume(0);
    let upstream;
    try {
      upstream = await fetch(url, init);
    } catch (err) {
      return jsonResponse({ error: "连接 OpenRouter 失败：" + err.message }, 502);
    }
    const contentType = upstream.headers.get("Content-Type") || "";
    // 上游报错或不是流：原样交回，不存（网页本来就按错误显示）
    if (!upstream.ok || !contentType.includes("text/event-stream") || !upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: contentType ? { "Content-Type": contentType } : {},
      });
    }
    this.status = "running";
    this.pumping = true;
    this.createdAt = Date.now();
    await this.ctx.storage.put("meta", this.meta());
    await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
    const client = this.subscribe(0);
    this.ctx.waitUntil(this.pump(upstream.body));
    return new Response(client, { status: 200, headers: { ...SSE_HEADERS, "X-Reply-Status": "running" } });
  }

  // 收字循环：不管有没有手机连着，一直收到上游结束
  async pump(body) {
    const reader = body.getReader();
    let status = "done";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) this.push(value);
      }
    } catch {
      status = "failed";   // 上游中途断了：收到的照样能取，网页按「中断」处理
    }
    this.pumping = false;
    this.status = status;
    for (const sub of this.subscribers) sub.end(status);
    this.subscribers.clear();
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
    if (this.acked) return;
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

  async resume(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) return jsonResponse({ error: "offset 不对" }, 400);
    if (!this.status) {
      // 对象重启过（或这是另一台）：从盘上读回来
      const meta = await this.ctx.storage.get("meta");
      if (!meta) return jsonResponse({ error: "找不到这条回复，可能已经过期" }, 404);
      const stored = await this.ctx.storage.list({ prefix: CHUNK_PREFIX });
      this.log = [...stored.values()];
      this.total = this.log.reduce((sum, part) => sum + part.byteLength, 0);
      this.saved = this.total;
      this.savedSeq = this.log.length;
      this.createdAt = meta.createdAt || Date.now();
      this.status = meta.status;
      if (this.status === "running") {
        // 上游那条线跟着旧对象没了：标中断，收到的照样能取
        this.status = "failed";
        await this.ctx.storage.put("meta", { ...this.meta(), finishedAt: Date.now() });
        await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
      }
    }
    if (offset > this.total) return jsonResponse({ error: "offset 超出已收到的长度" }, 416);
    const status = this.pumping ? "running" : this.status;
    return new Response(this.subscribe(offset), { status: 200, headers: { ...SSE_HEADERS, "X-Reply-Status": status } });
  }

  async alarm() {
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return;
    if (meta.status === "running") {
      if (this.pumping) {
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

  // 网页存好了（或过期了）：删掉存的字节
  async clear() {
    this.acked = true;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.flushing;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (!this.pumping) {   // 内存里的也清掉，之后再来续就是「找不到」
      this.status = null;
      this.log = [];
      this.total = 0;
      this.saved = 0;
      this.savedSeq = 0;
    }
  }
}
