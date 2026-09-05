# dsh-llm-grok

[English](README.md) | 中文

DeepSeek Harness 的 xAI Grok 集成。本插件使用独立的提供方路由（`grok`）和设置命名空间（`llm-grok`）。它不替代内置的 `xai` console API key 路由，也不声明 `apiKeyEnv`。

包根入口公开 Cordis plugin contract。同一 artifact 还导出 `./client`，在 Settings → LLM Providers 中提供 Grok 卡片。

## 兼容性

已验证运行时是 DeepSeek Harness `0.1.2-alpha.4` 与 `0.1.2-rc.1`（Cordis `4.0.2`）；这份记录只是证据，不是 allowlist。

未知的新版本会先打一条 warning，再按正常挂载路径 best-effort 尝试，不会因为未验证而跳过。

只有复现过的故障才会加入 blocklist；受影响版本、原因和证据见[兼容性记录](package.json)。


## 安装

直接从 GitHub 安装：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-providers-ui/releases/download/v0.1.9/dsh-llm-providers-ui-0.1.9.tgz
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-grok/releases/download/v0.3.11/dsh-llm-grok-0.3.11.tgz
dsh web
~~~

仓库跟踪可直接发布的 lib artifacts，因此 GitHub 安装不需要 build-script allowlist。

## LLM Providers UI ownership

**LLM 供应商**设置页（`settings.section` 的 `id: providers` 及子槽 `settings.provider.item`）与共享的 `llm-providers` 排序存储完全由 `dsh-llm-providers-ui` 拥有。

- 本插件仅贡献自己的卡片（`key: llm-grok`）和 Host 上的 `llm` 路由；不安装页面或共享命名空间。加载顺序不影响归属。
- 未安装 owner 时（Headless 或 Web 未装 `dsh-llm-providers-ui`）：Host 侧模型路由 `grok` 仍可工作；Web 侧 Providers 页面与本卡片不显示。`pack:check` 会校验 owner artifact 的身份、`./sortable` 导出和打包后的 client closure。
- 导航地球图标为 Alpha.4 临时 DOM 适配器，仅由 `dsh-llm-providers-ui` 持有；本插件不含该适配器。

请在 profile 中与 provider 插件一起显式安装 `dsh-llm-providers-ui`（见其 `cordis.patch.yml`）。

## Web 配置

打开 Settings → LLM Providers → Grok。**用 xAI 登录**会在 Host 上对 `auth.x.ai` 走 PKCE（与 Grok CLI 同一公开 client），打开系统浏览器，并把会话只写在 Host 的 `$DSH_HOME/grok-oauth.json`（权限 `0600`）。卡片随后显示账号邮箱。退出登录会删除该文件。浏览器永远收不到 token。本插件不读、不写 `~/.grok/auth.json`。

### 插件配置

![Grok 插件卡：订阅登录、用量与模型目录](docs/images/plugin-card.png)

Plugin 卡上有两份目录：登录后从 `GET /v1/models-v2` 读到的账户列表，以及存进 `settings.models` 的显示子集。对话选择器只用显示子集。每行可设默认思考和作为 DSH 压缩预算的上下文窗口。官方 `grok-4.6` / `grok-4.5` 默认为 500,000 tokens。卡片上的目录默认折叠，可以拖动、改、删，或从账户列表里挑 1–2 个。尚未保存过时，默认显示 `grok-4.6` 和 `grok-4.5`。聊天走 `POST https://cli-chat-proxy.grok.com/v1/responses`。每条请求都带上 DSH function tools，以及始终开启的服务端 `{ type: "web_search" }` 与 `{ type: "x_search" }`。搜索不是 `ctx.web` 提供方。服务端搜索会以加密的 `tco_*` reasoning 项回放；这些项没有可见 summary，不会再各画一个空 Think 块。若 Grok 把同一次搜索再回成客户端 `custom_tool_call`（`xs_call-*` / `ws_call-*`，名字常抄成 `x_keyword_search`），插件会丢掉，避免 DSH 报 `unknown tool`。推理按官方 Responses 字段 `reasoning: { effort }` 传递，取值为 `low` / `medium` / `high`（默认）/ `xhigh`（仅 4.6）。登录后卡片还会展示 Host 读取的订阅额度（`GET /v1/billing?format=credits`）。未登录不请求额度；无法识别的接口显示为不支持，而不是错误。

安装 `dsh-model-switch` v0.4.x 后，Grok 还会给统一的 `generate_image` 路由注册一个可选的 Image-only Adapter。它复用同一套认证实现，不注册 Search 或 Vision Adapter；独立运行行为不变。

可选的 **`grok_image_gen`**（默认关闭）会注册一个模型可调用的生图工具，走 Grok Imagine。它复用同一套 Host OAuth 会话，请求 `https://api.x.ai/v1/images/generations` —— 和 Grok Build 本地 `image_gen` 同一条轨，不是 console API key，也不是聊天 proxy。工具名与 Codex 的 `codex_generate_image` 区分。生成的图会写到工作区并通过 attachment store 落盘。

