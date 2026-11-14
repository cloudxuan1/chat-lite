// 切后台不丢回复：每轮请求带一个回复编号，Worker 的回复中转站（worker/reply-relay.js）替手机收着。
// 连接断了（切后台、锁屏、网络抖），或回到前台发现好一阵没收到字，就拿「编号 + 已收到的字节数」去续，
// 气泡接着往下流；中转站说中断了 / 找不到了，或连试几次都失败，才当出错交给 send.js。
const REPLY_RESUME_MAX_TRIES = 5;   // 连续续传失败几次就放弃（收到字就清零）
const REPLY_QUIET_MS = 3000;        // 回到前台时这么久没收到字：连接多半已经死了，马上续
const REPLY_STALL_MS = 45000;       // 人在前台、这么久一个字节都没有（平时几秒就有心跳）：当连接死了，续

function newReplyId() {
  return crypto.randomUUID();
}

function waitUntilVisible() {
  if (document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

function replyRelayError(message, final) {
  const error = new Error(message);
  error.replyFinal = final;   // true：再试也没用，别续了
  return error;
}

// 发出这一轮的请求。没等到回音就断了（多半是刚发就切走）：回到前台用同一个编号再发，
// 中转站认得这个编号，已经开始的话从头接着给，不会再问一次模型
async function fetchReplyStart(init) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(WORKER_URL, init);
    } catch (error) {
      if (attempt >= 3) throw error;
      await waitUntilVisible();
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function requestReplyResume(replyId, offset) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply-resume", password: accessPw, replyId, offset }),
  });
  if (response.status === 401) {
    const error = replyRelayError("访问密码错误", true);
    error.code = 401;
    throw error;
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    // 404 过期、416、400 再试也没用；5xx 可能是一时的
    throw replyRelayError(data?.error || `续传失败（${response.status}）`, response.status < 500);
  }
  return response;
}

// 网页已经拿全了（或放弃了）：让中转站删掉存的。失败无所谓，24 小时后它自己删
function ackReply(replyId) {
  void fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply-ack", password: accessPw, replyId }),
  }).catch(() => {});
}

function failedReader(error) {
  return { read: () => Promise.reject(error), cancel: () => Promise.resolve() };
}

// 把第一次的响应包成一条会自己续的流：readStream 照常读，断了在这里悄悄接上
function resumableReplyBody(firstResponse, replyId) {
  let reader = firstResponse.body.getReader();
  let status = firstResponse.headers.get("X-Reply-Status") || "running";
  let offset = 0;
  let failures = 0;
  let lastByteAt = Date.now();
  let forced = false;     // 我们主动掐断旧连接去续，不是正常结束
  let finished = false;
  const forceResume = () => {
    if (finished || forced) return;
    forced = true;
    reader.cancel().catch(() => {});
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible" && Date.now() - lastByteAt > REPLY_QUIET_MS) forceResume();
  };
  const stallTimer = setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - lastByteAt > REPLY_STALL_MS) forceResume();
  }, 5000);
  document.addEventListener("visibilitychange", onVisibility);
  const finish = () => {
    finished = true;
    clearInterval(stallTimer);
    document.removeEventListener("visibilitychange", onVisibility);
  };

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        let result;
        try {
          result = await reader.read();
        } catch (error) {
          result = { error };
        }
        if (!result.error && !result.done) {
          offset += result.value.byteLength;
          lastByteAt = Date.now();
          failures = 0;
          controller.enqueue(result.value);
          return;
        }
        if (result.done && !forced) {
          finish();
          // 中转站交完了它手上的字，但上游那边中途断过：按中断处理
          if (status === "failed") controller.error(replyRelayError("回复在服务器那边断了", true));
          else controller.close();
          return;
        }
        // 连接断了（或我们主动掐断）：等回到前台再续
        forced = false;
        failures += 1;
        if (failures > REPLY_RESUME_MAX_TRIES) {
          finish();
          throw result.error || replyRelayError("连接断了，续不上", true);
        }
        await waitUntilVisible();
        if (failures > 1) await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1000 * 2 ** (failures - 2))));
        try {
          const response = await requestReplyResume(replyId, offset);
          status = response.headers.get("X-Reply-Status") || "running";
          reader = response.body.getReader();
          lastByteAt = Date.now();
        } catch (error) {
          if (error.replyFinal) {
            finish();
            throw error;
          }
          reader = failedReader(error);   // 网络还没好：下一圈按失败再算一次
        }
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason).catch(() => {});
    },
  });
}
