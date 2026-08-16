# dsh-llm-grok 设计

日期：2026-08-17  
状态：已讨论通过，待按本文实现

第三方 DeepSeek Harness 插件：用 xAI 订阅 OAuth（SuperGrok / X Premium+）登录，经 Grok CLI 同款会话入口聊天。不做 console API key。不替代 DSH 内置的 `xai` 路由。

## 1. 产品范围

### V1 做

- 本机浏览器 PKCE 登录 / 登出（`auth.x.ai`）
- 插件自管会话与 refresh（不读、不写 `~/.grok/auth.json`）
- 固定模型 catalog（源码常量，不拉账号目录）
- Responses 聊天，打到 `https://cli-chat-proxy.grok.com/v1`
- 每条聊天请求带上 xAI server-side `web_search` 与 `x_search`
- Plugin 卡展示额度（Host 读 billing，浏览器不碰 token）

### V1 不做

- API key 登录或回退
- Device-code
- 按账号拉取 / 编辑 catalog
- `ctx.web` search / fetch 提供方（Fetch 继续用 DSH 内置 HTTP）
- 双协议（Completions + Responses）
- 复用或同步 Grok CLI 凭据

以后若加 device-code、账号 catalog、usage 字段细化，只动对应模块，不改 provider id 与 settings namespace。

## 2. 身份与安装面

| 项 | 值 |
|---|---|
| 包名 | `dsh-llm-grok` |
| Cordis 插件名 | `llm-grok` |
| Provider 路由 | `grok` |
| Settings namespace | `llm-grok` |
| 展示名 | Grok |
| 聊天 | `POST https://cli-chat-proxy.grok.com/v1/responses` |
| 授权 | `https://auth.x.ai` |

不与内置 `xai`（console API key）撞车。

包结构对齐 `dsh-llm-ollama`：`src/` + `src/client/`，导出 `.`、`./client`、`./invariant`，`dsh.client.inject` 与 ollama 同套 Web 客户端依赖。安装方式同样是 GitHub 源上带构建产物：`dsh plugin --profile web add github:…`。

## 3. 为何不走 Models 页

DSH Models 页编辑器只手写两家：`llm-deepseek`、`llm-pi-ai`。其它 namespace 打开是 hint，Apply 禁用，没有 OAuth、没有模型清单、没有额度。

对话里的模型选择器走 `registerAdapter` → `listModels()`，与 Models 页编辑器无关。

因此：

- 登录、额度、catalog **展示** 全部在 Settings → Plugins → Plugin configuration。
- `registerAdapter(['grok'], adapter)`：picker 能选模型。
- `registerConfigurableProviders([{ provider: 'grok', displayName: 'Grok', settingsNs: 'llm-grok', settingsPath: [] }])`：Models 页可以有一行，点进去不能配。
- **不**声明 `apiKeyEnv`，避免该行出现「缺 API key」红点（OAuth 不是 API key）。

## 4. 模块

| 模块 | 职责 |
|---|---|
| `oauth.ts` | PKCE 启停、换票、refresh |
| `session.ts` | 会话读写；仅 Host |
| `adapter.ts` | `GrokAdapter`，委托 `PiAiAdapter` |
| `pi-ai-profile.ts` | Responses profile：proxy 基址、模型描述、身份头 |
| `responses-tools.ts` | 在发出的 Responses 体上拼 `web_search` / `x_search` |
| `usage.ts` | 读 billing，解码成卡上视图 |
| `client-contract.ts` | 常量、JSON 解码、RPC 形状（Host/Client 共享，无密钥） |
| `index.ts` | 注册 adapter、settings、RPC |
| `client/` | Plugin 卡 |

## 5. 登录与会话

### 流程

1. 卡上「用 xAI 登录」→ loopback RPC `auth/start`。
2. Host 在 `127.0.0.1` 随机端口听 callback，生成 PKCE S256，打开系统浏览器到 `auth.x.ai`（Grok CLI 同款公开 OAuth client：issuer `https://auth.x.ai`，client_id 钉死当前 CLI 公开值）。
3. callback 校验 `state`，换 access / refresh，写入会话，关掉 listener。
4. 用户取消、浏览器不回跳、或超时：不写半截会话，RPC 回可重试失败。
5. `auth/status` 只回 `{ loggedIn, email?, expiresAt? }`。
6. `auth/logout` 删除会话文件。

Client 只发起与展示状态。Token 不进浏览器、不进 settings、不进日志。

### 存储

会话文件：`$DSH_HOME/grok-oauth.json`，权限 `0600`。内容为 access token、refresh token、expiry、账号标识（email / user id，有则存）。

