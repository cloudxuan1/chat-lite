# chat-lite

跟 Claude 聊天的单页小网页：原生 HTML / CSS / JS，无构建、无框架，改一行 push 就上线。

- 网址：https://cloudxuan1.github.io/chat-lite/ （要输访问密码）
- 链路：浏览器 → 密码门禁 → Cloudflare Worker（注入 key）→ OpenRouter → Claude
- 数据：会话、设置存本机浏览器 localStorage，图片存 IndexedDB；可备份 / 恢复、可清空，不上传任何账号系统
- 可选：接 [ember](https://github.com/cloudxuan1/ember) 记忆库（开场小抄 + 模型按需查记忆），默认关

## 目录

| 位置 | 内容 |
|------|------|
| `index.html` + `css/` + `js/` | 前端，经典 `<script>` 顺序加载，文件清单见 `docs/项目详情.md` |
| `worker/` | Cloudflare Worker 代理及其测试、部署说明 |
| `tests/` | 前端回归测试（Node 22+，`node --test tests/*.test.mjs`） |
| `docs/交接.md` | 唯一状态源：现状、待办、常用命令、历史日志、技术参考 |
| `docs/项目详情.md` | 架构原理、设计系统、文件结构 |
| `CLAUDE.md` | 协作规矩（人和 AI 共用） |

## 本地检查

```sh
node --test tests/*.test.mjs
node worker/cache.test.mjs
git diff --check
```

密钥一律只放 Cloudflare Worker Secrets，变量名清单在 `docs/交接.md` 技术参考，值不进仓库。

---

曾用名 ember（2026-07 迁仓改名）；记忆系统 ember 现在是另一个仓库。
