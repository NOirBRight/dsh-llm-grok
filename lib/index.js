import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { LlmAdapter, LlmError, RetryPolicySchema, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { deepEqualJson, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { createProvider } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
//#region lib/types/client-contract.js
/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */
/** Settings namespace owned by the Grok plugin. */
const GROK_SETTINGS_NAMESPACE = "llm-grok";
/** Provider route owned by the Grok plugin. Distinct from the built-in `xai` console-key route. */
const GROK_PROVIDER = "grok";
/** Default maximum idle interval while a stream read is outstanding. */
const GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** Private Connection RPC channel used by this package's Host and Web faces. */
const GROK_RPC_CHANNEL = "/grok";
/** Begin a Host-owned PKCE sign-in against auth.x.ai. */
const GROK_AUTH_START_ENDPOINT = "auth/start";
/** Secret-free login snapshot. */
const GROK_AUTH_STATUS_ENDPOINT = "auth/status";
/** Delete the Host session file. */
const GROK_AUTH_LOGOUT_ENDPOINT = "auth/logout";
/** Deliver a Grok Build paste-code into the in-flight PKCE exchange. */
const GROK_AUTH_COMPLETE_ENDPOINT = "auth/complete";
/** Secret-free subscription-usage snapshot inside {@link GROK_RPC_CHANNEL}. */
const GROK_USAGE_ENDPOINT = "usage/read";
/**
* Offline fallback when the account catalog cannot be read. Live ids come
* from GET /v1/models-v2 after sign-in.
*/
const GROK_CATALOG = Object.freeze([Object.freeze({
	id: "grok-4.6",
	name: "Grok 4.6",
	thinking: true,
	vision: true
}), Object.freeze({
	id: "grok-4.5",
	name: "Grok 4.5",
	thinking: true,
	vision: true
})]);
/** Account model list inside {@link GROK_RPC_CHANNEL}. */
const GROK_MODELS_ENDPOINT = "models/list";
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
const TOKEN_FIELD = /^(?:accessToken|refreshToken|access_token|refresh_token|id_token|idToken|token)$/iu;
function hasTokenFields(value) {
	return Object.keys(value).some((key) => TOKEN_FIELD.test(key));
}
function optionalNonEmptyString(value) {
	return value === void 0 || typeof value === "string" && value.length > 0;
}
/**
* Narrow the schema-resolved settings section before it enters React state.
* @param value - untrusted settings response value.
* @returns the validated settings view, or undefined when the response is invalid.
*/
function decodeGrokSettings(value) {
	if (!isRecord$5(value)) return void 0;
	const streamIdleTimeoutMs = value["streamIdleTimeoutMs"];
	if (typeof streamIdleTimeoutMs !== "number" || !Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) return;
	return { streamIdleTimeoutMs };
}
/**
* Narrow an empty auth RPC payload. Token-shaped fields are rejected so a
* confused caller cannot push secrets across the loopback channel.
* @param value - untrusted RPC request payload.
* @returns an empty object, or undefined when the payload is invalid.
*/
/**
* Narrow a paste-code completion request. The value is an authorization code,
* not an access token; token-shaped field names are still rejected.
* @param value - untrusted RPC request payload.
*/
function decodeGrokAuthCompleteRequest(value) {
	if (!isRecord$5(value) || hasTokenFields(value)) return void 0;
	const code = value["code"];
	if (typeof code !== "string" || code.trim().length === 0) return void 0;
	return { code: code.trim() };
}
function decodeGrokEmptyRequest(value) {
	if (value === void 0 || value === null) return {};
	if (!isRecord$5(value) || hasTokenFields(value)) return void 0;
	return {};
}
/**
* Narrow the Host start-login reply before the card updates.
* @param value - untrusted RPC result value.
* @returns the validated reply, or undefined when it is malformed or carries secrets.
*/
function decodeGrokAuthStartReply(value) {
	if (!isRecord$5(value) || hasTokenFields(value) || typeof value["ok"] !== "boolean") return void 0;
	if (value["ok"] === true) return { ok: true };
	if (value["retryable"] !== true || typeof value["message"] !== "string" || value["message"].length === 0) return;
	return {
		ok: false,
		retryable: true,
		message: value["message"]
	};
}
/**
* Narrow the secret-free login snapshot. Token-shaped fields fail closed.
* @param value - untrusted RPC result value.
* @returns the validated status, or undefined when it is malformed or carries secrets.
*/
function decodeGrokAuthStatus(value) {
	if (!isRecord$5(value) || hasTokenFields(value) || typeof value["loggedIn"] !== "boolean") return void 0;
	const email = value["email"];
	const expiresAt = value["expiresAt"];
	if (!optionalNonEmptyString(email) || !optionalNonEmptyString(expiresAt)) return void 0;
	return {
		loggedIn: value["loggedIn"],
		...email === void 0 ? {} : { email },
		...expiresAt === void 0 ? {} : { expiresAt }
	};
}
/**
* Narrow the logout reply.
* @param value - untrusted RPC result value.
* @returns the validated reply, or undefined when it is malformed or carries secrets.
*/
function decodeGrokAuthLogoutReply(value) {
	if (!isRecord$5(value) || hasTokenFields(value) || value["ok"] !== true) return void 0;
	return { ok: true };
}
function decodeGrokUsageWindow(value) {
	if (!isRecord$5(value) || hasTokenFields(value)) return void 0;
	const id = value["id"];
	const used = value["used"];
	const limit = value["limit"];
	const period = value["period"];
	const unit = value["unit"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return void 0;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) return void 0;
	if (!optionalNonEmptyString(period)) return void 0;
	if (unit !== void 0 && unit !== "percent") return void 0;
	return {
		id,
		used,
		limit,
		...period === void 0 ? {} : { period },
		...unit === void 0 ? {} : { unit }
	};
}
/**
* Narrow one usage snapshot.
* @param value - untrusted JSON value.
* @returns the validated snapshot, or undefined when it is malformed or carries secrets.
*/
function decodeGrokUsageView(value) {
	if (!isRecord$5(value) || hasTokenFields(value)) return void 0;
	if (typeof value["fetchedAt"] !== "string" || value["fetchedAt"].length === 0) return void 0;
	if (!Array.isArray(value["windows"]) || value["windows"].length === 0) return void 0;
	const windows = [];
	for (const entry of value["windows"]) {
		const decoded = decodeGrokUsageWindow(entry);
		if (decoded === void 0) return void 0;
		windows.push(decoded);
	}
	return {
		fetchedAt: value["fetchedAt"],
		windows
	};
}
/**
* Narrow the usage reply returned by the Host usage endpoint.
* @param value - untrusted RPC result value.
* @returns the validated reply, or undefined when it is malformed or carries secrets.
*/
function decodeGrokCatalogModel(value) {
	if (!isRecord$5(value) || hasTokenFields(value)) return void 0;
	const id = value["id"];
	const name = value["name"];
	const thinking = value["thinking"];
	const vision = value["vision"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (name !== void 0 && (typeof name !== "string" || name.length === 0)) return void 0;
	if (thinking !== void 0 && typeof thinking !== "boolean") return void 0;
	if (vision !== void 0 && typeof vision !== "boolean") return void 0;
	return {
		id,
		...name === void 0 ? {} : { name },
		...thinking === void 0 ? {} : { thinking },
		...vision === void 0 ? {} : { vision }
	};
}
function decodeGrokModelsReply(value) {
	if (!isRecord$5(value) || hasTokenFields(value) || !Array.isArray(value["models"])) return void 0;
	const models = [];
	for (const entry of value["models"]) {
		const model = decodeGrokCatalogModel(entry);
		if (model === void 0) return void 0;
		models.push(model);
	}
	return { models };
}
function decodeGrokUsageReply(value) {
	if (!isRecord$5(value) || hasTokenFields(value)) return void 0;
	if (value["status"] === "unsupported") return { status: "unsupported" };
	if (value["status"] === "logged-out") return { status: "logged-out" };
	if (value["status"] !== "ok") return void 0;
	const usage = decodeGrokUsageView(value["usage"]);
	return usage === void 0 ? void 0 : {
		status: "ok",
		usage
	};
}
//#endregion
//#region lib/types/session.js
/**
* Host-only Grok OAuth session file. Tokens never leave this module through
* the RPC contract; the browser only sees {@link statusFromSession}.
*/
/** File name under `$DSH_HOME`. Never `~/.grok/auth.json`. */
const GROK_SESSION_FILENAME = "grok-oauth.json";
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve `$DSH_HOME` from the launch-environment snapshot, then `~/.dsh`.
* @param ctx - Host plugin context that may carry a launcher snapshot.
* @returns the absolute session file path.
*/
function resolveGrokSessionPath(ctx) {
	const fromEnv = launchEnvironmentOf(ctx).get("DSH_HOME")?.value;
	const home = fromEnv !== void 0 && fromEnv.trim().length > 0 ? expandHome(fromEnv.trim()) : join(homedir(), ".dsh");
	return join(home, GROK_SESSION_FILENAME);
}
/**
* Build the session path under an already-resolved harness home.
* @param dshHome - absolute or home-relative harness home.
*/
function sessionPathForHome(dshHome) {
	return join(dshHome, GROK_SESSION_FILENAME);
}
/**
* Narrow a session document. Rejects missing token or expiry fields.
* @param value - parsed JSON.
*/
function decodeGrokSession(value) {
	if (!isRecord$4(value)) return void 0;
	const accessToken = value["accessToken"];
	const refreshToken = value["refreshToken"];
	const expiresAt = value["expiresAt"];
	const email = value["email"];
	const userId = value["userId"];
	if (typeof accessToken !== "string" || accessToken.length === 0) return void 0;
	if (typeof refreshToken !== "string" || refreshToken.length === 0) return void 0;
	if (typeof expiresAt !== "string" || expiresAt.length === 0 || Number.isNaN(Date.parse(expiresAt))) return;
	if (email !== void 0 && (typeof email !== "string" || email.length === 0)) return void 0;
	if (userId !== void 0 && (typeof userId !== "string" || userId.length === 0)) return void 0;
	return {
		accessToken,
		refreshToken,
		expiresAt,
		...email === void 0 ? {} : { email },
		...userId === void 0 ? {} : { userId }
	};
}
/**
* Read the session file. Missing or corrupt documents are treated as signed-out.
* @param path - absolute session path.
*/
async function readSession(path) {
	try {
		const raw = await readFile(path, "utf8");
		return decodeGrokSession(JSON.parse(raw));
	} catch {
		return;
	}
}
/**
* Atomically write the session file with mode `0600`.
* @param path - absolute session path.
* @param session - tokens and account identity.
*/
async function writeSession(path, session) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
	const body = `${JSON.stringify(session, null, 2)}\n`;
	try {
		await writeFile(tmp, body, {
			encoding: "utf8",
			mode: 384
		});
		await chmod(tmp, 384);
		await rename(tmp, path);
		await chmod(path, 384);
	} catch (error) {
		await unlink(tmp).catch(() => void 0);
		throw error;
	}
}
/**
* Delete the session file. Missing files are success.
* @param path - absolute session path.
*/
async function deleteSession(path) {
	try {
		await unlink(path);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
/**
* Project a Host session into the secret-free RPC status view.
* @param session - current session, if any.
*/
function statusFromSession(session) {
	if (session === void 0) return { loggedIn: false };
	return {
		loggedIn: true,
		...session.email === void 0 ? {} : { email: session.email },
		expiresAt: session.expiresAt
	};
}
//#endregion
//#region lib/types/oauth.js
/**
* Host-owned xAI PKCE (S256) against the Grok CLI public client.
* Tokens stay on the Host; this module never logs Authorization headers.
*/
/** Issuer used by the Grok CLI public client. */
const GROK_OAUTH_ISSUER = "https://auth.x.ai";
/** Public client_id from the Grok CLI auth.json key `https://auth.x.ai::<client_id>`. */
const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/**
* Scopes the official Grok CLI requests. `grok-cli:access` is what
* cli-chat-proxy billing and chat treat as a CLI token; `api:access` alone
* signs in but is rejected as "must be performed by Grok CLI token users".
*/
const GROK_OAUTH_SCOPE = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"grok-cli:access",
	"api:access",
	"conversations:read",
	"conversations:write",
	"workspaces:read",
	"workspaces:write"
].join(" ");
/** Pinned authorize path when OIDC discovery is unavailable. */
const GROK_OAUTH_AUTHORIZE_PATH = "/oauth2/authorize";
/** Pinned token path when OIDC discovery is unavailable. */
const GROK_OAUTH_TOKEN_PATH = "/oauth2/token";
/** How long the loopback listener waits for the browser callback. */
const GROK_OAUTH_TIMEOUT_MS = 3e5;
/** Refresh when the access token expires within this window. */
const GROK_OAUTH_REFRESH_SKEW_MS = 6e4;
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function retryable(message) {
	return {
		ok: false,
		retryable: true,
		message
	};
}
function randomUrlSafe(bytes) {
	return randomBytes(bytes).toString("base64url");
}
/** PKCE S256 pair plus a CSRF state. */
function createPkcePair() {
	const verifier = randomUrlSafe(32);
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url"),
		state: randomUrlSafe(16)
	};
}
function decodeJwtPayload(token) {
	const parts = token.split(".");
	const payload = parts[1];
	if (parts.length < 2 || payload === void 0) return void 0;
	try {
		const json = Buffer.from(payload, "base64url").toString("utf8");
		const value = JSON.parse(json);
		return isRecord$3(value) ? value : void 0;
	} catch {
		return;
	}
}
function joinUrl(issuer, path) {
	return `${issuer.replace(/\/+$/u, "")}${path}`;
}
/**
* Discover authorize/token endpoints, falling back to the Grok CLI paths.
* @param issuer - OIDC issuer origin.
* @param fetchImpl - HTTP client.
*/
async function discoverOidcEndpoints(issuer, fetchImpl = fetch) {
	const fallback = {
		authorizationEndpoint: joinUrl(issuer, GROK_OAUTH_AUTHORIZE_PATH),
		tokenEndpoint: joinUrl(issuer, GROK_OAUTH_TOKEN_PATH)
	};
	try {
		const response = await fetchImpl(joinUrl(issuer, "/.well-known/openid-configuration"), { headers: { accept: "application/json" } });
		if (!response.ok) return fallback;
		const body = await response.json();
		if (!isRecord$3(body)) return fallback;
		const authorizationEndpoint = body["authorization_endpoint"];
		const tokenEndpoint = body["token_endpoint"];
		const userinfoEndpoint = body["userinfo_endpoint"];
		if (typeof authorizationEndpoint !== "string" || authorizationEndpoint.length === 0) return fallback;
		if (typeof tokenEndpoint !== "string" || tokenEndpoint.length === 0) return fallback;
		return {
			authorizationEndpoint,
			tokenEndpoint,
			...typeof userinfoEndpoint === "string" && userinfoEndpoint.length > 0 ? { userinfoEndpoint } : {}
		};
	} catch {
		return fallback;
	}
}
function spawnDetached(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "ignore",
			detached: true
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
/** Open the authorize URL with xdg-open, then sensible-open. */
async function openSystemBrowser(url) {
	if (!/^https?:\/\//u.test(url)) throw new Error("refusing to open a non-http url");
	const commands = ["xdg-open", "sensible-open"];
	let last;
	for (const command of commands) try {
		await spawnDetached(command, [url]);
		return;
	} catch (error) {
		last = error;
	}
	throw last instanceof Error ? last : /* @__PURE__ */ new Error("could not open a system browser");
}
/**
* Fill production defaults for the Host OAuth runtime.
* @param overrides - required session path plus optional test fakes.
*/
function createGrokAuthRuntime(overrides) {
	return {
		issuer: GROK_OAUTH_ISSUER,
		clientId: GROK_OAUTH_CLIENT_ID,
		scope: GROK_OAUTH_SCOPE,
		openBrowser: openSystemBrowser,
		fetch,
		now: () => Date.now(),
		timeoutMs: GROK_OAUTH_TIMEOUT_MS,
		refreshSkewMs: GROK_OAUTH_REFRESH_SKEW_MS,
		...overrides
	};
}
function readString(record, key) {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function expiresAtFromTokens(body, now) {
	const expiresIn = body["expires_in"];
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) return new Date(now + expiresIn * 1e3).toISOString();
	for (const token of [body["id_token"], body["access_token"]]) {
		if (typeof token !== "string") continue;
		const exp = decodeJwtPayload(token)?.["exp"];
		if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) return (/* @__PURE__ */ new Date(exp * 1e3)).toISOString();
	}
	return new Date(now).toISOString();
}
async function accountFromTokens(body, accessToken, userinfoEndpoint, fetchImpl) {
	const idToken = readString(body, "id_token");
	const claims = idToken === void 0 ? void 0 : decodeJwtPayload(idToken);
	let email = claims !== void 0 ? readString(claims, "email") : void 0;
	let userId = claims !== void 0 ? readString(claims, "sub") : void 0;
	if ((email === void 0 || userId === void 0) && userinfoEndpoint !== void 0) try {
		const response = await fetchImpl(userinfoEndpoint, { headers: {
			authorization: `Bearer ${accessToken}`,
			accept: "application/json"
		} });
		if (response.ok) {
			const info = await response.json();
			if (isRecord$3(info)) {
				email ??= readString(info, "email");
				userId ??= readString(info, "sub");
			}
		}
	} catch {}
	return {
		...email === void 0 ? {} : { email },
		...userId === void 0 ? {} : { userId }
	};
}
async function parseTokenResponse(response, now, userinfoEndpoint, fetchImpl, previous) {
	if (!response.ok) return void 0;
	let body;
	try {
		body = await response.json();
	} catch {
		return;
	}
	if (!isRecord$3(body)) return void 0;
	const accessToken = readString(body, "access_token");
	const refreshToken = readString(body, "refresh_token") ?? previous?.refreshToken;
	if (accessToken === void 0 || refreshToken === void 0) return void 0;
	const account = await accountFromTokens(body, accessToken, userinfoEndpoint, fetchImpl);
	const email = account.email ?? previous?.email;
	const userId = account.userId ?? previous?.userId;
	return {
		accessToken,
		refreshToken,
		expiresAt: expiresAtFromTokens(body, now),
		...email === void 0 ? {} : { email },
		...userId === void 0 ? {} : { userId }
	};
}
/**
* Exchange a refresh token. Callers delete the session when this returns undefined.
* @param runtime - Host OAuth runtime.
* @param session - current session.
*/
async function refreshSession(runtime, session) {
	const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch);
	let response;
	try {
		response = await runtime.fetch(endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json"
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: session.refreshToken,
				client_id: runtime.clientId
			})
		});
	} catch {
		return;
	}
	return parseTokenResponse(response, runtime.now(), endpoints.userinfoEndpoint, runtime.fetch, session);
}
/**
* Return a session that is not near expiry, refreshing or clearing as needed.
* @param runtime - Host OAuth runtime.
*/
async function ensureFreshSession(runtime) {
	const path = runtime.resolveSessionPath();
	const session = await readSession(path);
	if (session === void 0) return void 0;
	if (Date.parse(session.expiresAt) - runtime.now() > runtime.refreshSkewMs) return session;
	const refreshed = await refreshSession(runtime, session);
	if (refreshed === void 0) {
		await deleteSession(path);
		return;
	}
	await writeSession(path, refreshed);
	return refreshed;
}
const CALLBACK_OK = "<!doctype html><title>Grok</title><p>Sign-in complete. You can close this window.</p>";
const CALLBACK_FAIL = "<!doctype html><title>Grok</title><p>Sign-in did not complete. You can close this window and try again.</p>";
function listenLoopback() {
	const server = createServer();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close();
				reject(/* @__PURE__ */ new Error("loopback listener has no port"));
				return;
			}
			resolve({
				server,
				port: address.port
			});
		});
	});
}
function closeServer(server) {
	return new Promise((resolve) => {
		server.close(() => resolve());
	});
}
function waitForCallback(server, expectedState, timeoutMs, signal) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			server.removeListener("request", onRequest);
			if (result instanceof Error) reject(result);
			else resolve(result);
		};
		const onAbort = () => {
			finish(Object.assign(/* @__PURE__ */ new Error("Sign-in was cancelled."), { code: "ABORT_ERR" }));
		};
		const timer = setTimeout(() => {
			finish(Object.assign(/* @__PURE__ */ new Error("Sign-in timed out."), { code: "TIMEOUT" }));
		}, timeoutMs);
		const onRequest = (request, response) => {
			try {
				const url = new URL(request.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== "/callback") {
					response.writeHead(404, { "content-type": "text/plain" }).end("not found");
					return;
				}
				const state = url.searchParams.get("state");
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");
				if (state !== expectedState) {
					response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(CALLBACK_FAIL);
					finish({ kind: "mismatch" });
					return;
				}
				if (error !== null || code === null || code.length === 0) {
					response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(CALLBACK_FAIL);
					finish({ kind: "denied" });
					return;
				}
				response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(CALLBACK_OK);
				finish({
					kind: "code",
					code
				});
			} catch (error) {
				response.writeHead(400).end();
				finish(error instanceof Error ? error : /* @__PURE__ */ new Error("invalid callback"));
			}
		};
		if (signal?.aborted === true) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		server.on("request", onRequest);
	});
}
const loginInFlight = /* @__PURE__ */ new WeakSet();
const pendingPaste = /* @__PURE__ */ new WeakMap();
function createPendingPaste() {
	let deliver = () => void 0;
	const wait = new Promise((resolve) => {
		deliver = resolve;
	});
	return {
		deliver,
		wait
	};
}
/**
* Run one loopback PKCE sign-in. Cancel, timeout, and state mismatch leave
* the session file untouched.
* @param runtime - Host OAuth runtime.
* @param signal - RPC abort signal.
*/
async function startPkceLogin(runtime, signal) {
	if (loginInFlight.has(runtime)) return retryable("Sign-in is already in progress.");
	loginInFlight.add(runtime);
	let server;
	const local = new AbortController();
	const onParentAbort = () => {
		local.abort();
	};
	signal?.addEventListener("abort", onParentAbort);
	try {
		if (signal?.aborted === true || local.signal.aborted) return retryable("Sign-in was cancelled.");
		const endpoints = await discoverOidcEndpoints(runtime.issuer, runtime.fetch);
		const listener = await listenLoopback();
		server = listener.server;
		const pkce = createPkcePair();
		const redirectUri = `http://127.0.0.1:${String(listener.port)}/callback`;
		const authorize = new URL(endpoints.authorizationEndpoint);
		authorize.searchParams.set("response_type", "code");
		authorize.searchParams.set("client_id", runtime.clientId);
		authorize.searchParams.set("redirect_uri", redirectUri);
		authorize.searchParams.set("scope", runtime.scope);
		authorize.searchParams.set("state", pkce.state);
		authorize.searchParams.set("code_challenge", pkce.challenge);
		authorize.searchParams.set("code_challenge_method", "S256");
		const paste = createPendingPaste();
		pendingPaste.set(runtime, paste);
		const callback = waitForCallback(server, pkce.state, runtime.timeoutMs, local.signal);
		try {
			await runtime.openBrowser(authorize.toString());
		} catch {
			local.abort();
			await callback.catch(() => void 0);
			return retryable("Sign-in could not be completed.");
		}
		const pasted = paste.wait.then((code) => ({
			kind: "code",
			code
		}));
		const result = await Promise.race([callback, pasted]);
		if (result.kind === "mismatch") return retryable("Sign-in rejected a mismatched state.");
		if (result.kind === "denied") return retryable("Sign-in did not complete.");
		const session = await parseTokenResponse(await runtime.fetch(endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json"
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: result.code,
				redirect_uri: redirectUri,
				client_id: runtime.clientId,
				code_verifier: pkce.verifier
			})
		}), runtime.now(), endpoints.userinfoEndpoint, runtime.fetch);
		if (session === void 0) return retryable("Sign-in could not be completed.");
		await writeSession(runtime.resolveSessionPath(), session);
		return { ok: true };
	} catch (error) {
		const code = error.code;
		if (code === "ABORT_ERR" || signal?.aborted === true || local.signal.aborted) return retryable("Sign-in was cancelled.");
		if (code === "TIMEOUT") return retryable("Sign-in timed out.");
		return retryable("Sign-in could not be completed.");
	} finally {
		signal?.removeEventListener("abort", onParentAbort);
		if (server !== void 0) await closeServer(server);
		pendingPaste.delete(runtime);
		loginInFlight.delete(runtime);
	}
}
/**
* Deliver a code copied from the Grok Build "paste this code" page into the
* in-flight PKCE exchange. The Host still owns the verifier; the browser only
* sends the short-lived authorization code over loopback RPC.
* @param runtime - the same runtime `startPkceLogin` is waiting on.
* @param code - trimmed authorization code from the IdP page.
*/
async function completePkceLogin(runtime, code) {
	const trimmed = code.trim();
	if (trimmed.length === 0) return retryable("Paste the sign-in code from the browser page.");
	const pending = pendingPaste.get(runtime);
	if (pending === void 0) return retryable("Sign-in is not waiting for a code.");
	pending.deliver(trimmed);
	return { ok: true };
}
/** Headers attached to every cli-chat-proxy request this plugin makes. */
const GROK_CLI_REQUEST_HEADERS = Object.freeze({
	"x-grok-client-version": "1.0.4",
	"x-grok-client-identifier": "grok-shell"
});
//#endregion
//#region lib/types/responses-tools.js
/**
* Inject xAI server-side search tools into an outbound Responses body.
* Pi-ai only emits `{ type: "function" }` tools; the proxy runs web_search
* and x_search itself. This is not a `ctx.web` provider.
*/
/** Server-side search tools the Grok CLI chat proxy accepts on every request. */
const GROK_SERVER_SEARCH_TOOLS = [{ type: "web_search" }, { type: "x_search" }];
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toolType(tool) {
	if (!isRecord$2(tool)) return void 0;
	return typeof tool["type"] === "string" ? tool["type"] : void 0;
}
/**
* Append `{ type: "web_search" }` and `{ type: "x_search" }` when missing.
* Leaves non-object payloads unchanged.
* @param payload - the Responses `create` body pi-ai is about to send.
*/
function injectGrokServerSearchTools(payload) {
	if (!isRecord$2(payload)) return payload;
	const existing = payload["tools"];
	const tools = Array.isArray(existing) ? [...existing] : [];
	for (const extra of GROK_SERVER_SEARCH_TOOLS) if (!tools.some((tool) => toolType(tool) === extra.type)) tools.push({ type: extra.type });
	return {
		...payload,
		tools
	};
}
function withServerSearchTools(streamFn) {
	return (model, context, options) => {
		const original = options?.onPayload;
		return streamFn(model, context, {
			...options,
			onPayload: async (payload, nextModel) => {
				const next = original === void 0 ? payload : await original(payload, nextModel);
				return injectGrokServerSearchTools(next === void 0 ? payload : next);
			}
		});
	};
}
/**
* OpenAI Responses streams with Grok server-side search tools patched in.
* Wrapping `onPayload` is required because pi-ai's client has no custom fetch.
*/
function grokResponsesApi() {
	const base = openAIResponsesApi();
	return {
		stream: withServerSearchTools(base.stream),
		streamSimple: withServerSearchTools(base.streamSimple)
	};
}
//#endregion
//#region lib/types/pi-ai-profile.js
/**
* Translate the frozen Grok catalog into the pi-ai profile used for OpenAI
* Responses against the Grok CLI chat proxy.
*/
/** Chat proxy base used by the Grok CLI (`POST {base}/responses`). */
const GROK_CHAT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** Context capacity used when the frozen catalog entry has none. */
const GROK_DEFAULT_CONTEXT_WINDOW = 262144;
/** Safe output capability used when the frozen catalog entry has none. */
const GROK_DEFAULT_MODEL_MAX_TOKENS = 32768;
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
const { name: PACKAGE_NAME, version: PACKAGE_VERSION } = createRequire(import.meta.url)("../package.json");
/** Plugin identity sent beside the required CLI version headers. */
const GROK_PLUGIN_IDENTITY_HEADER = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
function proxyHeaders() {
	return {
		...GROK_CLI_REQUEST_HEADERS,
		"X-Dsh-Plugin": GROK_PLUGIN_IDENTITY_HEADER
	};
}
const THINKING_LEVELS = {
	off: "none",
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: null,
	max: null
};
function thinkingLevelMap(model) {
	if (model.thinking !== true) return void 0;
	return THINKING_LEVELS;
}
function toPiAiModel(model, baseUrl) {
	const levels = thinkingLevelMap(model);
	return {
		id: model.id,
		name: model.name ?? model.id,
		api: "openai-responses",
		provider: GROK_PROVIDER,
		baseUrl,
		reasoning: model.thinking === true,
		...levels === void 0 ? {} : { thinkingLevelMap: levels },
		input: model.vision === true ? ["text", "image"] : ["text"],
		cost: NO_COST,
		contextWindow: GROK_DEFAULT_CONTEXT_WINDOW,
		maxTokens: GROK_DEFAULT_MODEL_MAX_TOKENS,
		compat: {
			supportsDeveloperRole: false,
			supportsLongCacheRetention: false,
			supportsStrictMode: false,
			supportsOpenAIGrammarTools: false,
			supportsToolSearch: false,
			supportsExplicitPromptCacheMode: false
		}
	};
}
/** Harness-authenticated provider auth; the access token is supplied per request. */
function grokAuth() {
	return { apiKey: {
		name: "Grok subscription",
		resolve: ({ credential }) => Promise.resolve({
			auth: credential?.key === void 0 ? {} : { apiKey: credential.key },
			source: "Grok"
		})
	} };
}
/** Resolve the complete pi-ai profile for one Grok options snapshot. */
function createGrokPiAiProfile(connection) {
	const baseURL = connection.baseURL.replace(/\/+$/u, "");
	const models = (connection.models.length > 0 ? connection.models : GROK_CATALOG).map((model) => toPiAiModel(model, baseURL));
	const configuredMaxTokens = /* @__PURE__ */ new Map();
	const headers = proxyHeaders();
	const piProvider = createProvider({
		id: GROK_PROVIDER,
		name: "Grok",
		baseUrl: baseURL,
		auth: grokAuth(),
		models,
		api: grokResponsesApi(),
		headers
	});
	return {
		provider: GROK_PROVIDER,
		displayName: "Grok",
		baseURL,
		defaultContextWindow: GROK_DEFAULT_CONTEXT_WINDOW,
		defaultMaxTokens: GROK_DEFAULT_MODEL_MAX_TOKENS,
		defaultInput: ["text"],
		streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
		retryPolicy: connection.retryPolicy,
		piProvider,
		configuredMaxTokens,
		headers
	};
}
//#endregion
//#region lib/types/adapter.js
/**
* Grok subscription chat adapter. The public route stays `grok`, while the
* wire implementation is delegated to pi-ai's OpenAI Responses support.
*/
/**
* Return the current access token, refreshing when the session is near expiry.
* A missing session is MISSING_CREDENTIAL. A session that existed but whose
* refresh failed (and was cleared) is AUTH.
* @param runtime - Host OAuth runtime.
*/
async function resolveGrokAccessToken(runtime) {
	const existing = await readSession(runtime.resolveSessionPath());
	const session = await ensureFreshSession(runtime);
	if (session === void 0) {
		if (existing !== void 0) throw new LlmError("llm-grok: session refresh failed; sign in again with an xAI subscription", "AUTH");
		throw new LlmError("llm-grok: not signed in; sign in with an xAI subscription from Plugin configuration", "MISSING_CREDENTIAL");
	}
	return session.accessToken;
}
/** The Grok chat adapter backed by pi-ai OpenAI Responses. */
var GrokAdapter = class extends LlmAdapter {
	config;
	snapshot;
	constructor(config) {
		super();
		this.config = config;
	}
	/** Rebuild the delegated adapter only when the plugin publishes a new options snapshot. */
	current() {
		const options = this.config.options();
		if (this.snapshot?.options === options) return this.snapshot.adapter;
		const profile = createGrokPiAiProfile(options);
		const profiles = /* @__PURE__ */ new Map([[GROK_PROVIDER, profile]]);
		const adapter = new PiAiAdapter({
			profiles: () => profiles,
			resolveApiKey: () => this.config.resolveApiKey(),
			...this.config.resolveAttachments === void 0 ? {} : { resolveAttachments: this.config.resolveAttachments }
		});
		this.snapshot = {
			options,
			adapter
		};
		return adapter;
	}
	providerInfo(provider) {
		return this.current().providerInfo(provider);
	}
	providerRetryPolicy(provider) {
		return this.current().providerRetryPolicy(provider);
	}
	async listModels(provider) {
		await this.config.refreshCatalog?.();
		this.snapshot = void 0;
		return this.current().listModels(provider);
	}
	resolveModel(provider, model, signal) {
		return this.current().resolveModel(provider, model, signal);
	}
	stream(options) {
		return this.current().stream(options);
	}
};
//#endregion
//#region lib/types/discovery.js
/**
* Account model catalog from cli-chat-proxy GET /v1/models-v2.
*/
/** Production models URL. */
const GROK_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models-v2";
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asModel(value) {
	if (!isRecord$1(value)) return void 0;
	const id = value["id"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	const name = value["name"];
	const thinking = value["supports_reasoning_effort"] === true || value["thinking"] === true;
	return {
		id,
		...typeof name === "string" && name.length > 0 ? { name } : {},
		thinking,
		vision: true
	};
}
/**
* Parse a models-v2 (or /v1/models) list body.
* @param value - JSON body.
*/
function parseGrokModels(value) {
	if (!isRecord$1(value) || !Array.isArray(value["data"])) return void 0;
	const models = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of value["data"]) {
		const model = asModel(entry);
		if (model === void 0 || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models.length > 0 ? models : void 0;
}
/**
* Read the signed-in account catalog. Failures return undefined so callers
* can keep the last good / frozen list.
*/
async function readGrokModels(request) {
	const url = request.modelsURL ?? "https://cli-chat-proxy.grok.com/v1/models-v2";
	const fetchImpl = request.fetch ?? fetch;
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${request.accessToken}`,
				...GROK_CLI_REQUEST_HEADERS
			},
			redirect: "error",
			...request.signal === void 0 ? {} : { signal: request.signal }
		});
		if (!response.ok) {
			await response.body?.cancel();
			return;
		}
		return parseGrokModels(await response.json());
	} catch {
		return;
	}
}
/** Frozen fallback used when discovery has not succeeded. */
function fallbackGrokCatalog() {
	return GROK_CATALOG.map((model) => ({ ...model }));
}
//#endregion
//#region lib/types/usage.js
/**
* Reading the account's Grok subscription quota for the configuration card.
*
* The Host calls `GET …/v1/billing?format=credits` with the stored access
* token. The browser only receives the decoded window view.
*
* A missing or unrecognized billing surface is `unsupported`, not a failure:
* usage is advisory information, never a blocker.
*
* @module dsh-llm-grok/usage
*/
/** SuperGrok quota lives on the credits flavor, not the prepaid 0/0 envelope. */
const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
/** Per-read budget for one billing request. */
const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 15e3;
/** Replies larger than this are refused; a healthy billing reply is a few KiB. */
const MAX_USAGE_BYTES = 1048576;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function redactSecrets(message, secrets) {
	let next = message;
	for (const secret of secrets) {
		if (secret.length === 0) continue;
		next = next.split(secret).join("[redacted]");
	}
	return next;
}
function parseWindow(value) {
	if (!isRecord(value)) return void 0;
	const id = value["id"];
	const used = value["used"];
	const limit = value["limit"];
	const period = value["period"];
	if (typeof id !== "string" || id.length === 0) return void 0;
	if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return void 0;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) return void 0;
	if (period !== void 0 && (typeof period !== "string" || period.length === 0)) return void 0;
	return {
		id,
		used,
		limit,
		...period === void 0 ? {} : { period }
	};
}
/** cli-chat-proxy wraps money-like amounts as `{ val: number }`. */
function moneyVal(value) {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (!isRecord(value)) return void 0;
	const val = value["val"];
	if (typeof val !== "number" || !Number.isFinite(val) || val < 0) return void 0;
	return val;
}
function periodFromConfig(config) {
	const current = isRecord(config["currentPeriod"]) ? config["currentPeriod"] : void 0;
	const start = current?.["start"] ?? config["billingPeriodStart"];
	const end = current?.["end"] ?? config["billingPeriodEnd"];
	if (typeof start !== "string" || start.length === 0) return void 0;
	if (typeof end !== "string" || end.length === 0) return start.slice(0, 10);
	return `${start.slice(0, 10)} – ${end.slice(0, 10)}`;
}
function percentWindow(id, percent, period) {
	return {
		id,
		used: Math.round(Math.min(1, Math.max(0, percent)) * 100),
		limit: 100,
		unit: "percent",
		...period === void 0 ? {} : { period }
	};
}
/** Credits flavor: weekly window + per-product usagePercent (0–1). */
function parseCreditsConfig(config, fetchedAt) {
	const period = periodFromConfig(config);
	const windows = [];
	const products = config["productUsage"];
	if (Array.isArray(products)) for (const entry of products) {
		if (!isRecord(entry)) continue;
		const product = entry["product"];
		const percent = entry["usagePercent"];
		if (typeof product !== "string" || product.length === 0) continue;
		if (typeof percent !== "number" || !Number.isFinite(percent)) continue;
		windows.push(percentWindow(product, percent, period));
	}
	if (windows.length === 0) {
		const percent = config["creditUsagePercent"];
		if (typeof percent === "number" && Number.isFinite(percent)) windows.push(percentWindow("weekly", percent, period));
	}
	return windows.length === 0 ? void 0 : {
		fetchedAt,
		windows
	};
}
/** Prepaid envelope: `{ config: { monthlyLimit, used } }` — SuperGrok is usually 0/0 here. */
function parsePrepaidConfig(config, fetchedAt) {
	const used = moneyVal(config["used"]);
	const limit = moneyVal(config["monthlyLimit"]);
	if (used === void 0 || limit === void 0) return void 0;
	if (used === 0 && limit === 0) return void 0;
	const period = periodFromConfig(config);
	return {
		fetchedAt,
		windows: [{
			id: "monthly",
			used,
			limit,
			...period === void 0 ? {} : { period }
		}]
	};
}
function parseCliBillingConfig(value, fetchedAt) {
	if (!isRecord(value)) return void 0;
	const config = value["config"];
	if (!isRecord(config)) return void 0;
	return parseCreditsConfig(config, fetchedAt) ?? parsePrepaidConfig(config, fetchedAt);
}
/**
* Convert the proxy billing JSON into the secret-free snapshot the card renders.
* Unknown bodies and windows that cannot be read return undefined (unsupported).
* @param value - opaque JSON returned by the billing endpoint.
* @param fetchedAt - ISO-8601 instant the Host read the body.
*/
function parseGrokBilling(value, fetchedAt) {
	const fromConfig = parseCliBillingConfig(value, fetchedAt);
	if (fromConfig !== void 0) return fromConfig;
	const windowsValue = isRecord(value) ? value.windows : void 0;
	if (!Array.isArray(windowsValue)) return void 0;
	const windows = [];
	for (const entry of windowsValue) {
		const window = parseWindow(entry);
		if (window !== void 0) windows.push(window);
	}
	if (windows.length === 0) return void 0;
	return {
		fetchedAt,
		windows
	};
}
/**
* Read the account's current billing windows with a Host-held access token.
* 404 and unrecognized JSON are `unsupported`. Transport failures throw a
* message that never includes the token.
* @param request - access token and optional test overrides.
*/
async function readGrokUsage(request) {
	const url = request.billingURL ?? "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
	const fetchImpl = request.fetch ?? fetch;
	const fetchedAt = new Date((request.now ?? Date.now)()).toISOString();
	const timeout = AbortSignal.timeout(DEFAULT_USAGE_REQUEST_TIMEOUT_MS);
	const signal = request.signal === void 0 ? timeout : AbortSignal.any([request.signal, timeout]);
	const secrets = [request.accessToken];
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${request.accessToken}`,
				...GROK_CLI_REQUEST_HEADERS
			},
			redirect: "error",
			signal
		});
	} catch (error) {
		if (request.signal?.aborted === true) throw new Error(redactSecrets("Grok usage read aborted by caller", secrets));
		const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "";
		throw new Error(redactSecrets(`could not reach ${url}${detail}`, secrets));
	}
	if (response.status === 404) {
		await response.body?.cancel();
		return { status: "unsupported" };
	}
	if (response.status === 403) {
		await response.body?.cancel();
		throw new Error("This session cannot read Grok CLI billing. Sign out and sign in again.");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(redactSecrets(`${url} answered ${String(response.status)}`, secrets));
	}
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_USAGE_BYTES) {
		await response.body?.cancel();
		throw new Error(redactSecrets(`${url} answered with more than ${String(MAX_USAGE_BYTES)} bytes`, secrets));
	}
	let text;
	try {
		text = await response.text();
	} catch (error) {
		const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "";
		throw new Error(redactSecrets(`${url} could not be read${detail}`, secrets));
	}
	if (text.length > MAX_USAGE_BYTES) throw new Error(redactSecrets(`${url} answered with more than ${String(MAX_USAGE_BYTES)} bytes`, secrets));
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		return { status: "unsupported" };
	}
	const usage = parseGrokBilling(body, fetchedAt);
	return usage === void 0 ? { status: "unsupported" } : {
		status: "ok",
		usage
	};
}
//#endregion
//#region lib/types/index.js
/**
* Register the `grok` provider directory entry, the Responses chat adapter,
* the `llm-grok` settings section, and the loopback `/grok` auth and usage RPC.
* The route is distinct from the built-in `xai` console-key provider.
* @module dsh-llm-grok
*/
const name = "llm-grok";
const inject = ["llm"];
const NS = settingsNamespace(GROK_SETTINGS_NAMESPACE);
/**
* The one explicit resolve step from raw config to validated connection facts.
* Catalog membership and the chat base URL are source constants.
* @param config - raw plugin config or resolved settings snapshot.
*/
function resolveAdapterOptions(config) {
	const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? 3e5;
	if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`llm-grok: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	return {
		baseURL: GROK_CHAT_BASE_URL,
		models: GROK_CATALOG,
		streamIdleTimeoutMs,
		retryPolicy: resolveRetryPolicy(config.retryPolicy, "llm-grok: retryPolicy")
	};
}
const Config = z.object({
	streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS),
	retryPolicy: RetryPolicySchema
});
function internalError(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
function usageFailure(error, secrets) {
	let message = error instanceof Error && error.message.length > 0 ? error.message : "Grok usage read failed";
	for (const secret of secrets) {
		if (secret.length === 0) continue;
		message = message.split(secret).join("[redacted]");
	}
	return internalError(message);
}
/**
* Loopback `/grok` handler. Status, start, and usage replies never include tokens.
* @param runtime - Host OAuth runtime (production or a test fake).
* @param options - optional billing URL override for tests.
*/
function createGrokRpcHandler(runtime, options) {
	return async (endpoint, payload, signal) => {
		if (endpoint === "auth/start") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok auth start request");
			return {
				ok: true,
				value: await startPkceLogin(runtime, signal)
			};
		}
		if (endpoint === "auth/status") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok auth status request");
			return {
				ok: true,
				value: statusFromSession(await ensureFreshSession(runtime))
			};
		}
		if (endpoint === "auth/logout") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok auth logout request");
			await deleteSession(runtime.resolveSessionPath());
			return {
				ok: true,
				value: { ok: true }
			};
		}
		if (endpoint === "auth/complete") {
			const request = decodeGrokAuthCompleteRequest(payload);
			if (request === void 0) return internalError("invalid Grok auth complete request");
			return {
				ok: true,
				value: await completePkceLogin(runtime, request.code)
			};
		}
		if (endpoint === "models/list") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok models request");
			const session = await ensureFreshSession(runtime);
			if (session === void 0) return {
				ok: true,
				value: { models: fallbackGrokCatalog() }
			};
			const models = await readGrokModels({
				accessToken: session.accessToken,
				...options?.modelsURL === void 0 ? {} : { modelsURL: options.modelsURL },
				fetch: runtime.fetch,
				signal
			}) ?? fallbackGrokCatalog();
			options?.adoptCatalog?.(models);
			return {
				ok: true,
				value: { models }
			};
		}
		if (endpoint === "usage/read") {
			if (decodeGrokEmptyRequest(payload) === void 0) return internalError("invalid Grok usage request");
			const session = await ensureFreshSession(runtime);
			if (session === void 0) return {
				ok: true,
				value: { status: "logged-out" }
			};
			try {
				return {
					ok: true,
					value: await readGrokUsage({
						accessToken: session.accessToken,
						...options?.billingURL === void 0 ? {} : { billingURL: options.billingURL },
						fetch: runtime.fetch,
						now: runtime.now,
						signal
					})
				};
			} catch (error) {
				return usageFailure(error, [session.accessToken, session.refreshToken]);
			}
		}
		return internalError(`unknown Grok endpoint: ${endpoint}`);
	};
}
function apply(ctx, config) {
	let current = () => config;
	let lastRaw;
	let lastGood;
	let catalog = fallbackGrokCatalog();
	const options = () => {
		const raw = current();
		if (raw === lastRaw && lastGood !== void 0 && lastGood.models === catalog) return lastGood;
		try {
			const next = {
				...resolveAdapterOptions(raw),
				models: catalog
			};
			lastRaw = raw;
			lastGood = next;
			return next;
		} catch (error) {
			if (lastGood === void 0) throw error;
			lastRaw = raw;
			ctx.logger.error("llm-grok: keeping the last good configuration after an invalid settings section");
			ctx.logger.error(error);
			return lastGood;
		}
	};
	options();
	const runtime = createGrokAuthRuntime({ resolveSessionPath: () => resolveGrokSessionPath(ctx) });
	const adoptCatalog = (models) => {
		catalog = models;
	};
	const refreshCatalog = async () => {
		const session = await ensureFreshSession(runtime);
		if (session === void 0) return;
		const models = await readGrokModels({
			accessToken: session.accessToken,
			fetch: runtime.fetch
		});
		if (models !== void 0) catalog = models;
	};
	const adapter = new GrokAdapter({
		options,
		resolveApiKey: () => resolveGrokAccessToken(runtime),
		resolveAttachments: () => ctx.get("attachments"),
		refreshCatalog
	});
	ctx.llm.registerConfigurableProviders([{
		provider: GROK_PROVIDER,
		displayName: "Grok",
		settingsNs: NS,
		settingsPath: []
	}]);
	const registration = ctx.llm.registerAdapter([GROK_PROVIDER], adapter);
	let registeredPolicy = options().retryPolicy;
	const ensureRegistrationFacts = () => {
		const policy = options().retryPolicy;
		if (deepEqualJson(policy, registeredPolicy)) return;
		registration.replace([GROK_PROVIDER]);
		registeredPolicy = policy;
	};
	ctx.inject(["connection"], (connectionCtx) => {
		connectionCtx.connection.rpc.handle(GROK_RPC_CHANNEL, createGrokRpcHandler(runtime, { adoptCatalog }), { authority: "loopback" });
	});
	installSettingsSection(ctx, NS, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: ensureRegistrationFacts
	});
}
//#endregion
export { Config, DEFAULT_USAGE_REQUEST_TIMEOUT_MS, GROK_AUTH_COMPLETE_ENDPOINT, GROK_AUTH_LOGOUT_ENDPOINT, GROK_AUTH_START_ENDPOINT, GROK_AUTH_STATUS_ENDPOINT, GROK_BILLING_URL, GROK_CATALOG, GROK_CHAT_BASE_URL, GROK_DEFAULT_CONTEXT_WINDOW, GROK_DEFAULT_MODEL_MAX_TOKENS, GROK_DEFAULT_STREAM_IDLE_TIMEOUT_MS, GROK_MODELS_ENDPOINT, GROK_MODELS_URL, GROK_OAUTH_CLIENT_ID, GROK_OAUTH_ISSUER, GROK_OAUTH_SCOPE, GROK_PLUGIN_IDENTITY_HEADER, GROK_PROVIDER, GROK_RPC_CHANNEL, GROK_SERVER_SEARCH_TOOLS, GROK_SESSION_FILENAME, GROK_SETTINGS_NAMESPACE, GROK_USAGE_ENDPOINT, GrokAdapter, apply, completePkceLogin, createGrokAuthRuntime, createGrokPiAiProfile, createGrokRpcHandler, decodeGrokAuthCompleteRequest, decodeGrokAuthLogoutReply, decodeGrokAuthStartReply, decodeGrokAuthStatus, decodeGrokEmptyRequest, decodeGrokModelsReply, decodeGrokSettings, decodeGrokUsageReply, decodeGrokUsageView, deleteSession, ensureFreshSession, fallbackGrokCatalog, grokResponsesApi, inject, injectGrokServerSearchTools, name, parseGrokBilling, parseGrokModels, readGrokModels, readGrokUsage, readSession, refreshSession, resolveAdapterOptions, resolveGrokAccessToken, resolveGrokSessionPath, sessionPathForHome, startPkceLogin, statusFromSession, writeSession };
