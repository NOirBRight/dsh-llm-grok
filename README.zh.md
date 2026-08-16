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

打开 Settings → Plugins → Plugin configuration → Grok。卡片目前展示未登录状态、不可用的登录控件，以及冻结的模型目录（`grok-4.6`，带推理和视觉）。登录、聊天和额度属于后续工单。

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
