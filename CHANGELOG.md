# Changelog

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
