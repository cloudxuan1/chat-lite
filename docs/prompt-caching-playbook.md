---
name: prompt-caching-playbook
description: "提示词缓存通用剧本——OpenRouter/Anthropic 官方规则 + kiwi-mem 踩坑教训 + 星露谷已验证实现；给任何 LLM 项目省钱提速用，轩说\"基本每个项目都要用\"（2026-07-15 星露谷实战验证：7351/7354 token 命中）"
metadata: 
  node_type: memory
  type: reference
---

# 提示词缓存剧本（2026-07-15 验证）

## 官方规则（OpenRouter → Anthropic Claude）

- **前缀必须字节级完全一致**，中间变一个字后面全失效
- **起缓门槛**：Sonnet/Opus4.1 系 1024 token；Opus 4.5+ 系 4096；Haiku3.5 2048。不满不缓存（无副作用）
- **断点**：块级 `cache_control: {"type": "ephemeral"}` 最多 **4 个**；也有顶层自动模式（请求根部一个 cache_control，自动断在最后可缓存块并随对话推进）
- **TTL**：默认 5 分钟；`"ttl": "1h"` 可选（写价从 1.25 倍涨到 2 倍）
- **价格**：写 1.25x / 读 **0.1x**
- **验证命中**：响应 `usage.prompt_tokens_details` 里 `cached_tokens`（>0 命中）和 `cache_write_tokens`

## kiwi-mem 的踩坑教训（~/Desktop/自建前端/kiwi-mem）

1. **动态内容绝不能排在缓存段中间**（他家 issue #8 / commit 5be7ab7）：秒级时间戳渲染在 system 静态区，每轮请求整段前缀失效。修法：日期降到天级留静态区，分钟级时间挪到断点之后的动态区
2. **供应商白名单**：只对确认透传 cache_control 的链路启用（OpenRouter/Anthropic 直连/aihubmix + Claude 系模型）——别家可能丢字段却照常计费
3. **分层断点设计**：system 按变化频率拆段（人设/画像几乎不变→断点1；日历/项目指令天级→断点2；时间/检索碎片等动态尾巴不打）；messages 里挑靠近末尾的稳定消息打断点
4. **每轮都变的检索结果/搜索碎片塞进最后一条 user 消息**，不进 system 不进历史，不污染前缀
5. 断点数算完超 4 就撤 messages 断点保 system 的
6. kiwi 关键代码：`main.py:544-663`（断点构造）、`main.py:1814-1897`（切分打标）、`anthropic_adapter.py:180+`（usage 转发）

## 星露谷的已验证极简实现（可直接抄）

`~/Desktop/项目文件/260704星露谷游戏桥/tools/companion_core/llm_client.py` 的 `supports_prompt_cache` + `apply_prompt_cache_breakpoints`：

- **三断点布局**：①system 末尾 ②倒数第二条消息（历史前缀跨问题复用）③当前问题消息末尾（多轮工具/查询回路的二次请求整段命中——主收益）
- 断点在 extend(extra_messages) **之前**打，保证二轮前缀与一轮完全一致
- OpenAI 兼容 SDK 写法：content 从字符串转成 `[{"type":"text","text":...,"cache_control":{"type":"ephemeral"}}]` 块数组即可，SDK 原样透传
- 实测：第 1 发 cache_write 7351，第 2 发 cached_tokens 7351/7354（99.96% 命中）

## 通用检查单（新项目接入时过一遍）

1. 消息结构是不是"稳定在前、易变在后"？状态/时间戳类内容有没有混进前缀？
2. 模型+供应商在白名单里吗？
3. 前缀段够 1024 token 吗？
4. 断点 ≤4？多轮回路的断点是否打在追加消息之前？
5. 上线后拿真实两连发验证 cached_tokens，不要"应该命中了"

相关：[[zahuopu]]（OpenRouter 偏好条目）
