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

The frozen model catalog (`grok-4.6` with reasoning and vision) is shown read-only. When signed in, the card shows subscription usage from a Host billing read. Chat lands in a later ticket.

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
