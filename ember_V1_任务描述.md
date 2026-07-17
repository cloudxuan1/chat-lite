## 项目：ember 前端 V1

### 目标
搭一个最小可用的聊天网页，通过 OpenRouter API 调用 Claude Opus 4.6 模型对话。

### 仓库
`cloudxuan1/ember`（已存在，private repo，目前为空）

### 架构
```
前端（GitHub Pages）→ Cloudflare Worker（代理）→ OpenRouter API
```

---

### Part 1：Cloudflare Worker

在 Cloudflare 上创建一个 Worker，功能：
- 接收前端 POST 请求（body 包含 messages 数组和 model 名）
- 给请求加上 `Authorization: Bearer ${API_KEY}` header
- 转发到 `https://openrouter.ai/api/v1/chat/completions`
- 支持流式响应（SSE）透传回前端
- API key 存在 Worker 的 Secrets 里，变量名 `OPENROUTER_API_KEY`
- 加 CORS header 允许 GitHub Pages 域名访问

### Part 2：前端页面

单个 `index.html`，包含 HTML + CSS + JS：
- 聊天界面：消息气泡区 + 底部输入框 + 发送按钮
- 配色和样式参考 `ssssssssynqa.github.io`（Claude记忆刻痕）的 CSS 风格：米白背景、暖棕色调、圆角卡片、neumorphic 按钮。可以直接从该站提取颜色变量和阴影样式。不需要从零设计
- 字体：系统默认无衬线字体
- 流式响应：打字机效果逐字显示
- 模型默认 `anthropic/claude-opus-4-6`
- Mobile-first：在手机上好用为第一优先
- 对话历史保持在页面内存中，刷新即清空（Phase 1 不做持久化）
- Worker URL 写成可配置常量，方便后续改

### Part 3：部署
- 前端推到 `cloudxuan1/ember`，开启 GitHub Pages
- Worker 部署到 Cloudflare

---

### 不做
- 不做用户认证
- 不做对话持久化
- 不做记忆系统接入
- 不做 system prompt（Phase 2 再加）
- 不做 GIF 素材