未登录就聊天会失败为 `MISSING_CREDENTIAL`。已有会话但 refresh 失败会清会话并失败为 `AUTH`。每次聊天请求前已经跑过 `ensureFreshSession`。之后若在没有任何模型内容前收到 `AUTH`（HTTP 401），会强制 refresh 再打一次请求；仍失败的 `AUTH` 进入 bundle 默认的八次 normal 重试。

每条 proxy 请求都会带上本插件的 `X-Dsh-Plugin` 身份，以及 proxy 要求的 CLI 版本头（`x-grok-client-version` / `x-grok-client-identifier`）。缺版本会 426。这些头是 proxy 要求的字段，不是冒充官方 CLI。

Models 页面如果列出 Grok，也只是 hint。因为本包不声明 `apiKeyEnv`，该行不应出现「缺 API key」红点。

## 配置

~~~yaml
- id: llm-grok
  name: 'dsh-llm-grok'
  config:
    streamIdleTimeoutMs: 300000
    retryPolicy:
      mode: normal
      maxRetries: 8
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
~~~

bundle 默认对符合条件的模型请求失败最多重试八次，包括 `AUTH`。xAI 容量不足/高需求失败归类为 `RATE_LIMIT`；临时可用性下降归类为 `SERVER`。

没有 `apiKeyEnv`，也没有用户可改的 base URL。`models` 是对话里显示的目录，是账户列表的一个子集。

Composer picker 会按剥掉 Fast 后缀（`-fast`）和通用上下文后缀（`-<n>k` / `-<n>m`）后的 base 把兄弟行收成一个家族。`kimi-k3-max` 这类产品名不算档位。本包目录来自 discovery；若要让 DSH 按更小预算压缩，自行加带后缀的行。本插件不会在发请求前剥这些后缀。

## 正式版安装（Latest）

xAI Grok subscription login, Responses chat, usage, search, and Imagine. 正式成品按上方兼容性记录运行；发布包只包含构建后的 Host/Client 产物，不包含兄弟仓库源码、本机路径或 link:/workspace: 依赖。

LLM Providers 页面、导航和共享排序由 dsh-llm-providers-ui 独占；本插件只提供卡片、模型和 Host 路由。Web 必须先装 Owner，headless 只使用 Host 路由时可以不装 Owner。

Owner（Latest）：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-providers-ui/releases/latest/download/dsh-llm-providers-ui-0.1.9.tgz
~~~

本 Provider（Latest）：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-grok/releases/latest/download/dsh-llm-grok-0.3.11.tgz
~~~

固定版本（可复现）：

~~~sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-providers-ui/releases/download/v0.1.9/dsh-llm-providers-ui-0.1.9.tgz
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-grok/releases/download/v0.3.11/dsh-llm-grok-0.3.11.tgz
~~~

更新、卸载与验证：

~~~sh
# 更新到最新 Release
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-grok/releases/latest/download/dsh-llm-grok-0.3.11.tgz
# 验证加载与版本
dsh plugin --profile web list
dsh plugin --profile web doctor
# 只卸载本插件
dsh plugin --profile web remove dsh-llm-grok
~~~

配置入口：Web 使用「设置」中的本插件页面；Host-only 插件使用 profile 的 dsh.profile.bundles 配置。先复制本 README 的最小 YAML/JSON 示例，再填写凭据或后端地址。

回滚：重新执行固定版本 v0.3.7 命令，确认插件列表后只重启一次 Web 服务。失败时查看 journalctl --user -u dsh-web.service 与 dsh plugin --profile web doctor，不要把源码 checkout 写入 production profile。

Release 与完整性：[v0.3.11](https://github.com/NOirBRight/dsh-llm-grok/releases/tag/v0.3.11) · [SHA256SUMS](https://github.com/NOirBRight/dsh-llm-grok/releases/download/v0.3.11/SHA256SUMS)。

## 独立 Model Switch 搜索

Host 通过现有 Model Switch 注册表同时注册 Search 与 Image adapter，并做生命周期释放。独立搜索声明支持的 Grok 对话模型，调用已有订阅 Responses 端点与必需的服务端搜索工具，复用 provider token 解析与身份头。只有原生 URL 引用/搜索调用结果才会成为来源；缺凭据、不支持的模型、无搜索证据的响应都会明确失败，不暴露上游错误体。这与“对话模型自带联网”不是一回事。

这需要协同的 Model Switch 动态搜索实现（`dsh-model-switch` 0.4.7；本 adapter 按 0.4.6 注册表契约构建）。注册 adapter 不会切换全局 Web 路由：显式配置 `web.searchProvider: model-switch`（保留其余 Web 配置），再在 Model Switch 中选择 provider/model。`web_fetch` 不变，不注册替代 web 工具。ProviderDirectory 延迟 role/usage 集成保持不变。

验证：`pnpm test`（143 通过）、`pnpm run build`；3082 官方 Web 先后用 `grok-4.6` 与 `grok-4.5` 选中，均返回真实来源。lab 组成与证据见 Model Switch 集成审计。
