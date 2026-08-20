# Research: wrapping Grok image generation as a DSH tool

Date: 2026-08-20  
Status: findings (no implementation)

Corrected after inspecting **Grok Build CLI 1.0.5** on this machine. CLI 能生图、且默认**不需要** `XAI_API_KEY`。DSH 要对齐的是这条，不是 console API-key 文档轨。

## Executive conclusion

**可以，而且应该按 Grok Build 的本地工具来包，不另配 API key。**

Grok Build 并不是在聊天里塞服务端 `{ type: "image_generation" }`。它注册的是 **client-side function tools**：

| CLI 工具 | 作用 | 模型参数 |
|---|---|---|
| `image_gen` | 文生图 | `prompt`（必填），`aspect_ratio`（可选） |
| `image_edit` | 改已有图 | `prompt`, `image`（路径或 data URL），可选 `aspect_ratio` |
| `image_to_video` / `reference_to_video` | 视频 | 另议 |

`/imagine <prompt>` 只是一段注入词，强迫模型立刻 `image_gen`，prompt 原样下传。真正发网的是 `ImageGenClient`：`POST /images/generations`（Imagine REST），把返回的 **base64** 落到磁盘。鉴权优先级是 **登录会话 token > `XAI_API_KEY`**。本机 CLI 文档：`~/.grok/docs/user-guide/02-authentication.md`、`04-slash-commands.md`。

`dsh-llm-grok` 已经有同一套 PKCE（同一 public client、同一 `grok-cli:access` + `api:access`）。缺的是把 `image_gen` / `image_edit` 登记到 `ctx.tools`，用现有 `grok-oauth.json` 去打 Imagine REST。

先前「必须 XAI_API_KEY」的结论只适用于**开发者文档上的 console 轨**。官方 CLI 自己用订阅会话打 `/images/generations`，这才是要对齐的产品行为。

## 1. Grok Build 实际怎么画图（本机 1.0.5）

二进制：`~/.grok/downloads/grok-1.0.5-linux-x86_64`（`grok 1.0.5 (5115b46bc9)`）。源码路径烙在二进制里：

`crates/codegen/xai-grok-tools/src/implementations/grok_build/image_gen`  
`.../image_edit`  
`.../storage.rs`

### 1.1 `/imagine` 不是独立 HTTP 协议

内置 slash 文档（`~/.grok/docs/user-guide/04-slash-commands.md` Media Generation）：

- `/imagine <description>` — Generate an image from a text description
- `/imagine-video <description>` — 先规划镜头，`image_gen` 出图，再 `image_to_video`

二进制里 `/imagine` 注入的原文：

> Call the image_gen tool immediately, passing the user's prompt below verbatim — do not rewrite, embellish, or expand it. After the tool completes, briefly acknowledge and mention where the image was saved.

所以 `/imagine` = 强迫一次 `image_gen`。DSH 不需要实现 slash，直接把同名工具交给模型即可。

### 1.2 本地工具，不是 Responses 托管工具

捆绑 skill `~/.grok/bundled/skills/imagine/SKILL.md`：

- `image_gen`：新图，输入 `prompt` + 可选 `aspect_ratio`（`1:1` `16:9` `9:16` `4:3` `3:4` `auto`…）。没有 `n`/`count`，多张就多次调用。
- `image_edit`：已有图，`prompt` + `image`（文件系统路径或 `data:image/...;base64,...`）。

二进制类型：

- `ImageGenInput` 2 字段（与 skill 一致：prompt + aspect_ratio）
- `ImageEditInput` 3 字段
- `MediaGenOutput` 4 字段（邻近字符串有 `uploaded_url`）
- 实现类型名 `ImageGenClient`
- 并行上限 `[tools.media_gen] max_parallel_image_gen_calls`（默认 8）

这和 xAI 开发者文档里的服务端 `{ type: "image_generation" }` **不是同一条**。后者打 `api.x.ai/v1/responses`，回 `image_generation_call`；CLI 走的是 **function tool → 本地 ImageGenClient → Imagine REST**。

### 1.3 ImageGenClient 打哪

二进制错误串把后端叫 **Imagine API**：

- path：`/images/generations`（视频 `/videos/generations`）
- `Imagine API error:`
- `Image generation failed with HTTP …`
- `Imagine API returned unparseable body`
- `Failed to decode base64 image data`
- `persist to`（`storage.rs`）

配置里两套 base：

- `endpoints.cli_chat_proxy_base_url` → 聊天（本插件已用 `cli-chat-proxy.grok.com/v1`）
- `endpoints.xai_api_base_url` 默认 `https://api.x.ai/v1` → 媒体

所以：**聊天走 proxy，生图走 `api.x.ai` 的 Imagine REST，但 Bearer 是 CLI 登录会话，不是 console key。** 本机认证文档写明：有 `~/.grok/auth.json` 会话时，会话优先于 `XAI_API_KEY`；API key 只是没登录时的 fallback。

OAuth scope 同时要了 `grok-cli:access`（proxy 聊天/额度）和 `api:access`（`api.x.ai`）。本插件 `src/oauth.ts` 已经要了这两项。

### 1.4 和本插件的差距

