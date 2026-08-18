# Changelog

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
