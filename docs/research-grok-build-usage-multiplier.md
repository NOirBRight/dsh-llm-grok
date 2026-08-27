# Research: Grok Build 外部使用是否按 4 倍扣量

Date: 2026-08-22  
Status: findings (no implementation)

## 结论

**没有找到 xAI 官方“只要不在 Grok Build 内使用，就固定按 4 倍扣订阅额度”的规则。**

目前能被官方材料确认的是三件事：

1. SuperGrok 现在采用跨产品共享的周用量池；不同产品/动作按计算成本消耗不同，但 xAI 没公开精确换算公式。
2. Grok 4.6 发布时，xAI 明确给 **Grok Build 和 Cursor 首周 2 倍 included usage**。这是 Build/Cursor 内部临时加量，不是外部固定 4 倍惩罚。公告日期为 2026-08-12；按“首周”字面，截至本报告日期 2026-08-22 已结束，除非 xAI 后台另有未公告延长。
3. Grok 4.6 的普通输入价是 **$2/M tokens**，缓存输入价是 **$0.50/M tokens**，恰好相差 **4 倍**。官方文档警告：不传稳定的 `prompt_cache_key` / `x-grok-conv-id` 时，经常会落到冷缓存并按完整输入成本计算。官方 Grok Build 源码会发送稳定的 conversation/session 等亲和标识。

所以社区测到“外部客户端约 4 倍”很可能是真实观感，但更合理的解释是：**外部客户端缓存亲和没做对，历史上下文重复按完整输入处理；而 Grok Build 的缓存命中更好。** 这不是一个已公开的固定 4x 产品倍率，而且实际总消耗还包含输出、推理、工具调用、上下文长度，因此不一定严格等于 4。

## 官方依据

### 共享池没有公开固定产品倍率

xAI 的 Grok FAQ 说明：付费用户获得一个跨 API、Build、Chat、Imagine、Voice 使用的共享周额度；不同产品根据所需计算量消耗不同。FAQ 没给“Build 外 ×4”的数字或换算表。

来源：<https://docs.x.ai/grok/faq>

### Grok 4.6 的确给过 Build/Cursor 内部加量，但只有 2 倍且限首周

官方发布公告原文：

> We’re offering 2x included usage inside Grok Build and Cursor for the first week.

来源：<https://x.ai/news/grok-4-6>

此前 Grok 4.5 也曾在 Build/Cursor 提供 limited-time free usage，说明 xAI 确实会对指定产品做阶段性补贴，但这仍不是永久的外部 4 倍规则。

来源：<https://x.ai/news/grok-4-5>

### “4 倍”与 Grok 4.6 缓存价差完全吻合

官方定价（短上下文与长上下文比例相同）：

| Grok 4.6 输入 | 普通 | 缓存 | 比例 |
|---|---:|---:|---:|
| < 200k context | $2.00/M | $0.50/M | 4:1 |
| ≥ 200k context | $4.00/M | $1.00/M | 4:1 |

来源：<https://docs.x.ai/developers/pricing>

官方 Grok 4.6 文档明确建议 Responses API 设置 `prompt_cache_key`，Chat Completions 设置 `x-grok-conv-id`；否则请求可能落到没有缓存的服务器并支付完整输入价格。

来源：

- <https://docs.x.ai/developers/grok-4-6>
- <https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing>
- <https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits>

官方 Grok Build 源码会附加 `x-grok-conv-id`、`x-grok-session-id`、`x-grok-req-id`、`x-grok-turn-idx` 等请求标识，其中稳定 conversation ID 对缓存路由最关键。

来源：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-sampler/src/client.rs>

### Build 外使用订阅本身是官方支持的

xAI 官方曾宣布 SuperGrok/X Premium 订阅可直接用于 OpenCode、Kilo Code、Warp、Hermes 等外部客户端。因此“在 Build 外使用”本身不是非官方场景，也不能据此推断统一惩罚倍率。

来源：

- <https://x.ai/news/grok-opencode>
- <https://x.ai/news/grok-kilocode>
- <https://x.ai/news/grok-warp>
- <https://x.ai/news/grok-hermes>

## 对 dsh-llm-grok 的影响

当前插件走的是订阅对应的 `cli-chat-proxy.grok.com`，并发送 `x-grok-client-version` / `x-grok-client-identifier: grok-shell`，所以不是误走 console API 计费轨。

但仓库当前没有发送 `prompt_cache_key`、`x-grok-conv-id`、`x-grok-session-id` 等缓存亲和字段：

- `src/cli-identity.ts`：只有版本与客户端标识。
- `src/pi-ai-profile.ts`：只叠加上述字段及 `X-Dsh-Plugin`。

因此，如果社区反馈针对本插件，**最值得优先排查的是缓存亲和缺失**。对输入占比很高、不断携带历史的 agent 会话，这足以制造接近 4 倍的输入侧用量差异。

建议下一步做 A/B：同模型、同 reasoning effort、同历史，分别使用稳定 conversation cache key 与无 key 请求，记录响应中的 `usage.input_tokens_details.cached_tokens` 和订阅用量增量。不要只比较两次不同任务后的百分比。