刷新：每次聊天或读额度前，若即将过期则 refresh；请求 401 再 refresh 一次后重试。refresh 失败 → 清会话，聊天报 `AUTH`，卡上回到未登录。

不读、不写 `~/.grok/auth.json`。

## 6. 聊天与搜索

`GrokAdapter` 委托 `PiAiAdapter`。Profile：

- `api`: OpenAI Responses
- `baseURL`: `https://cli-chat-proxy.grok.com/v1`
- 模型来自固定 catalog
- 每请求把当前 access token 交给 `resolveApiKey`（只传 access token，不传会话 JSON）

`PiAiAdapter` 只会把 DSH function tool 编成 `{ type: "function" }`。`responses-tools.ts` 在请求发出前把 `{ type: "web_search" }` 与 `{ type: "x_search" }` 追加进 `tools`。pi-ai 的 Responses 解析忽略不认识的 `web_search_call` / `x_search_call`；服务端搜完模型继续吐文本，DSH 不执行搜索、不把搜索伪造成 `ctx.web`。

V1 这两项搜索始终开启，卡上不提供开关。

Proxy 身份头：先用本插件自己的标识（名称 + 版本）。若 proxy 因缺 CLI 头返回 426，再用使请求成功的最小兼容头，并在 README 写明这是兼容约束、不是冒充官方 CLI 产品。

## 7. 固定 catalog

源码里一份冻结列表，V1 不请求 models-v2。必有：

| id | thinking | vision |
|---|---|---|
| `grok-4.6` | 是 | 是 |

实现时若核对 proxy / Grok CLI 还有当前订阅稳定在用的 id（例如同代非推理变体），只允许追加进同一常量，不允许改成在线发现。

Plugin 卡只读展示该列表（id、能力旗标）。用户在对话 picker 里选模型。档位不够用某模型时，把提供方错误原样交给 DSH，卡上不预判档位。

## 8. 额度

卡上独立一节，对标 `dsh-llm-ollama` 的 usage。

- RPC `usage/read`。未登录不打网，回未登录。
- Host 用当前会话请求 `GET https://cli-chat-proxy.grok.com/v1/billing`（实现时按真实 JSON 解码；字段对不上或 404 → `unsupported`）。
- 浏览器只收已解码视图（窗口：已用 / 上限 / 周期），永不收 token。
- 有数据：用量条。无此面：一句「不支持」，不是错误。传输失败才是错误。

## 9. RPC

Channel：`/grok`，`authority: 'loopback'`。

| endpoint | 作用 |
|---|---|
| `auth/start` | 开始 PKCE |
| `auth/status` | 登录态，无密钥 |
| `auth/logout` | 清会话 |
| `usage/read` | 额度快照或 unsupported |

载荷用 `client-contract.ts` 的解码函数校验。未知 endpoint 回内部错误。

## 10. Settings

`installSettingsSection` 挂 `llm-grok`。V1 节里只有非密钥运行参数：`streamIdleTimeoutMs` 默认 300000，retry 用 DSH 普通默认。没有 `apiKeyEnv`，没有用户可改的 baseURL。

## 11. 错误

| 情况 | 结果 |
|---|---|
| 未登录就聊 | `MISSING_CREDENTIAL` |
| refresh 失败 / 会话作废 | `AUTH`，卡上未登录 |
| PKCE 取消或超时 | 卡上可重试，无会话文件 |
| 额度无此面 | unsupported，非错误 |
| 额度传输失败 | 卡上错误文案，无密钥 |
| 模型档位不够 | 提供方错误原样上抛 |

日志与错误细节不得包含 access token、refresh token、authorization 头。

## 12. 测试

不打真实 xAI。本地假服务器覆盖：

- PKCE：`state` 不匹配拒绝；成功换票后文件权限与字段
- refresh：过期先刷；401 刷一次再重试；刷失败清会话
- Responses：发出的 JSON 含 DSH function tools **以及** `web_search` / `x_search`
- 额度：正常视图 / unsupported / 未登录不请求
- Client：未登录 / 已登录 / 额度三种状态；catalog 只读

`pnpm run check` = `build` + `test` + `pack:check`（pack 清单对齐 ollama：`lib/`、`cordis.patch.yml`、README）。

## 13. 非目标（防止回潮）

- 不把搜索做成 `ctx.web` provider，即使以后有人用 Responses 包装一层「假搜索引擎」。
- 不在 Models 页做 OAuth 或 catalog 编辑。
- 不把订阅会话当 `XAI_API_KEY` 打 `api.x.ai`。
- 不在 V1 做 usage 的计费跳转或「管理订阅」外链，除非 billing 响应当场带了无密钥的官方 URL。
