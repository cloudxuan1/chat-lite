# ember-proxy （Cloudflare Worker）

前端 → **这个 Worker** → OpenRouter。

它负责五件事：

1. 先校验访问密码，避免公开网页被陌生人拿来消耗额度。
2. 用 Worker Secret 里的 API key 拉取 OpenRouter 模型目录，前端只负责搜索、收藏和选择。
3. 用 `DEEPSEEK_API_KEY` 调 `deepseek-v4-flash` 为新会话生成自然短标题；中文通常 8–18 字，英文可更长并保留必要标点和空格；关闭 thinking，8 秒超时，失败不影响聊天。
4. 转发聊天请求：非关闭档位会明确开启并要求返回 reasoning；联网使用 OpenRouter 的 `openrouter:web_search` server tool，并只在用户手动设置时传搜索次数/结果数；同时传递图片、模型、可选最大生成量和每会话独立的 `session_id`。
5. 给 Claude 的 system、历史尾部和当前问题添加提示词缓存断点，再把流式回复与 usage 原样透传给前端。

---

## 部署：日常走自动，手动只当备胎

### 方式 C — GitHub Actions 自动部署（2026-07-17 起，日常用这个）

**平时什么都不用做**：合入 `main` 且改动涉及 `worker/` 时，Actions 自动跑测试并部署到 Cloudflare。功能分支要预览 Worker 时手动触发：GitHub App → 本仓库 → Actions → Deploy Worker → Run workflow，并选择对应分支。
一次性前提：仓库 Actions secrets 配好 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（步骤见 `.github/workflows/deploy-worker.yml` 头部注释）。

## 手动部署（备胎）：二选一

### 方式 A — Cloudflare 网页后台（最简单，不用装东西）

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → 左侧 **Workers & Pages** → **Create** → **Create Worker**。
2. 给它起个名（建议 `ember-proxy`）→ **Deploy**（先随便部署一版）。
3. 点 **Edit code**，把本目录 [`worker.js`](worker.js) 的全部内容粘进去，覆盖默认代码 → **Deploy**。
4. 回到 Worker 页 → **Settings** → **Variables and Secrets** → **Add**，类型都选 **Secret**，分别配置：
   - `OPENROUTER_API_KEY`：OpenRouter key（在 [openrouter.ai/keys](https://openrouter.ai/keys) 申请）
   - `DEEPSEEK_API_KEY`：DeepSeek key
   - `ACCESS_PASSWORD`：网页访问口令
   - 每项都 **Save / Deploy**；值不能写进仓库或文档。
5. Worker 页顶部会显示它的网址，形如 `https://ember-proxy.你的子域.workers.dev`。**复制这个网址。**

### 方式 B — wrangler 命令行

```bash
cd worker
npx wrangler deploy
npx wrangler secret put OPENROUTER_API_KEY   # 按提示粘贴 key
npx wrangler secret put DEEPSEEK_API_KEY     # 按提示粘贴 key
npx wrangler secret put ACCESS_PASSWORD      # 按提示粘贴访问口令
```
部署完命令行会打印 Worker 网址。

---

## 部署后

把上一步拿到的 Worker 网址，填进项目根目录 [`../index.html`](../index.html) 顶部的 `WORKER_URL` 常量，替换占位地址。

前端会向同一个地址发送三种 POST：

- `{ action: "models", password }`：返回精简后的模型目录。
- `{ action: "title", password, text }`：只取首条消息前 500 个 Unicode 字符生成短标题；失败时前端保留本地标题。
- `{ messages, model, password, reasoningEffort, session_id, webSearch, webSearchMaxUses?, webSearchMaxResults?, maxCompletionTokens? }`：发起流式聊天；图片作为 OpenRouter `image_url` 内容块放在 `messages` 中，可选生成上限会转成 `max_completion_tokens`。

---

## 注意

- `ALLOWED_ORIGIN`（worker.js 顶部）写死成了 `https://cloudxuan1.github.io`。如果你的 GitHub Pages 域名不是这个，改成你的，否则浏览器会因 CORS 拦截请求。
- 默认模型 `anthropic/claude-opus-4.6` 写在 worker.js 顶部；前端未传 model 时才回退到它。
- `session_id` 最长 256 字符；每个本地会话独立生成，清空当前会话时重建，以提高同一段对话的 provider sticky routing 和缓存命中率，同时避免跨会话串线。
- `maxCompletionTokens` 不传表示由模型/供应商决定；传入时必须是大于 0 的整数。模型目录会同时返回主供应商的最大输出上限，供前端阻止超限设置。
- `reasoningEffort` 非关闭时转成 `{ enabled:true, effort, exclude:false }`，避免依赖模型或供应商的默认显示规则；关闭时按 OpenRouter 契约发送 `{ effort:"none" }`。
- `webSearch` 开启时使用 `tools: [{ type:"openrouter:web_search" }]`，不再使用已弃用的 `plugins: [{ id:"web" }]`。搜索次数与每次结果数默认都不传，由 OpenRouter / 模型自行决定；手动设置时分别校验为 1–30 和 1–25。
- 图片只接受 PNG、JPEG、WebP、GIF 的 base64 data URL；每条消息最多 8 张、解码后合计不超过 6MB。缓存断点只标记多模态内容里的最后一个文本块，不会误标图片块。
- `deepseek-v4-flash` 与 `thinking: { type: "disabled" }` 按 DeepSeek 当前 Chat Completions 契约配置；标题上游错误统一收敛，不把响应详情或 Secret 透给前端。
- 改 Worker 后先跑 `node worker/cache.test.mjs`；当前 28 项测试覆盖标题鉴权/超时/清洗/错误收敛，以及模型目录、生成上限、显式推理、联网搜索自动/手动参数、图片数量/格式/体积、session 转发、三处缓存断点、幂等与不修改入参。
