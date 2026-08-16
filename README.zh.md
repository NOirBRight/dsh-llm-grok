# dsh-llm-grok

[English](README.md) | 中文

DeepSeek Harness 的 xAI Grok 集成。本插件使用独立的提供方路由（`grok`）和设置命名空间（`llm-grok`）。它不替代内置的 `xai` console API key 路由，也不声明 `apiKeyEnv`。

包根入口公开 Cordis plugin contract。同一 artifact 还导出 `./client`，在 Settings → Plugins → Plugin configuration 中提供 Grok 卡片。

## 安装

要求 DeepSeek Harness 0.1.0-rc.6 或更高版本。直接从 GitHub 安装：

~~~sh
dsh plugin --profile web add github:NOirBRight/dsh-llm-grok
dsh web
~~~

仓库跟踪可直接发布的 lib artifacts，因此 GitHub 安装不需要 build-script allowlist。源码 checkout 可在执行 `pnpm run build` 后使用 link 安装。

## Web 配置

打开 Settings → Plugins → Plugin configuration → Grok。**用 xAI 登录**会在 Host 上对 `auth.x.ai` 走 PKCE（与 Grok CLI 同一公开 client），打开系统浏览器，并把会话只写在 Host 的 `$DSH_HOME/grok-oauth.json`（权限 `0600`）。卡片随后显示账号邮箱。退出登录会删除该文件。浏览器永远收不到 token。本插件不读、不写 `~/.grok/auth.json`。

冻结的模型目录（`grok-4.6`，带推理和视觉）只读展示。登录后，对话选择器会列出这些模型，并经 `POST https://cli-chat-proxy.grok.com/v1/responses` 流式聊天。每条请求都带上 DSH function tools，以及始终开启的服务端 `{ type: "web_search" }` 与 `{ type: "x_search" }`。搜索不是 `ctx.web` 提供方。额度属于后续工单。

未登录就聊天会失败为 `MISSING_CREDENTIAL`。已有会话但 refresh 失败会清会话并失败为 `AUTH`。每次聊天请求前已经跑过 `ensureFreshSession`；之后的 401 不再在 Responses 层重试。

Proxy 身份头先用本插件自己的名称和版本（`X-Dsh-Plugin: dsh-llm-grok/<version>`）。Harness 还会发送标准 `User-Agent`。本包不发送 Grok CLI 兼容头。若以后 proxy 因缺 CLI 头返回 426，再用使请求成功的最小兼容头，并把它写成兼容约束，而不是冒充官方 CLI。

Models 页面如果列出 Grok，也只是 hint。因为本包不声明 `apiKeyEnv`，该行不应出现「缺 API key」红点。

## 配置

~~~yaml
- id: llm-grok
  name: 'dsh-llm-grok'
  config:
    streamIdleTimeoutMs: 300000
    retryPolicy:
      mode: normal
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
~~~

没有 `apiKeyEnv`，也没有用户可改的 base URL。模型目录是源码常量，不是设置字段。
