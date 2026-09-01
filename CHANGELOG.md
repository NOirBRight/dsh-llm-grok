# Changelog

## 0.3.6

- Settings → LLM Providers: drag cards to reorder; chat picker follows `llm-providers.order` via dsh-llm-providers-ui.


## 0.3.5

- Fix sandbox escalation-schema leak: filter `sandbox_permissions` enum to strictly wider modes than the current DSH file policy before delegating to pi-ai/provider — scans DSH context-injection `options.messages` newest-to-oldest first, then falls back to `options.system` (handles stale system due to appended injection). Applies to both direct `stream` and `prepareCall` stream paths, before pi-ai/server-search tool injection. Preserves immutability and always-on `web_search`/`x_search`. Regression covered: stale `workspace-write` system + latest `danger-full-access` message removes escalation fields.


## 0.3.4

- Support the DSH 0.1.2-alpha.1 Host image-pricing call with neutral heuristic pricing
- Restore published-RC and alpha1 client build compatibility
- Add frozen-install CI and built-adapter release checks

## 0.3.2

- Unify model catalog to opencode baseline (Context first row, Vision/Reasoning/Default thinking second row, 32/36px)


## 0.3.1

- Render Command Code and other new keyed providers in the shared LLM Providers section instead of a fixed four-plugin list.

## 0.3.0

- Register an optional Model Switch v0.2 Image adapter through the existing authenticated Grok Imagine tool.
- Preserve standalone Grok chat and `grok_image_gen`; register no Search or Vision adapter.
- Normalize custom output-path extensions to the image media type returned by Grok Imagine.


## 0.2.8

- Preserve ordinary chat image attachments on DSH 0.1.1-rc.2 by declaring its resolved request-image budgets
- Add a regression test for the rc.2 image-budget contract

## 0.2.7

- Own `prepareCall` so dsh 0.1.1-rc.2 Host can snapshot provider options before streaming
- Widen Host peer ranges to `>=0.1.0-rc.6 <0.1.1 || >=0.1.1-rc.1 <1.0.0`

## 0.2.6

- dsh RC1 compatibility

## 0.2.5

- Optional `grok_image_gen` tool: SuperGrok session against Imagine REST (`POST /v1/images/generations`), default off. Distinct from Codex `codex_generate_image`.
- Map undici `terminated` body drops to a readable Imagine error and retry the POST once

## 0.2.4

- Skip injecting server-side `web_search` when a DSH function tool already uses that name (Grok 400 Duplicate tool names)

## 0.2.3

- Match the complete observed xAI capacity response while leaving generic provider and quota failures non-retryable

## 0.2.2

- Retry model requests up to eight times by default; provider configuration can override the budget
- Classify xAI capacity/high-demand failures as `RATE_LIMIT` and temporary availability degradation as `SERVER`

## 0.2.1

- Show official reset time under usage bars (period end from SuperGrok billing)
- Rename Settings nav/title from Providers to LLM Providers / LLM 供应商

## 0.2.0

- Move the settings card from Plugins to Settings → Providers
- The Providers nav row is claimed by the first installed provider plugin and disappears when all of them are uninstalled
- Collapsed cards show a short connection status and model count, not the account email
- Usage refresh shows a skeleton, a spinning official refresh glyph, a failure hint next to the button, and a last-updated clock

## 0.1.4

- Official Grok 4.6 / 4.5 context window is 500000 (models-v2, Grok Build CLI, and xAI docs). Frozen catalog and the missing-row fallback no longer use 262144.

## 0.1.3

- Honor per-row `contextWindow` in chat/compaction instead of always using a hardcoded default
- Per-row Default thinking and Context window; Tools checkbox removed (it never changed requests)

## 0.1.2

- Drop Grok server-search echoes (`xs_call-*` / `ws_call-*` custom tool calls named like `x_keyword_search`) so DSH does not paint `unknown tool`. Search already ran on the proxy; results stay in packed `tco_*` replay.

## 0.1.1

- Hide empty Grok Think rows. Server-side `web_search` / `x_search` come back as encrypted `tco_*` reasoning items with no summary; those stay in replay but no longer each paint a Think block.

## 0.1.0

First public release.

- Sign in with an xAI subscription (SuperGrok / X Premium+) through Host-owned PKCE. No console API key.
- Chat through `POST https://cli-chat-proxy.grok.com/v1/responses` with always-on server-side `web_search` and `x_search`.
- Official `reasoning.effort` values: `low`, `medium`, `high` (default), and `xhigh` on Grok 4.6.
- Plugin card: login, credits usage, and an editable displayed model catalog separate from the account list.
