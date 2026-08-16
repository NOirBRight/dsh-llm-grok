# dsh-llm-grok

English | [中文](README.zh.md)

xAI Grok integration for DeepSeek Harness. This plugin is a separate provider route (`grok`) and settings namespace (`llm-grok`). It does not replace the built-in `xai` console API-key route, and it does not declare `apiKeyEnv`.

The package root exposes the Cordis plugin contract. The same artifact exports `./client`, which contributes the Grok card under Settings → Plugins → Plugin configuration.

## Installation

DeepSeek Harness 0.1.0-rc.6 or later is required. Install directly from GitHub:

~~~sh
dsh plugin --profile web add github:NOirBRight/dsh-llm-grok
dsh web
~~~

The repository tracks release-ready lib artifacts, so GitHub installation needs no build-script allowlist. A source checkout can use a link installation after running `pnpm run build`.

## Web configuration

Open Settings → Plugins → Plugin configuration → Grok. **Sign in with xAI** starts a Host-owned PKCE flow against `auth.x.ai` (the Grok CLI public client), opens the system browser, and stores the session only on the Host at `$DSH_HOME/grok-oauth.json` (mode `0600`). The card then shows the account email. Sign out deletes that file. The browser never receives tokens. This plugin does not read or write `~/.grok/auth.json`.

The frozen model catalog (`grok-4.6` with reasoning and vision) is shown read-only. After sign-in, the conversation picker lists those models and streams through `POST https://cli-chat-proxy.grok.com/v1/responses`. Every request includes DSH function tools plus always-on server-side `{ type: "web_search" }` and `{ type: "x_search" }`. Search is not a `ctx.web` provider. When signed in, the card also shows subscription usage from a Host billing read (`GET /v1/billing`). Logged-out cards do not request billing; an unrecognized surface is shown as unsupported, not as an error.

Chat without a session fails `MISSING_CREDENTIAL`. A stored session whose refresh fails is cleared and fails `AUTH`. `ensureFreshSession` already runs before each chat request; a later 401 is not retried at the Responses layer.

Proxy identity starts as this plugin's own name/version (`X-Dsh-Plugin: dsh-llm-grok/<version>`). The harness also sends its standard `User-Agent`. This package does not send Grok CLI compatibility headers. If the proxy later answers 426 for missing CLI headers, the minimum headers that make the request succeed would be a documented compatibility constraint, not an attempt to impersonate the official CLI.

The Models page, if it lists Grok at all, is hint-only. Because this package does not declare `apiKeyEnv`, that row must not show a missing-API-key badge.

## Config

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

There is no `apiKeyEnv` and no user-editable base URL. Catalog membership is a source constant, not a settings field.