| | Grok Build CLI | dsh-llm-grok 现在 |
|---|---|---|
| 登录 | PKCE，`~/.grok/auth.json` | 同一 client，`$DSH_HOME/grok-oauth.json`（故意不同步 CLI 文件） |
| 聊天 | cli-chat-proxy + CLI 版本头 | 已对齐（`x-grok-client-version` / `x-grok-client-identifier`） |
| 生图 | 本地 `image_gen` → `POST /v1/images/generations` | **没有** |
| 改图 | 本地 `image_edit` | **没有** |
| 搜索 | 服务端 `web_search` / `x_search` | 已注入 |

设计稿 V1 非目标「不把订阅会话当 `XAI_API_KEY` 打 `api.x.ai`」指的是**不要拿会话去当通用 console 聊天 key**。官方 CLI 生图本身就是会话打 Imagine REST。要对齐 CLI，这条非目标在生图工具上应改写，而不是另开 console key。

未做的唯一实测：用 **本插件的** `grok-oauth.json`（不是 `~/.grok/auth.json`）打一次 `POST https://api.x.ai/v1/images/generations`。同一 client / 同一 scope，预期可过；落地前用 lab 会话 spike 一次即可。

## 2. 怎么包成 DSH 工具

对齐 CLI，不要对齐「Responses 托管 image_generation」。

`ctx.tools.register(defineTool({ name: 'image_gen', ... }))`，`inject: ['tools', 'llm']`，执行时：

1. `resolveGrokAccessToken(runtime)`（现成，未登录 = `MISSING_CREDENTIAL`）
2. `POST https://api.x.ai/v1/images/generations`  
   body：`{ model, prompt, aspect_ratio, response_format: "b64_json" }`  
   header：`Authorization: Bearer <access>`；需要的话带上现有 CLI 版本头 / `X-Dsh-Plugin`
3. 解码 base64，写工作区文件（CLI 也会落盘并告诉模型路径）
4. `ctx.attachments.saveImage`，`output.render` 返回文本信封 + `{ type: 'image', attachment }`  
   先例：`dsh-tool-fs` 的 `read_image`、`dsh-llm-codex` 的 `view_image`

建议工具名就叫 `image_gen` / `image_edit`，和 Grok Build 一致，skill 文本也能复用。

不要：

- 往 `responses-tools.ts` 里塞 `{ type: "image_generation" }`（CLI 没用这条；pi-ai 也不会解码 `image_generation_call`）
- 默认要求用户再填 `XAI_API_KEY`
- 去刮 grok.com/imagine
- 把 Imagine 模型放进对话 picker（那是供应商面，不是工具面）

可选后续：`image_edit`、`image_to_video`、卡上开关（对标 Codex `enableImageTool`）、`run_in_background`。

## 3. 鉴权与风险

- **产品意图**：SuperGrok / X Premium+ 登录即可画，CLI 已证明。
- **计费**：走订阅/CLI 额度，不是 console 按张发票。插件卡上已有 billing；生图应计在同一池（具体字段以 spike 响应为准）。
- **ToS**：这是官方 CLI 的同一 OAuth client + 同一 Imagine path，比「假成 CLI 去打未文档化的 proxy 路由」干净。聊天仍只打已验证的 cli-chat-proxy。
- **不要**把 `~/.grok/auth.json` 读进来（插件已明确隔离）。
- **模型名**：开发者文档写 `grok-imagine-image-quality` / `grok-imagine-image`。CLI 可能有远程 settings 覆盖。v1 先钉官方 quality，失败再读 models-v2。

## 4. v1 建议形状

Name: `image_gen`

Parameters:

- `prompt` string required
- `aspect_ratio` optional enum（与 CLI skill 相同）
- `path` optional 工作区落盘路径

Output: `{ path, image: { attachmentId, mediaType, bytes, width, height } }`

`presentCall`: generic card，kind 用 create，location 指到将写入的文件。

测试：本地假 `api.x.ai`（对标 `tests/fake-proxy.ts`），不断真网。Lab（3082）再用真实会话 spike 一张。

## 5. Sources

CLI（本机 1.0.5）：

- `~/.grok/docs/user-guide/04-slash-commands.md` Media Generation
- `~/.grok/docs/user-guide/02-authentication.md` Auth precedence
- `~/.grok/docs/user-guide/05-configuration.md` `[tools.media_gen]`
- `~/.grok/bundled/skills/imagine/SKILL.md`
- 二进制字符串：`ImageGenClient`、`/images/generations`、`Imagine API error`、`Call the image_gen tool immediately…`
- `~/.grok/CHANGELOG.md` 1.0.5：「Image and video generation now limits how many calls the model can request in one step」

本插件：`src/oauth.ts` scopes、`src/pi-ai-profile.ts` chat base、`src/responses-tools.ts`、`src/cli-identity.ts`

DSH 回图：`deepseek-harness/packages/fs/tool-fs/src/read-image.ts`、`dsh-llm-codex/src/view-image.ts`

xAI 开发者文档（console 轨，CLI 的 HTTP 形状与此相同、鉴权不同）：  
https://docs.x.ai/developers/model-capabilities/images/generation  
https://docs.x.ai/developers/rest-api-reference/inference/images
