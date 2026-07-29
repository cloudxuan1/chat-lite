# ember-proxy （Cloudflare Worker）

前端 → **这个 Worker** → OpenRouter。

它负责四件事：

1. 先校验访问密码，避免公开网页被陌生人拿来消耗额度。
2. 用 Worker Secret 里的 API key 拉取 OpenRouter 模型目录，前端只负责搜索、收藏和选择。
3. 转发聊天请求，并传递模型、推理档位、可选最大生成量、联网搜索和 `session_id`。
4. 给 Claude 的 system、历史尾部和当前问题添加提示词缓存断点，再把流式回复与 usage 原样透传给前端。

---

## 部署：日常走自动，手动只当备胎

### 方式 C — GitHub Actions 自动部署（2026-07-17 起，日常用这个）

**平时什么都不用做**：push 到 GitHub（main 或 codex/add-reasoning-web 分支）且改动涉及 `worker/`，Actions 自动跑测试并部署到 Cloudflare。手机上重发：GitHub App → 本仓库 → Actions → Deploy Worker → Run workflow。
一次性前提：仓库 Actions secrets 配好 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（步骤见 `.github/workflows/deploy-worker.yml` 头部注释）。

## 手动部署（备胎）：二选一

### 方式 A — Cloudflare 网页后台（最简单，不用装东西）

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → 左侧 **Workers & Pages** → **Create** → **Create Worker**。
2. 给它起个名（建议 `ember-proxy`）→ **Deploy**（先随便部署一版）。
3. 点 **Edit code**，把本目录 [`worker.js`](worker.js) 的全部内容粘进去，覆盖默认代码 → **Deploy**。
4. 回到 Worker 页 → **Settings** → **Variables and Secrets** → **Add**：
   - 类型选 **Secret**
   - 名称填 `OPENROUTER_API_KEY`
   - 值填你的 OpenRouter key（在 [openrouter.ai/keys](https://openrouter.ai/keys) 申请）
   - **Save / Deploy**
5. Worker 页顶部会显示它的网址，形如 `https://ember-proxy.你的子域.workers.dev`。**复制这个网址。**

### 方式 B — wrangler 命令行

```bash
cd worker
npx wrangler deploy
npx wrangler secret put OPENROUTER_API_KEY   # 按提示粘贴 key
```
部署完命令行会打印 Worker 网址。

---

## 部署后

把上一步拿到的 Worker 网址，填进项目根目录 [`../index.html`](../index.html) 顶部的 `WORKER_URL` 常量，替换占位地址。

前端会向同一个地址发送两种 POST：

- `{ action: "models", password }`：返回精简后的模型目录。
- `{ messages, model, password, reasoningEffort, session_id, webSearch, maxCompletionTokens? }`：发起流式聊天；可选生成上限会转成 OpenRouter 的 `max_completion_tokens`。

---

## 注意

- `ALLOWED_ORIGIN`（worker.js 顶部）写死成了 `https://cloudxuan1.github.io`。如果你的 GitHub Pages 域名不是这个，改成你的，否则浏览器会因 CORS 拦截请求。
- 默认模型 `anthropic/claude-opus-4.6` 写在 worker.js 顶部；前端未传 model 时才回退到它。
- `session_id` 最长 256 字符；前端会在清空聊天时生成新值，以提高同一段对话的 provider sticky routing 和缓存命中率。
- `maxCompletionTokens` 不传表示由模型/供应商决定；传入时必须是大于 0 的整数。模型目录会同时返回主供应商的最大输出上限，供前端阻止超限设置。
- 改 Worker 后先跑 `node worker/cache.test.mjs`；当前 13 项测试覆盖模型目录、生成上限、推理参数、session 转发、三处缓存断点、幂等与不修改入参。
