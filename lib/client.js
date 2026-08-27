window.__ModuleLoader__.load({
	id: "dsh-llm-grok",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		//#region src/client-contract.ts
		/** Browser-safe constants and JSON decoders shared by the Host and client plugin faces. */
		/** Settings namespace owned by the Grok plugin. */
		const GROK_SETTINGS_NAMESPACE = "llm-grok";
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
		const GROK_4_6_EFFORTS = Object.freeze([
			Object.freeze({
				id: "xhigh",
				value: "xhigh",
				label: "Extra High Effort",
				description: "Highest effort and reasoning level"
			}),
			Object.freeze({
				id: "high",
				value: "high",
				label: "High Effort",
				description: "Higher implementation quality with extensive reasoning"
			}),
			Object.freeze({
				id: "medium",
				value: "medium",
				label: "Medium Effort",
				description: "Balanced effort with standard implementation and testing"
			}),
			Object.freeze({
				id: "low",
				value: "low",
				label: "Low Effort",
				description: "Quick, fast implementations"
			})
		]);
		const GROK_CATALOG = Object.freeze([Object.freeze({
			id: "grok-4.6",
			name: "Grok 4.6",
			thinking: true,
			vision: true,
			contextWindow: 5e5,
			defaultReasoningEffort: "high",
			reasoningEfforts: GROK_4_6_EFFORTS
		}), Object.freeze({
			id: "grok-4.5",
			name: "Grok 4.5",
			thinking: true,
			vision: true,
			contextWindow: 5e5,
			defaultReasoningEffort: "high",
			reasoningEfforts: Object.freeze(GROK_4_6_EFFORTS.filter((effort) => effort.value !== "xhigh"))
		})]);
		/** Account model list inside {@link GROK_RPC_CHANNEL}. */
		const GROK_MODELS_ENDPOINT = "models/list";
		/** Atomic settings-save endpoint. */
		const GROK_SAVE_ENDPOINT = "settings/save";
		function isRecord(value) {
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
			if (!isRecord(value)) return void 0;
			const streamIdleTimeoutMs = value["streamIdleTimeoutMs"];
			if (typeof streamIdleTimeoutMs !== "number" || !Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) return;
			const modelsValue = value["models"];
			const enableImageGen = value["enableImageGen"] === true;
			if (modelsValue === void 0) return {
				streamIdleTimeoutMs,
				models: GROK_CATALOG.map((model) => ({ ...model })),
				enableImageGen
			};
			if (!Array.isArray(modelsValue)) return void 0;
			const models = [];
			for (const entry of modelsValue) {
				const model = decodeGrokCatalogModel(entry);
				if (model === void 0) return void 0;
				models.push(model);
			}
			return {
				streamIdleTimeoutMs,
				models,
				enableImageGen
			};
		}
		/**
		* Narrow the Host start-login reply before the card updates.
		* @param value - untrusted RPC result value.
		* @returns the validated reply, or undefined when it is malformed or carries secrets.
		*/
		function decodeGrokAuthStartReply(value) {
			if (!isRecord(value) || hasTokenFields(value) || typeof value["ok"] !== "boolean") return void 0;
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
			if (!isRecord(value) || hasTokenFields(value) || typeof value["loggedIn"] !== "boolean") return void 0;
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
			if (!isRecord(value) || hasTokenFields(value) || value["ok"] !== true) return void 0;
			return { ok: true };
		}
		function decodeGrokUsageWindow(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
			const id = value["id"];
			const used = value["used"];
			const limit = value["limit"];
			const period = value["period"];
			const unit = value["unit"];
			const resetsAt = value["resetsAt"];
			if (typeof id !== "string" || id.length === 0) return void 0;
			if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return void 0;
			if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) return void 0;
			if (!optionalNonEmptyString(period)) return void 0;
			if (unit !== void 0 && unit !== "percent") return void 0;
			if (!optionalNonEmptyString(resetsAt)) return void 0;
			return {
				id,
				used,
				limit,
				...period === void 0 ? {} : { period },
				...unit === void 0 ? {} : { unit },
				...resetsAt === void 0 ? {} : { resetsAt }
			};
		}
		/**
		* Narrow one usage snapshot.
		* @param value - untrusted JSON value.
		* @returns the validated snapshot, or undefined when it is malformed or carries secrets.
		*/
		function decodeGrokUsageView(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
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
		function decodeGrokReasoningEffort(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
			const id = value["id"];
			const wire = value["value"];
			const label = value["label"];
			const description = value["description"];
			if (typeof id !== "string" || id.length === 0) return void 0;
			if (typeof wire !== "string" || wire.length === 0) return void 0;
			if (label !== void 0 && (typeof label !== "string" || label.length === 0)) return void 0;
			if (description !== void 0 && (typeof description !== "string" || description.length === 0)) return;
			return {
				id,
				value: wire,
				...label === void 0 ? {} : { label },
				...description === void 0 ? {} : { description }
			};
		}
		function decodeGrokCatalogModel(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
			const id = value["id"];
			const name = value["name"];
			const thinking = value["thinking"];
			const vision = value["vision"];
			const contextWindow = value["contextWindow"];
			const defaultReasoningEffort = value["defaultReasoningEffort"];
			const reasoningEffortsValue = value["reasoningEfforts"];
			if (typeof id !== "string" || id.length === 0) return void 0;
			if (name !== void 0 && (typeof name !== "string" || name.length === 0)) return void 0;
			if (thinking !== void 0 && typeof thinking !== "boolean") return void 0;
			if (vision !== void 0 && typeof vision !== "boolean") return void 0;
			if (contextWindow !== void 0 && (typeof contextWindow !== "number" || !Number.isInteger(contextWindow) || contextWindow <= 0)) return void 0;
			if (defaultReasoningEffort !== void 0 && (typeof defaultReasoningEffort !== "string" || defaultReasoningEffort.length === 0)) return;
			let reasoningEfforts;
			if (reasoningEffortsValue !== void 0) {
				if (!Array.isArray(reasoningEffortsValue)) return void 0;
				reasoningEfforts = [];
				for (const entry of reasoningEffortsValue) {
					const effort = decodeGrokReasoningEffort(entry);
					if (effort === void 0) return void 0;
					reasoningEfforts.push(effort);
				}
			}
			return {
				id,
				...name === void 0 ? {} : { name },
				...thinking === void 0 ? {} : { thinking },
				...vision === void 0 ? {} : { vision },
				...contextWindow === void 0 ? {} : { contextWindow },
				...defaultReasoningEffort === void 0 ? {} : { defaultReasoningEffort },
				...reasoningEfforts === void 0 ? {} : { reasoningEfforts }
			};
		}
		function decodeGrokModelsReply(value) {
			if (!isRecord(value) || hasTokenFields(value) || !Array.isArray(value["models"])) return void 0;
			const models = [];
			for (const entry of value["models"]) {
				const model = decodeGrokCatalogModel(entry);
				if (model === void 0) return void 0;
				models.push(model);
			}
			return { models };
		}
		/**
		* Narrow the Host save reply before the card updates.
		* @param value - untrusted RPC result value.
		*/
		function decodeGrokSaveResult(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
			const revision = value["revision"];
			if (typeof revision !== "number" || !Number.isSafeInteger(revision)) return void 0;
			const settings = decodeGrokSettings(value["settings"]);
			return settings === void 0 ? void 0 : {
				settings,
				revision
			};
		}
		function decodeGrokUsageReply(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
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
		//#region src/client/provider-chrome.tsx
		const LABELS = /* @__PURE__ */ new Set([
			"LLM 供应商",
			"LLM Providers",
			"供应商",
			"Providers"
		]);
		const MARK = "data-dsh-providers-icon";
		const REFRESH_PATH = "M1.272 6.21348C1.70645 3.08888 4.59169 0.908064 7.71634 1.34239C8.95495 1.51469 10.0438 2.07331 10.8814 2.87755L11.9458 1.81407C12.1347 1.6255 12.4572 1.75911 12.4575 2.02598V5.08751C12.4574 5.25303 12.3233 5.38731 12.1577 5.38731H9.0972C8.82993 5.38731 8.69629 5.06361 8.88528 4.87462L10.0327 3.72618C9.3732 3.09994 8.52006 2.66569 7.5513 2.53087C5.08313 2.18779 2.80376 3.91044 2.46048 6.37852C2.11747 8.84665 3.84009 11.1261 6.30814 11.4693C8.77612 11.8121 11.0557 10.0896 11.399 7.62169L11.9937 7.70372L12.5874 7.78673C12.153 10.9112 9.26756 13.0919 6.1431 12.6578C3.01854 12.2234 0.837738 9.33809 1.272 6.21348Z";
		const NAV = "<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\" d=\"M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z\"/>";
		function patchNav() {
			if (typeof document === "undefined") return;
			for (const button of document.querySelectorAll("nav button")) {
				if ([...button.querySelectorAll("span")].find((span) => LABELS.has(span.textContent?.trim() ?? "")) === void 0) continue;
				const svg = button.querySelector("svg");
				if (svg === null || svg.getAttribute(MARK) === "globe") continue;
				svg.setAttribute(MARK, "globe");
				svg.setAttribute("viewBox", "0 0 14 14");
				svg.setAttribute("fill", "none");
				svg.innerHTML = NAV;
			}
		}
		/** Use the official 14px globe glyph on the LLM 供应商 nav row. */
		function installProvidersNavIcon() {
			if (typeof document === "undefined" || document.body === null) return () => {};
			ensureMotionStyles();
			let scheduled = false;
			let frame = 0;
			const flush = () => {
				scheduled = false;
				frame = 0;
				patchNav();
			};
			const observer = new MutationObserver(() => {
				if (scheduled) return;
				scheduled = true;
				frame = requestAnimationFrame(flush);
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			patchNav();
			return () => {
				observer.disconnect();
				if (frame !== 0) cancelAnimationFrame(frame);
				frame = 0;
				scheduled = false;
			};
		}
		function ensureMotionStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById("dsh-provider-motion") !== null) return;
			const style = document.createElement("style");
			style.id = "dsh-provider-motion";
			style.textContent = ["@keyframes dsh-provider-spin{to{transform:rotate(360deg)}}", "@keyframes dsh-provider-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}"].join("");
			document.head.appendChild(style);
		}
		const iconButtonStyle$1 = {
			boxSizing: "border-box",
			width: 28,
			height: 28,
			padding: 0,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 999,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			cursor: "pointer",
			flex: "none"
		};
		const authRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12
		};
		const trackStyle = {
			boxSizing: "border-box",
			height: 14,
			overflow: "hidden",
			borderRadius: 999,
			background: "color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)"
		};
		const shimmerStyle = {
			display: "block",
			width: "100%",
			height: "100%",
			background: "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent) 50%, transparent 100%)",
			backgroundSize: "200% 100%",
			animation: "dsh-provider-shimmer 1.25s ease-in-out infinite"
		};
		const chipStyle = {
			display: "inline-block",
			height: 12,
			borderRadius: 4,
			background: "linear-gradient(90deg, color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent) 0%, color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent) 50%, color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent) 100%)",
			backgroundSize: "200% 100%",
			animation: "dsh-provider-shimmer 1.25s ease-in-out infinite"
		};
		/** Account status on the left, sign-in / sign-out on the right. */
		function AuthToolbar(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: authRowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						minWidth: 0,
						flex: 1
					},
					children: props.status
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { flex: "none" },
					children: props.action
				})]
			});
		}
		/** Official `ic_ds_refresh_outline_14` glyph; spins while refreshing. */
		function RefreshIcon(props) {
			ensureMotionStyles();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				style: props.spinning === true ? { animation: "dsh-provider-spin 0.8s linear infinite" } : void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					fill: "currentColor",
					d: REFRESH_PATH
				})
			});
		}
		/** Icon-only refresh control used by every provider usage block. */
		function UsageRefreshButton(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: iconButtonStyle$1,
				disabled: props.disabled === true,
				"aria-label": props.spinning ? props.busyLabel : props.label,
				onClick: props.onClick,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, { spinning: props.spinning })
			});
		}
		/** Quota chart skeleton: same 14px tracks as live bars, with a moving sheen. */
		function UsageSkeleton(props) {
			ensureMotionStyles();
			const rows = props.rows ?? 2;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 10
				},
				"aria-hidden": "true",
				children: Array.from({ length: rows }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 6
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "baseline",
							justifyContent: "space-between",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
							...chipStyle,
							width: index === 0 ? 92 : 78
						} }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
							...chipStyle,
							width: 36
						} })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: trackStyle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: shimmerStyle })
					})]
				}, index))
			});
		}
		/**
		* Title + official refresh glyph used above usage bars.
		* @param props.title - localized usage heading.
		* @param props.spinning - whether a refresh is in flight.
		* @param props.disabled - when true, the refresh button is inert.
		* @param props.refreshLabel - idle aria-label.
		* @param props.busyLabel - aria-label while spinning.
		* @param props.onRefresh - fetch handler.
		* @param props.error - short failure hint shown left of the button.
		* @returns the usage block heading row.
		*/
		function UsageHeader(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 10
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					style: {
						margin: 0,
						fontSize: 13,
						fontWeight: 600,
						lineHeight: "18px"
					},
					children: props.title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: 8,
						flex: "none"
					},
					children: [props.error !== void 0 && props.error.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							lineHeight: "18px",
							color: "var(--dsw-alias-state-error-primary)"
						},
						children: props.error
					}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageRefreshButton, {
						spinning: props.spinning,
						disabled: props.disabled === true,
						label: props.refreshLabel,
						busyLabel: props.busyLabel,
						onClick: props.onRefresh
					})]
				})]
			});
		}
		/** Format a usage stamp as a compact local clock, e.g. "12:04". */
		function formatUsageClock(at) {
			return at.toLocaleTimeString(void 0, {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false
			});
		}
		function interpolateCopy(template, params) {
			return template.replace(/\{(\w+)\}/gu, (_match, key) => String(params[key] ?? ""));
		}
		function chineseLocale(locales) {
			const locale = typeof locales === "string" ? locales : locales?.[0] ?? (typeof navigator === "undefined" ? void 0 : navigator.language);
			return typeof locale === "string" && /^zh\b/iu.test(locale);
		}
		function pad2(value) {
			return String(value).padStart(2, "0");
		}
		/** Official grok.com form: 2026年8月20日 11:35. English stays a short local datetime. */
		function formatResetStamp(iso, locales) {
			const at = new Date(iso);
			if (Number.isNaN(at.getTime())) return iso;
			if (chineseLocale(locales)) return String(at.getFullYear()) + "年" + String(at.getMonth() + 1) + "月" + String(at.getDate()) + "日 " + pad2(at.getHours()) + ":" + pad2(at.getMinutes());
			return new Intl.DateTimeFormat(locales, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false
			}).format(at);
		}
		/** Official Cursor form: Sep 16 / 9月16日. */
		function formatResetDate(iso, locales) {
			const at = new Date(iso);
			if (Number.isNaN(at.getTime())) return iso;
			if (chineseLocale(locales)) return String(at.getMonth() + 1) + "月" + String(at.getDate()) + "日";
			return new Intl.DateTimeFormat(locales, {
				month: "short",
				day: "numeric"
			}).format(at);
		}
		/** Whole days until reset when at least one day remains; otherwise the datetime form is used. */
		function remainingResetDays(iso, now = Date.now()) {
			const at = Date.parse(iso);
			if (!Number.isFinite(at)) return void 0;
			const days = Math.round((at - now) / 864e5);
			return days >= 1 ? days : void 0;
		}
		/** Localized reset line matching official dashboards. */
		function resetLabelOf(iso, copy, now) {
			if (iso === void 0) return void 0;
			const locales = copy.at.includes("重置") ? "zh-CN" : "en";
			const days = remainingResetDays(iso, now);
			if (days !== void 0) return interpolateCopy(copy.atDays, {
				date: formatResetDate(iso, locales),
				count: days
			});
			return interpolateCopy(copy.at, { time: formatResetStamp(iso, locales) });
		}
		/** Official-style reset caption under a usage bar. */
		function UsageResetAt(props) {
			if (props.label === void 0 || props.label.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: {
					margin: 0,
					fontSize: 12,
					lineHeight: "18px",
					color: "var(--dsw-alias-label-tertiary)"
				},
				children: props.label
			});
		}
		/**
		* Last successful usage read, right-aligned under the bars.
		* @param props.at - when the last successful snapshot arrived.
		* @param props.label - already-localized "12:04 已更新".
		* @returns the stamp, or nothing before the first success.
		*/
		function UsageUpdatedAt(props) {
			if (props.at === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: {
					margin: 0,
					textAlign: "right",
					fontSize: 12,
					lineHeight: "18px",
					color: "var(--dsw-alias-label-tertiary)"
				},
				children: props.label
			});
		}
		const providerHeaderStyle = {
			boxSizing: "border-box",
			width: "100%",
			minHeight: 68,
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 16,
			border: 0,
			padding: "12px 14px",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer"
		};
		/** Join connection status and model count: "已登录 · 8 个模型". */
		function formatProviderSummary(status, modelsLabel) {
			return status.replace(/[。.]$/u, "") + " · " + modelsLabel;
		}
		/** Fixed-height collapsed header: mark, title, status · count, chevron. */
		function ProviderCardHeader(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: {
					display: "flex",
					minWidth: 0,
					flex: 1,
					flexDirection: "column",
					gap: 4
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: 8,
						fontSize: 14,
						fontWeight: 600,
						lineHeight: 1
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							width: 18,
							height: 18,
							flex: "none",
							display: "block",
							overflow: "visible"
						},
						children: props.mark
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { lineHeight: "20px" },
						children: props.title
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						fontSize: 13,
						lineHeight: "18px",
						color: "var(--dsw-alias-label-tertiary)",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis"
					},
					children: props.summary
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 10,
					flex: "none"
				},
				children: [props.unsaved === true && props.unsavedLabel !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						fontSize: 12,
						color: "var(--dsw-alias-label-tertiary)"
					},
					children: props.unsavedLabel
				}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						fontSize: 18,
						transform: props.open ? "rotate(180deg)" : "none"
					},
					children: "⌄"
				})]
			})] });
		}
		//#endregion
		//#region src/client/ProvidersSection.tsx
		/** Settings > 供应商 page shell. Provider cards arrive through settings.provider.item. */
		const pageStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 16,
			width: "100%"
		};
		const titleStyle$1 = {
			margin: 0,
			color: "var(--dsw-alias-label-primary)",
			fontSize: 16,
			fontWeight: 500,
			lineHeight: "24px"
		};
		const subtitleStyle = {
			margin: "4px 0 0",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 13,
			lineHeight: "20px"
		};
		const listStyle$2 = {
			display: "flex",
			flexDirection: "column",
			gap: 12
		};
		const emptyStyle = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 13,
			lineHeight: "20px"
		};
		/** Stable known order, then any keyed card the owner did not know about. */
		function orderedProviderItemKeys(registeredKeys = []) {
			const registered = [...new Set(registeredKeys.filter((key) => key.length > 0))];
			if (registered.length === 0) return [...PROVIDER_ITEM_ORDER];
			const preferred = PROVIDER_ITEM_ORDER.filter((key) => registered.includes(key));
			const extra = registered.filter((key) => !PROVIDER_ITEM_ORDER.includes(key));
			return [...preferred, ...extra];
		}
		/** Bind the shared page to the live keyed-slot ledger so new plugins appear without a whitelist bump. */
		function bindProvidersSection(listRegisteredKeys, subscribe) {
			return function BoundProvidersSection(props) {
				const [, bump] = (0, react.useState)(0);
				(0, react.useEffect)(() => subscribe?.(() => bump((n) => n + 1)) ?? (() => {}), [subscribe, listRegisteredKeys]);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProvidersSection, {
					...props,
					registeredKeys: listRegisteredKeys()
				});
			};
		}
		/** Render installed provider cards. Unknown plugins append after the preferred order. */
		function ProvidersSection(props) {
			const t = props.t ?? ((key) => key);
			const renderSlot = props.renderSlot;
			const items = orderedProviderItemKeys(props.registeredKeys).map((key) => {
				const node = renderSlot?.(PROVIDERS_ITEM_SLOT, {}, { entryKey: key });
				return node == null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react.Fragment, { children: node }, key);
			}).filter(Boolean);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-providers-section": PROVIDERS_LOCALE_NS,
				style: pageStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					style: titleStyle$1,
					children: t("title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: subtitleStyle,
					children: t("subtitle")
				})] }), items.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: listStyle$2,
					children: items
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: emptyStyle,
					children: t("empty")
				})]
			});
		}
		//#endregion
		//#region src/client/provider-section.ts
		const PROVIDERS_SECTION_ID = "providers";
		const PROVIDERS_ITEM_SLOT = "settings.provider.item";
		const PROVIDERS_LOCALE_NS = "settings.providers";
		/** Display order for installed provider cards. Absent plugins render nothing. */
		const PROVIDER_ITEM_ORDER = [
			"llm-cursor",
			"llm-grok",
			"llm-codex",
			"llm-ollama",
			"llm-commandcode",
			"llm-opencode-go"
		];
		const copy = {
			zh: {
				nav: "LLM 供应商",
				title: "LLM 供应商",
				subtitle: "连接账号，并选择哪些模型出现在对话的模型列表里。",
				empty: "安装 Cursor、Grok、Codex 或 Ollama Cloud 后，在这里连接账号并选择模型。"
			},
			en: {
				nav: "LLM Providers",
				title: "LLM Providers",
				subtitle: "Connect accounts and choose which models appear in the chat picker.",
				empty: "Install Cursor, Grok, Codex, or Ollama Cloud to connect an account and pick models here."
			}
		};
		function isOccupied(slots) {
			return slots.entries("settings.section").some((entry) => entry.options.id === PROVIDERS_SECTION_ID);
		}
		function duplicateSection(error) {
			return error instanceof Error && /already has|requires options/.test(error.message);
		}
		/**
		* Register the shared LLM 供应商 section when missing. Uninstalling every
		* provider plugin drops the nav row because only they call this helper.
		* @param ctx - browser plugin context (slots + locale).
		*/
		function ensureProviderSection(ctx) {
			const slots = ctx.slots;
			const locale = ctx.locale;
			ctx.slots.inject("settings.section", () => {
				let disposeSection;
				let disposeLocale;
				let disposeIcon;
				const claim = () => {
					if (disposeSection !== void 0 || isOccupied(slots)) return;
					disposeLocale ??= locale.register(PROVIDERS_LOCALE_NS, copy);
					const t = locale.bind(PROVIDERS_LOCALE_NS);
					try {
						disposeSection = slots.register({
							name: "settings.section",
							id: PROVIDERS_SECTION_ID,
							order: 12,
							label: () => t("nav"),
							locale: PROVIDERS_LOCALE_NS,
							children: { [PROVIDERS_ITEM_SLOT]: {
								kind: "keyed",
								scope: "root"
							} }
						}, bindProvidersSection(() => slots.entries(PROVIDERS_ITEM_SLOT).map((entry) => entry.options.key).filter((key) => typeof key === "string" && key.length > 0), (listener) => slots.subscribe?.(PROVIDERS_ITEM_SLOT, listener)));
						disposeIcon ??= installProvidersNavIcon();
					} catch (error) {
						if (!duplicateSection(error)) throw error;
					}
				};
				claim();
				const stop = slots.subscribe?.("settings.section", () => {
					if (!isOccupied(slots)) {
						disposeSection = void 0;
						claim();
					}
				});
				return () => {
					stop?.();
					disposeIcon?.();
					disposeIcon = void 0;
					disposeSection?.();
					disposeSection = void 0;
					disposeLocale?.();
					disposeLocale = void 0;
				};
			});
		}
		//#endregion
		//#region src/reasoning.ts
		/** Values the official Responses field `reasoning.effort` accepts today. */
		const GROK_REASONING_WIRES = [
			"low",
			"medium",
			"high",
			"xhigh"
		];
		/** models-v2 `reasoning_effort` and the documented API default. */
		const GROK_DEFAULT_REASONING_WIRE = "high";
		/** grok-4.6 menu from GET /v1/models-v2 (`id`/`value`/`label`). */
		const GROK_4_6_REASONING_EFFORTS = Object.freeze([
			Object.freeze({
				id: "xhigh",
				value: "xhigh",
				label: "Extra High Effort",
				description: "Highest effort and reasoning level"
			}),
			Object.freeze({
				id: "high",
				value: "high",
				label: "High Effort",
				description: "Higher implementation quality with extensive reasoning"
			}),
			Object.freeze({
				id: "medium",
				value: "medium",
				label: "Medium Effort",
				description: "Balanced effort with standard implementation and testing"
			}),
			Object.freeze({
				id: "low",
				value: "low",
				label: "Low Effort",
				description: "Quick, fast implementations"
			})
		]);
		/** grok-4.5 menu: same wire values minus `xhigh`. */
		const GROK_4_5_REASONING_EFFORTS = Object.freeze(GROK_4_6_REASONING_EFFORTS.filter((effort) => effort.value !== "xhigh"));
		/** Whether `value` is an official `reasoning.effort` spelling. */
		function isGrokReasoningWire(value) {
			return GROK_REASONING_WIRES.includes(value);
		}
		/**
		* Official advertised efforts for one catalog row. Live models-v2 rows win;
		* otherwise the frozen per-id menu is used.
		*/
		function officialEffortsFor(model) {
			if (model.reasoningEfforts !== void 0 && model.reasoningEfforts.length > 0) return model.reasoningEfforts;
			return model.id === "grok-4.5" ? GROK_4_5_REASONING_EFFORTS : GROK_4_6_REASONING_EFFORTS;
		}
		/** Official default `reasoning.effort` for one catalog row. */
		function officialDefaultEffort(model) {
			const values = new Set(officialEffortsFor(model).map((effort) => effort.value));
			const configured = model.defaultReasoningEffort;
			if (configured !== void 0 && values.has(configured) && isGrokReasoningWire(configured)) return configured;
			if (values.has("high")) return GROK_DEFAULT_REASONING_WIRE;
			for (const effort of officialEffortsFor(model)) if (isGrokReasoningWire(effort.value)) return effort.value;
			return GROK_DEFAULT_REASONING_WIRE;
		}
		//#endregion
		//#region src/client/BrandMark.tsx
		const SIZE = 18;
		/** Same optical size as the other 18px provider marks; 1 unit = 1 device pixel. */
		function BrandMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: SIZE,
				height: SIZE,
				viewBox: "0 0 18 18",
				"aria-hidden": "true",
				shapeRendering: "geometricPrecision",
				style: {
					display: "block",
					flex: "none"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "9",
					cy: "9",
					r: "6.75",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2.5"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					fill: "currentColor",
					d: "M1.55 16.45 7.65 10.35a1.2 1.2 0 0 1 1.7 0L16.45 1.55 10.35 7.65a1.2 1.2 0 0 1-1.7 0z"
				})]
			});
		}
		//#endregion
		//#region src/client/SortableList.tsx
		/** Pointer-driven sortable list with a floating ghost and animated live preview. */
		const listStyle$1 = {
			display: "flex",
			flexDirection: "column",
			gap: 8
		};
		const rowStyle = {
			display: "grid",
			gridTemplateColumns: "30px minmax(0, 1fr)",
			alignItems: "stretch",
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			transition: "box-shadow 150ms ease, opacity 150ms ease, transform 150ms ease"
		};
		const handleStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 30,
			minHeight: 42,
			border: 0,
			borderRight: "1px solid var(--dsw-alias-border-l2)",
			padding: 0,
			touchAction: "none",
			userSelect: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const ghostStyle = {
			...rowStyle,
			position: "fixed",
			zIndex: 1e4,
			pointerEvents: "none",
			opacity: .96,
			boxShadow: "var(--dsw-shadow-lv2, 0 10px 30px rgba(0, 0, 0, 0.18))",
			outline: "2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent)"
		};
		/** Grip glyph marking one row's pointer handle. */
		function IconGrip() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "10",
				height: "14",
				viewBox: "0 0 10 14",
				fill: "currentColor",
				"aria-hidden": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.5",
						cy: "2.5",
						r: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "7.5",
						cy: "2.5",
						r: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.5",
						cy: "7",
						r: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "7.5",
						cy: "7",
						r: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.5",
						cy: "11.5",
						r: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "7.5",
						cy: "11.5",
						r: "1.2"
					})
				]
			});
		}
		/**
		* A small dependency-free sortable surface adapted from CodexHub's
		* SortableList: pointer movement drives a portal ghost and a preview array,
		* while FLIP animations move sibling rows into their prospective positions.
		*/
		function SortableList({ items, getId, renderItem, dragLabel, onReorder, disabled = false }) {
			const [draggedId, setDraggedId] = (0, react.useState)(null);
			const [dropTargetId, setDropTargetId] = (0, react.useState)(null);
			const [previewItems, setPreviewItems] = (0, react.useState)(null);
			const [dragGhost, setDragGhost] = (0, react.useState)(null);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const previousRects = (0, react.useRef)(null);
			const previewRef = (0, react.useRef)(null);
			const dragGhostRef = (0, react.useRef)(null);
			const renderedItems = previewItems ?? items;
			const draggedItem = draggedId === null ? void 0 : renderedItems.find((item) => getId(item) === draggedId) ?? items.find((item) => getId(item) === draggedId);
			(0, react.useEffect)(() => {
				if (draggedId === null) return;
				const style = document.createElement("style");
				style.textContent = "html.ollama-sortable-dragging, html.ollama-sortable-dragging * { cursor: grabbing !important; user-select: none !important; }";
				const previousRootCursor = document.documentElement.style.cursor;
				const previousBodyCursor = document.body.style.cursor;
				document.head.appendChild(style);
				document.documentElement.classList.add("ollama-sortable-dragging");
				document.documentElement.style.cursor = "grabbing";
				document.body.style.cursor = "grabbing";
				return () => {
					document.documentElement.classList.remove("ollama-sortable-dragging");
					style.remove();
					document.documentElement.style.cursor = previousRootCursor;
					document.body.style.cursor = previousBodyCursor;
				};
			}, [draggedId]);
			(0, react.useEffect)(() => {
				if (draggedId === null) return;
				const handlePointerMove = (event) => {
					const currentGhost = dragGhostRef.current;
					if (currentGhost === null) return;
					event.preventDefault();
					const nextGhost = {
						...currentGhost,
						x: event.clientX - currentGhost.offsetX,
						y: event.clientY - currentGhost.offsetY
					};
					dragGhostRef.current = nextGhost;
					setDragGhost(nextGhost);
					movePreviewFromPointer(nextGhost.y + nextGhost.height / 2);
				};
				const handlePointerUp = (event) => {
					event.preventDefault();
					finishDrag(true);
				};
				const handlePointerCancel = (event) => {
					event.preventDefault();
					finishDrag(false);
				};
				const handleKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					finishDrag(false);
				};
				window.addEventListener("pointermove", handlePointerMove, { passive: false });
				window.addEventListener("pointerup", handlePointerUp, { passive: false });
				window.addEventListener("pointercancel", handlePointerCancel, { passive: false });
				window.addEventListener("keydown", handleKeyDown);
				return () => {
					window.removeEventListener("pointermove", handlePointerMove);
					window.removeEventListener("pointerup", handlePointerUp);
					window.removeEventListener("pointercancel", handlePointerCancel);
					window.removeEventListener("keydown", handleKeyDown);
				};
			}, [draggedId]);
			(0, react.useLayoutEffect)(() => {
				const rects = previousRects.current;
				if (rects === null) return;
				previousRects.current = null;
				rowRefs.current.forEach((node, id) => {
					const previous = rects.get(id);
					if (previous === void 0) return;
					const next = node.getBoundingClientRect();
					const deltaX = previous.left - next.left;
					const deltaY = previous.top - next.top;
					if (deltaX === 0 && deltaY === 0 || typeof node.animate !== "function") return;
					node.animate([{ transform: "translate(" + String(deltaX) + "px, " + String(deltaY) + "px)" }, { transform: "translate(0, 0)" }], {
						duration: 160,
						easing: "cubic-bezier(0.2, 0, 0, 1)"
					});
				});
			}, [renderedItems]);
			const startDrag = (event, id) => {
				if (disabled || event.button !== 0) return;
				const row = event.currentTarget.closest("[data-sortable-row=\"true\"]");
				if (!(row instanceof HTMLElement)) return;
				event.preventDefault();
				event.currentTarget.focus();
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
				const rect = row.getBoundingClientRect();
				const nextGhost = {
					id,
					x: rect.left,
					y: rect.top,
					width: rect.width,
					height: rect.height,
					offsetX: event.clientX - rect.left,
					offsetY: event.clientY - rect.top
				};
				dragGhostRef.current = nextGhost;
				const initial = [...items];
				previewRef.current = initial;
				setPreviewItems(initial);
				setDragGhost(nextGhost);
				setDraggedId(id);
			};
			const finishDrag = (commit) => {
				const next = previewRef.current;
				if (commit && next !== null && !sameOrder(next, items, getId)) onReorder(next);
				previewRef.current = null;
				dragGhostRef.current = null;
				setPreviewItems(null);
				setDragGhost(null);
				setDraggedId(null);
				setDropTargetId(null);
			};
			const captureRects = () => {
				previousRects.current = new Map(Array.from(rowRefs.current.entries()).map(([id, node]) => [id, node.getBoundingClientRect()]));
			};
			const setRowRef = (id, node) => {
				if (node === null) rowRefs.current.delete(id);
				else rowRefs.current.set(id, node);
			};
			const movePreviewFromPointer = (pointerY) => {
				if (draggedId === null) return;
				const current = previewRef.current ?? [...items];
				const from = current.findIndex((item) => getId(item) === draggedId);
				if (from < 0) return;
				const dragged = current[from];
				if (dragged === void 0) return;
				const remaining = current.filter((item) => getId(item) !== draggedId);
				let insertionIndex = remaining.length;
				let nextDropTargetId = remaining.length === 0 ? null : getId(remaining[remaining.length - 1]);
				for (let index = 0; index < remaining.length; index += 1) {
					const item = remaining[index];
					if (item === void 0) continue;
					const id = getId(item);
					const node = rowRefs.current.get(id);
					if (node === void 0) continue;
					const rect = node.getBoundingClientRect();
					if (pointerY < rect.top + rect.height / 2) {
						insertionIndex = index;
						nextDropTargetId = id;
						break;
					}
				}
				const next = [
					...remaining.slice(0, insertionIndex),
					dragged,
					...remaining.slice(insertionIndex)
				];
				setDropTargetId(nextDropTargetId);
				if (sameOrder(next, current, getId)) return;
				captureRects();
				previewRef.current = next;
				setPreviewItems(next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: listStyle$1,
				children: [renderedItems.map((item, index) => {
					const id = getId(item);
					const dragging = draggedId === id;
					const targeted = dropTargetId === id && draggedId !== id;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: (node) => {
							setRowRef(id, node);
						},
						"data-sortable-row": "true",
						style: {
							...rowStyle,
							visibility: dragging ? "hidden" : "visible",
							pointerEvents: dragging ? "none" : "auto",
							borderColor: dragging ? "transparent" : "var(--dsw-alias-border-l2)",
							boxShadow: targeted ? "0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent)" : "none"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: {
								...handleStyle,
								cursor: disabled ? "default" : draggedId === null ? "grab" : "grabbing"
							},
							"aria-label": dragLabel(item, index),
							"aria-grabbed": dragging,
							title: dragLabel(item, index),
							disabled,
							onDragStart: (event) => {
								event.preventDefault();
							},
							onPointerDown: (event) => {
								startDrag(event, id);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconGrip, {})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { minWidth: 0 },
							children: renderItem(item, index)
						})]
					}, id);
				}), dragGhost !== null && draggedItem !== void 0 ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-sortable-ghost": "true",
					style: {
						...ghostStyle,
						left: dragGhost.x,
						top: dragGhost.y,
						width: dragGhost.width,
						minHeight: dragGhost.height
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...handleStyle,
							cursor: "grabbing"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconGrip, {})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { minWidth: 0 },
						children: renderItem(draggedItem, renderedItems.findIndex((item) => getId(item) === draggedId))
					})]
				}), document.body) : null]
			});
		}
		function sameOrder(left, right, getId) {
			return left.length === right.length && left.every((item, index) => {
				const other = right[index];
				return other !== void 0 && getId(item) === getId(other);
			});
		}
		//#endregion
		//#region src/client/GrokPluginCard.tsx
		/** Grok Plugin configuration card: Host-owned xAI login, usage, and an editable displayed catalog. */
		const cardStyle = {
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const headerStyle$1 = providerHeaderStyle;
		const bodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			padding: "16px 14px 18px"
		};
		const sectionStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 12
		};
		const sectionTitleStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const hintStyle = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const labelStyle = {
			fontSize: 13,
			color: "var(--dsw-alias-label-secondary)"
		};
		const statusStyle$1 = {
			margin: 0,
			fontSize: 13,
			color: "var(--dsw-alias-label-secondary)"
		};
		const errorStyle$1 = {
			...statusStyle$1,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const barTrackStyle = {
			boxSizing: "border-box",
			height: 14,
			display: "flex",
			overflow: "hidden",
			borderRadius: 999,
			background: "color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)"
		};
		const buttonStyle = {
			alignSelf: "flex-start",
			minHeight: 34,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			padding: "6px 14px",
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			cursor: "pointer"
		};
		const primaryButtonStyle = {
			...buttonStyle,
			borderColor: "var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		const inputStyle = {
			boxSizing: "border-box",
			width: "100%",
			minHeight: 36,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			padding: "7px 10px",
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit"
		};
		const rowInputStyle = {
			...inputStyle,
			minHeight: 32,
			padding: "4px 10px"
		};
		const actionsStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: 10
		};
		const iconButtonStyle = {
			boxSizing: "border-box",
			width: 28,
			height: 28,
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			flex: "none",
			border: 0,
			borderRadius: 6,
			padding: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			font: "inherit",
			cursor: "pointer"
		};
		const disclosureStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			minWidth: 0,
			border: 0,
			padding: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer"
		};
		const modelContentStyle = {
			display: "grid",
			gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) auto auto",
			alignItems: "center",
			gap: 6,
			padding: "6px 8px"
		};
		const modelDetailStyle = {
			display: "flex",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 14,
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			padding: "10px 4px 4px"
		};
		let nextModelRow = 0;
		/** Stable client-only row identity used by the pointer sortable preview. */
		function newModelRowId() {
			nextModelRow += 1;
			return "grok-model-row-" + String(nextModelRow);
		}
		function integerOf(text) {
			const trimmed = text.trim();
			if (trimmed.length === 0) return void 0;
			if (!/^[1-9]\d*$/u.test(trimmed)) return NaN;
			return Number(trimmed);
		}
		function modelDraftOf(model) {
			return {
				rowId: newModelRowId(),
				id: model.id,
				contextWindow: model.contextWindow === void 0 ? "" : String(model.contextWindow),
				...model.name === void 0 ? {} : { name: model.name },
				...model.thinking === void 0 ? {} : { thinking: model.thinking },
				...model.vision === void 0 ? {} : { vision: model.vision },
				...model.defaultReasoningEffort === void 0 ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
				...model.reasoningEfforts === void 0 ? {} : { reasoningEfforts: model.reasoningEfforts }
			};
		}
		function modelSettingsOf(draft) {
			const contextWindow = integerOf(draft.contextWindow);
			return {
				id: draft.id.trim(),
				...draft.name === void 0 || draft.name.trim().length === 0 ? {} : { name: draft.name.trim() },
				...draft.thinking === void 0 ? {} : { thinking: draft.thinking },
				...draft.vision === void 0 ? {} : { vision: draft.vision },
				...draft.defaultReasoningEffort === void 0 ? {} : { defaultReasoningEffort: draft.defaultReasoningEffort },
				...contextWindow === void 0 || Number.isNaN(contextWindow) ? {} : { contextWindow },
				...draft.reasoningEfforts === void 0 ? {} : { reasoningEfforts: draft.reasoningEfforts }
			};
		}
		function sameDraft(left, right) {
			return JSON.stringify(left.map(modelSettingsOf)) === JSON.stringify(right.map(modelSettingsOf));
		}
		function modelFailure(models) {
			const ids = /* @__PURE__ */ new Set();
			for (const model of models) {
				const id = model.id.trim();
				if (id.length === 0 || ids.has(id)) return true;
				if (Number.isNaN(integerOf(model.contextWindow))) return true;
				ids.add(id);
			}
			return false;
		}
		function formatSignedIn(t, email) {
			if (email === void 0) return t("signedInNoEmail");
			return t("signedInAs").replace("{email}", email);
		}
		function messageOf(error, fallback) {
			return error instanceof Error && error.message.length > 0 ? error.message : fallback;
		}
		function Capability({ label, checked, disabled, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				style: {
					...labelStyle,
					display: "inline-flex",
					alignItems: "center",
					gap: 6
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked,
					disabled,
					onChange: (event) => {
						onChange(event.target.checked);
					}
				}), label]
			});
		}
		function IconChevron({ open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				style: {
					flex: "none",
					transform: open ? "rotate(90deg)" : "none",
					transition: "transform 120ms ease"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6 3.5L10.5 8L6 12.5",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function IconTrash() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4",
					stroke: "currentColor",
					strokeWidth: "1.3",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** One quota window: used/limit numbers and a solid meter. */
		function UsageBar({ usedText, window: quota, t }) {
			const ratio = quota.limit > 0 ? quota.used / quota.limit : quota.used > 0 ? 1 : 0;
			const percent = Math.round(ratio * 1e3) / 10;
			const fill = Math.min(100, Math.max(0, percent));
			const label = quota.period === void 0 || quota.resetsAt !== void 0 ? quota.id : quota.id + " (" + quota.period + ")";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 6
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "baseline",
							justifyContent: "space-between",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: labelStyle,
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: hintStyle,
							children: quota.unit === "percent" ? String(quota.used) + "%" : usedText + " " + String(quota.used) + " / " + String(quota.limit)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: barTrackStyle,
						role: "progressbar",
						"aria-label": label,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": Math.round(fill),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"data-usage-fill": "true",
							style: {
								width: String(fill) + "%",
								height: "100%",
								flex: "none",
								background: "var(--dsw-alias-state-business-primary)",
								transition: "width 200ms ease"
							}
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageResetAt, { label: resetLabelOf(quota.resetsAt, usageResetCopy(t)) })
				]
			});
		}
		function usageResetCopy(t) {
			return {
				at: t("usageResetAt"),
				atDays: t("usageResetAtDays")
			};
		}
		/** Render the single-package Grok contribution under Plugin configuration. */
		function GrokPluginCard(props) {
			const { t, startAuth, completeAuth, readAuthStatus, logout, fetchUsage, fetchModels } = props;
			const snapshot = props.useGrokSettings((value) => value);
			const [open, setOpen] = (0, react.useState)(false);
			const initial = (0, react.useMemo)(() => snapshot.value === void 0 ? void 0 : snapshot.value.models.map(modelDraftOf), [snapshot.value]);
			const [source, setSource] = (0, react.useState)(initial);
			const [draft, setDraft] = (0, react.useState)(initial);
			const [sourceRevision, setSourceRevision] = (0, react.useState)(snapshot.revision);
			const [auth, setAuth] = (0, react.useState)({ kind: "signed-out" });
			const [pasteCode, setPasteCode] = (0, react.useState)("");
			const [usage, setUsage] = (0, react.useState)({ status: "idle" });
			const [lastUsage, setLastUsage] = (0, react.useState)(void 0);
			const [usageUpdatedAt, setUsageUpdatedAt] = (0, react.useState)(void 0);
			const [enableImageGen, setEnableImageGen] = (0, react.useState)(snapshot.value?.enableImageGen === true);
			const [sourceEnableImageGen, setSourceEnableImageGen] = (0, react.useState)(snapshot.value?.enableImageGen === true);
			const [catalogOpen, setCatalogOpen] = (0, react.useState)(false);
			const [expandedModels, setExpandedModels] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [busy, setBusy] = (0, react.useState)(false);
			const [fetching, setFetching] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(void 0);
			const title = t("title");
			const signingIn = auth.kind === "signing-in";
			const disabled = snapshot.status !== "ready" || !snapshot.writable || busy;
			const dirty = source !== void 0 && draft !== void 0 && !sameDraft(source, draft) || enableImageGen !== sourceEnableImageGen;
			const invalid = draft !== void 0 && modelFailure(draft);
			const customModels = snapshot.user !== void 0 && Object.prototype.hasOwnProperty.call(snapshot.user, "models");
			(0, react.useEffect)(() => {
				if (snapshot.status !== "ready" || snapshot.value === void 0) return;
				if (snapshot.revision === sourceRevision) return;
				if (dirty) return;
				const next = snapshot.value.models.map(modelDraftOf);
				setSource(next);
				setDraft(next);
				setEnableImageGen(snapshot.value.enableImageGen);
				setSourceEnableImageGen(snapshot.value.enableImageGen);
				setSourceRevision(snapshot.revision);
			}, [
				dirty,
				snapshot.revision,
				snapshot.status,
				snapshot.value,
				sourceRevision
			]);
			(0, react.useEffect)(() => () => {
				props.closeModelPicker();
			}, [props.closeModelPicker]);
			const loadUsage = async () => {
				setUsage({ status: "loading" });
				try {
					const read = await fetchUsage();
					if (read.status === "logged-out") {
						setAuth({ kind: "signed-out" });
						setUsage({ status: "idle" });
						return;
					}
					if (read.status === "unsupported") {
						setUsage({ status: "unsupported" });
						return;
					}
					setLastUsage(read.usage);
					setUsageUpdatedAt(/* @__PURE__ */ new Date());
					setUsage({
						status: "ready",
						usage: read.usage
					});
				} catch (error) {
					setUsage({
						status: "error",
						message: messageOf(error, t("usageFailed"))
					});
				}
			};
			(0, react.useEffect)(() => {
				let cancelled = false;
				readAuthStatus().then((status) => {
					if (cancelled) return;
					if (status.loggedIn) {
						setAuth({
							kind: "signed-in",
							...status.email === void 0 ? {} : { email: status.email }
						});
						return;
					}
					setAuth({ kind: "signed-out" });
					setLastUsage(void 0);
					setUsageUpdatedAt(void 0);
					setUsage({ status: "idle" });
				}).catch(() => {
					if (!cancelled) {
						setAuth({
							kind: "signed-out",
							message: t("statusFailed")
						});
						setUsage({ status: "idle" });
					}
				});
				return () => {
					cancelled = true;
				};
			}, [readAuthStatus, t]);
			(0, react.useEffect)(() => {
				if (!open || auth.kind !== "signed-in") return;
				setUsage({ status: "loading" });
				loadUsage();
			}, [open, auth.kind]);
			const patchDraft = (models) => {
				setDraft(models);
				setFailure(void 0);
				setNotice(void 0);
			};
			const patchModel = (index, patch) => {
				if (draft === void 0) return;
				patchDraft(draft.map((model, at) => {
					if (at !== index) return model;
					const next = { ...model };
					if (patch.id !== void 0) next.id = patch.id;
					if ("name" in patch) {
						if (patch.name === void 0) delete next.name;
						else next.name = patch.name;
					}
					if ("thinking" in patch) {
						if (patch.thinking === void 0) delete next.thinking;
						else next.thinking = patch.thinking;
					}
					if ("vision" in patch) {
						if (patch.vision === void 0) delete next.vision;
						else next.vision = patch.vision;
					}
					if ("defaultReasoningEffort" in patch) {
						if (patch.defaultReasoningEffort === void 0) delete next.defaultReasoningEffort;
						else next.defaultReasoningEffort = patch.defaultReasoningEffort;
					}
					if ("contextWindow" in patch) next.contextWindow = patch.contextWindow ?? "";
					return next;
				}));
			};
			const onSignIn = async () => {
				setAuth({ kind: "signing-in" });
				setPasteCode("");
				setUsage({ status: "idle" });
				try {
					const started = await startAuth();
					if (!started.ok) {
						setAuth({
							kind: "signed-out",
							message: started.message || t("signInFailed")
						});
						return;
					}
					const status = await readAuthStatus();
					setAuth(status.loggedIn ? {
						kind: "signed-in",
						...status.email === void 0 ? {} : { email: status.email }
					} : {
						kind: "signed-out",
						message: t("signInFailed")
					});
				} catch {
					setAuth({
						kind: "signed-out",
						message: t("signInFailed")
					});
				}
			};
			const onPasteCode = async () => {
				const code = pasteCode.trim();
				if (code.length === 0) {
					setAuth({ kind: "signing-in" });
					return;
				}
				try {
					if (!(await completeAuth(code)).ok) setAuth({ kind: "signing-in" });
				} catch {
					setAuth({ kind: "signing-in" });
				}
			};
			const onSignOut = async () => {
				try {
					await logout();
					setAuth({ kind: "signed-out" });
					setLastUsage(void 0);
					setUsageUpdatedAt(void 0);
					setUsage({ status: "idle" });
				} catch {
					setAuth((current) => current.kind === "signed-in" ? current : {
						kind: "signed-out",
						message: t("signOutFailed")
					});
				}
			};
			const chooseFromAccount = async () => {
				if (draft === void 0) return;
				const currentModels = draft.map(modelSettingsOf);
				const initiallyPicked = new Set(currentModels.map((model) => model.id));
				setFetching(true);
				setFailure(void 0);
				setNotice(void 0);
				props.beginModelPicker(initiallyPicked, (selected) => {
					setDraft((current) => {
						if (current === void 0) return current;
						const currentById = new Map(current.map((model) => [model.id.trim(), model]));
						const next = /* @__PURE__ */ new Map();
						for (const candidate of selected) {
							const existing = currentById.get(candidate.id);
							const discovered = modelDraftOf(candidate);
							next.set(candidate.id, existing === void 0 ? discovered : {
								...existing,
								...discovered,
								rowId: existing.rowId
							});
						}
						return [...next.values()];
					});
					setCatalogOpen(true);
					setFailure(void 0);
					setNotice(void 0);
				});
				try {
					const found = await fetchModels();
					if (found.length === 0) {
						const message = t("fetchEmpty");
						props.failModelPicker(message);
						setFailure(message);
						return;
					}
					const foundIds = new Set(found.map((model) => model.id));
					const currentOnly = currentModels.filter((model) => !foundIds.has(model.id));
					props.completeModelPicker([...found, ...currentOnly]);
				} catch (error) {
					const message = messageOf(error, t("requestFailed"));
					props.failModelPicker(message);
					setFailure(message);
				} finally {
					setFetching(false);
				}
			};
			const discard = () => {
				if (source !== void 0) setDraft(source.map((model) => ({ ...model })));
				setEnableImageGen(sourceEnableImageGen);
				setFailure(void 0);
				setNotice(void 0);
			};
			const save = async () => {
				if (draft === void 0 || snapshot.value === void 0 || invalid) return;
				setBusy(true);
				setFailure(void 0);
				setNotice(void 0);
				try {
					const accepted = await props.saveConfiguration({
						...snapshot.value,
						models: draft.map(modelSettingsOf),
						enableImageGen
					});
					const next = accepted.settings.models.map(modelDraftOf);
					setSource(next);
					setDraft(next);
					setEnableImageGen(accepted.settings.enableImageGen);
					setSourceEnableImageGen(accepted.settings.enableImageGen);
					setSourceRevision(accepted.revision);
					setNotice(t("saved"));
				} catch (error) {
					setFailure(messageOf(error, t("requestFailed")));
				} finally {
					setBusy(false);
				}
			};
			const statusLabel = signingIn ? t("signingIn") : auth.kind === "signed-in" ? formatSignedIn(t, auth.email) : auth.message ?? t("signedOut");
			const modelCount = draft?.length ?? 0;
			const headerSummary = formatProviderSummary(auth.kind === "signed-in" ? t("summaryOn") : t("summaryOff"), t("summaryModels").replace("{count}", String(modelCount)));
			if (snapshot.status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: headerStyle$1,
					"aria-expanded": open,
					"aria-label": t(open ? "collapse" : "expand") + ": " + title,
					onClick: () => {
						setOpen(!open);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCardHeader, {
						title,
						mark: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandMark, {}),
						summary: headerSummary,
						open
					})
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: bodyStyle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: statusStyle$1,
						role: "status",
						children: t("remoteAccess")
					})
				}) : null]
			});
			if (snapshot.status !== "ready" || draft === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: headerStyle$1,
					"aria-expanded": open,
					"aria-label": t(open ? "collapse" : "expand") + ": " + title,
					onClick: () => {
						setOpen(!open);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCardHeader, {
						title,
						mark: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandMark, {}),
						summary: headerSummary,
						open
					})
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: bodyStyle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: statusStyle$1,
						children: t("loading")
					})
				}) : null]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: headerStyle$1,
					"aria-expanded": open,
					"aria-label": t(open ? "collapse" : "expand") + ": " + title,
					onClick: () => {
						setOpen(!open);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCardHeader, {
						title,
						mark: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandMark, {}),
						summary: headerSummary,
						open,
						unsaved: dirty,
						unsavedLabel: t("unsaved")
					})
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: bodyStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle,
							children: t("description")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": statusLabel,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AuthToolbar, {
								status: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: {
										...statusStyle$1,
										margin: 0
									},
									children: statusLabel
								}),
								action: auth.kind === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: signingIn,
									onClick: () => {
										onSignOut();
									},
									children: t("signOut")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: signingIn,
									onClick: () => {
										onSignIn();
									},
									children: t("signIn")
								})
							}), auth.kind === "signing-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: hintStyle,
										children: t("pasteCode")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										style: labelStyle,
										htmlFor: "grok-oauth-code",
										children: t("pasteCodeLabel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "grok-oauth-code",
										style: inputStyle,
										value: pasteCode,
										autoComplete: "off",
										spellCheck: false,
										"aria-label": t("pasteCodeLabel"),
										onChange: (event) => {
											setPasteCode(event.target.value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle,
										disabled: pasteCode.trim().length === 0,
										onClick: () => {
											onPasteCode();
										},
										children: t("pasteCodeSubmit")
									})
								]
							}) : null]
						}),
						auth.kind === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": t("usage"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageHeader, {
									title: t("usage"),
									spinning: usage.status === "loading" || usage.status === "idle",
									disabled: usage.status === "loading",
									refreshLabel: t("usageRefresh"),
									busyLabel: t("usageLoading"),
									...usage.status === "error" ? { error: t("usageRefreshFailed") } : {},
									onRefresh: () => {
										loadUsage();
									}
								}),
								(() => {
									if (usage.status === "loading" || usage.status === "idle") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageSkeleton, { rows: lastUsage?.windows.length ?? 1 });
									const bars = usage.status === "ready" ? usage.usage : lastUsage;
									if (bars !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: bars.windows.map((window, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageBar, {
										usedText: t("usageUsed"),
										window,
										t
									}, window.id + ":" + String(index))) });
									if (usage.status === "unsupported") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: hintStyle,
										children: t("usageUnsupported")
									});
									if (usage.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: errorStyle$1,
										children: usage.message
									});
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageSkeleton, { rows: 1 });
								})(),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageUpdatedAt, {
									at: usageUpdatedAt,
									label: usageUpdatedAt === void 0 ? "" : t("usageUpdatedAt").replace("{time}", formatUsageClock(usageUpdatedAt))
								})
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": t("models"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 10
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									style: disclosureStyle,
									"aria-expanded": catalogOpen,
									"aria-label": t("models"),
									onClick: () => {
										setCatalogOpen(!catalogOpen);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevron, { open: catalogOpen }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: sectionTitleStyle,
											children: t("models")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: hintStyle,
											children: customModels ? t("customized") : t("inherited")
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: fetching || disabled,
									onClick: () => {
										chooseFromAccount();
									},
									children: t(fetching ? "fetchingModels" : "fetchModels")
								})]
							}), catalogOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SortableList, {
								items: draft,
								getId: (model) => model.rowId,
								disabled,
								dragLabel: (model, index) => {
									const label = model.id.trim().length > 0 ? model.id.trim() : String(index + 1);
									return t("dragModel") + ": " + label;
								},
								onReorder: patchDraft,
								renderItem: (model, index) => {
									const expanded = expandedModels.has(model.rowId);
									const label = model.id.trim().length > 0 ? model.id.trim() : String(index + 1);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										"data-model-row": label,
										style: modelContentStyle,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: rowInputStyle,
												value: model.id,
												placeholder: t("modelId"),
												"aria-label": t("modelId") + " " + String(index + 1),
												disabled,
												onChange: (event) => {
													patchModel(index, { id: event.target.value });
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: rowInputStyle,
												value: model.name ?? "",
												placeholder: t("modelName"),
												"aria-label": t("modelName") + " " + String(index + 1),
												disabled,
												onChange: (event) => {
													patchModel(index, { name: event.target.value || void 0 });
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: iconButtonStyle,
												"aria-label": t("modelDetails") + ": " + label,
												"aria-expanded": expanded,
												title: t("modelDetails"),
												onClick: () => {
													setExpandedModels((current) => {
														const next = new Set(current);
														if (!next.delete(model.rowId)) next.add(model.rowId);
														return next;
													});
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevron, { open: expanded })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: iconButtonStyle,
												"aria-label": t("remove") + " " + label,
												title: t("remove"),
												disabled,
												onClick: () => {
													patchDraft(draft.filter((_, at) => at !== index));
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconTrash, {})
											}),
											expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													...modelDetailStyle,
													gridColumn: "1 / -1"
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Capability, {
														label: t("vision"),
														checked: model.vision === true,
														disabled,
														onChange: (vision) => {
															patchModel(index, { vision });
														}
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Capability, {
														label: t("thinking"),
														checked: model.thinking === true,
														disabled,
														onChange: (thinking) => {
															if (!thinking) patchModel(index, {
																thinking,
																defaultReasoningEffort: void 0
															});
															else patchModel(index, { thinking });
														}
													}),
													(() => {
														const settings = modelSettingsOf(model);
														const efforts = settings.thinking === true ? officialEffortsFor(settings) : [];
														if (efforts.length === 0) return null;
														const suggested = officialDefaultEffort(settings);
														return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
															style: {
																...labelStyle,
																display: "inline-flex",
																alignItems: "center",
																gap: 6
															},
															children: [t("defaultEffort"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
																style: rowInputStyle,
																value: model.defaultReasoningEffort ?? suggested,
																disabled,
																"aria-label": t("defaultEffort"),
																onChange: (event) => {
																	const effort = efforts.find((entry) => entry.value === event.target.value);
																	patchModel(index, { defaultReasoningEffort: effort?.value });
																},
																children: efforts.map((effort) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																	value: effort.value,
																	children: effort.label ?? effort.value
																}, effort.value))
															})]
														});
													})(),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														style: {
															...labelStyle,
															display: "inline-flex",
															alignItems: "center",
															gap: 6
														},
														children: [t("contextWindow"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															style: {
																...rowInputStyle,
																width: 110
															},
															inputMode: "numeric",
															placeholder: t("contextWindowDefault"),
															value: model.contextWindow,
															disabled,
															"aria-label": t("contextWindow"),
															onChange: (event) => {
																patchModel(index, { contextWindow: event.target.value });
															}
														})]
													})
												]
											}) : null
										]
									});
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...buttonStyle,
									alignSelf: "flex-start"
								},
								disabled,
								onClick: () => {
									const model = {
										rowId: newModelRowId(),
										id: "",
										contextWindow: ""
									};
									patchDraft([...draft, model]);
									setExpandedModels((current) => new Set(current).add(model.rowId));
								},
								children: t("addModel")
							})] }) : null]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": t("capabilities"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: sectionTitleStyle,
									children: t("capabilities")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Capability, {
									label: t("enableImageGen"),
									checked: enableImageGen,
									disabled,
									onChange: (checked) => {
										setEnableImageGen(checked);
										setFailure(void 0);
										setNotice(void 0);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: hintStyle,
									children: t("enableImageGenHelp")
								})
							]
						}),
						invalid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle$1,
							children: t("invalidModel")
						}) : null,
						failure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle$1,
							children: failure
						}),
						notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: statusStyle$1,
							children: notice
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: actionsStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: !dirty || busy,
								onClick: discard,
								children: t("discard")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle,
								disabled: !dirty || invalid || disabled,
								onClick: () => {
									save();
								},
								children: t(busy ? "saving" : "save")
							})]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/GrokModelPicker.tsx
		/** Frame-level model selection overlay opened by the Grok settings card. */
		/** Shared observable joining the settings card to its frame-level overlay. */
		var GrokModelPickerController = class {
			snapshot = {
				open: false,
				loading: false,
				candidates: [],
				picked: /* @__PURE__ */ new Set()
			};
			listeners = /* @__PURE__ */ new Set();
			onAdopt;
			/** Read the stable snapshot identity until picker state changes. */
			getSnapshot = () => this.snapshot;
			/** Subscribe one renderer listener. */
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			/** Open immediately while discovery loads with the current selection captured. */
			begin(onAdopt, initiallyPicked = /* @__PURE__ */ new Set()) {
				this.onAdopt = onAdopt;
				this.publish({
					open: true,
					loading: true,
					candidates: [],
					picked: new Set(initiallyPicked)
				});
			}
			/** Populate an open loading picker, retaining only current ids present in the result. */
			complete(candidates) {
				if (!this.snapshot.open || !this.snapshot.loading) return;
				const candidateIds = new Set(candidates.map((model) => model.id));
				this.publish({
					open: true,
					loading: false,
					candidates: [...candidates],
					picked: new Set([...this.snapshot.picked].filter((id) => candidateIds.has(id)))
				});
			}
			/** Keep the open picker visible with a discovery failure. */
			fail(message) {
				if (!this.snapshot.open || !this.snapshot.loading) return;
				this.publish({
					open: true,
					loading: false,
					candidates: [],
					picked: /* @__PURE__ */ new Set(),
					error: message
				});
			}
			/** Close without adopting any candidate. */
			close = () => {
				this.onAdopt = void 0;
				this.publish({
					open: false,
					loading: false,
					candidates: [],
					picked: /* @__PURE__ */ new Set()
				});
			};
			/** Toggle one candidate by id. */
			toggle = (id) => {
				const picked = new Set(this.snapshot.picked);
				if (picked.has(id)) picked.delete(id);
				else picked.add(id);
				this.publish({
					...this.snapshot,
					picked
				});
			};
			/** Close and deliver the selected candidates to the card. */
			adopt = () => {
				if (this.snapshot.loading || this.snapshot.error !== void 0) return;
				const callback = this.onAdopt;
				const selected = this.snapshot.candidates.filter((model) => this.snapshot.picked.has(model.id));
				this.close();
				callback?.(selected);
			};
			publish(snapshot) {
				this.snapshot = snapshot;
				for (const listener of this.listeners) listener();
			}
		};
		const rootStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 1e3,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			boxSizing: "border-box",
			padding: 24
		};
		const maskStyle = {
			position: "absolute",
			inset: 0,
			background: "var(--dsw-alias-bg-mask-1)",
			backdropFilter: "var(--dsw-mask-blur)"
		};
		const dialogStyle = {
			position: "relative",
			zIndex: 1,
			display: "flex",
			flexDirection: "column",
			width: "min(520px, 100%)",
			maxHeight: "min(680px, calc(100vh - 48px))",
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-inverted)",
			borderRadius: 24,
			background: "var(--dsw-alias-bg-layer-2)",
			boxShadow: "var(--dsw-shadow-lv3)",
			color: "var(--dsw-alias-label-primary)"
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8,
			padding: "22px 14px 12px 24px"
		};
		const titleStyle = {
			margin: 0,
			fontSize: 16,
			lineHeight: "24px",
			fontWeight: 500
		};
		const closeStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 28,
			height: 28,
			border: 0,
			borderRadius: 8,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer",
			fontSize: 22
		};
		const descriptionStyle = {
			margin: 0,
			padding: "0 24px",
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)"
		};
		const listStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14,
			minHeight: 0,
			margin: "20px 24px",
			padding: 0,
			overflowY: "auto",
			listStyle: "none"
		};
		const candidateStyle = {
			display: "flex",
			alignItems: "center",
			gap: 10,
			fontSize: 14,
			lineHeight: "22px",
			cursor: "pointer"
		};
		const statusStyle = {
			display: "flex",
			alignItems: "center",
			minHeight: 96,
			margin: "20px 24px",
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const errorStyle = {
			...statusStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const footerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: 8,
			padding: "0 24px 24px"
		};
		const outlineButtonStyle = {
			height: 36,
			padding: "0 14px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer",
			fontSize: 14
		};
		/** Render the Grok model candidate picker in the frame overlay layer. */
		function GrokModelPicker(props) {
			const { t } = props;
			const snapshot = props.useGrokModelPicker((value) => value);
			(0, react.useEffect)(() => {
				if (!snapshot.open) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") props.closePicker();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [snapshot.open, props.closePicker]);
			if (!snapshot.open) return null;
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rootStyle,
				role: "presentation",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: maskStyle,
					"aria-hidden": "true",
					onClick: props.closePicker
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: dialogStyle,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("pickerTitle"),
					"aria-busy": snapshot.loading,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: headerStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								style: titleStyle,
								children: t("pickerTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: closeStyle,
								"aria-label": t("close"),
								onClick: props.closePicker,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: descriptionStyle,
							children: t("pickerDescription")
						}),
						snapshot.loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: statusStyle,
							role: "status",
							children: t("pickerLoading")
						}) : snapshot.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							role: "alert",
							children: snapshot.error
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: listStyle,
							children: snapshot.candidates.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: candidateStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: snapshot.picked.has(model.id),
									onChange: () => {
										props.togglePickerModel(model.id);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.id })]
							}) }, model.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: footerStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: outlineButtonStyle,
								onClick: props.closePicker,
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...outlineButtonStyle,
									...snapshot.loading || snapshot.error !== void 0 ? {
										cursor: "not-allowed",
										opacity: .4
									} : {}
								},
								disabled: snapshot.loading || snapshot.error !== void 0,
								onClick: props.adoptPickerModels,
								children: t("applySelected")
							})]
						})
					]
				})]
			}), document.body);
		}
		//#endregion
		//#region src/client/locales.ts
		/** Localized copy for the Grok Plugin configuration card. */
		/** English Grok configuration copy. */
		const en = {
			title: "Grok",
			description: "Sign in with an xAI subscription. This plugin does not use a console API key.",
			expand: "Expand settings",
			collapse: "Collapse settings",
			signedOut: "Not signed in.",
			signedInAs: "Signed in as {email}.",
			signedInNoEmail: "Signed in.",
			signIn: "Sign in with xAI",
			signOut: "Sign out",
			signingIn: "Waiting for browser sign-in…",
			pasteCode: "If the page asks you to copy a code into Grok Build, paste it here.",
			pasteCodeLabel: "Sign-in code",
			pasteCodeSubmit: "Submit code",
			pasteCodeEmpty: "Paste the code from the browser page.",
			signInFailed: "Sign-in did not complete. You can try again.",
			signOutFailed: "Could not sign out. Try again.",
			statusFailed: "Could not read sign-in status.",
			loading: "Loading plugin settings…",
			remoteAccess: "A remote browser cannot edit plugin settings. Open this page on the host, or forward the port.",
			models: "Model catalog",
			summaryModels: "{count} models",
			summaryOn: "Signed in",
			summaryOff: "Not signed in",
			unsaved: "Unsaved changes",
			modelDetails: "Details",
			dragModel: "Drag to reorder",
			fetchModels: "Choose from account",
			fetchingModels: "Loading account models…",
			fetchEmpty: "The account returned no models.",
			addModel: "Add model manually",
			modelId: "Model ID",
			modelName: "Display name",
			thinking: "Reasoning",
			vision: "Vision",
			tools: "Tools",
			defaultEffort: "Default thinking",
			contextWindow: "Context window",
			contextWindowDefault: "500000",
			remove: "Remove",
			inherited: "Showing the default catalog",
			customized: "Custom catalog",
			discard: "Discard",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			invalidModel: "Every model needs a unique ID.",
			requestFailed: "Request failed.",
			pickerTitle: "Choose models",
			pickerDescription: "Pick which account models appear in the conversation selector.",
			pickerLoading: "Loading models…",
			close: "Close",
			cancel: "Cancel",
			applySelected: "Use selected",
			usage: "Subscription usage",
			usageRefresh: "Refresh",
			usageLoading: "Reading usage…",
			usageUsed: "Used",
			usageUnsupported: "This subscription does not report usage.",
			usageFailed: "Could not read usage.",
			usageRefreshFailed: "Refresh failed",
			usageUpdatedAt: "Updated {time}",
			usageResetAt: "Resets {time}",
			usageResetAtDays: "Usage limits reset on {date} ({count} days left)",
			capabilities: "Capabilities",
			enableImageGen: "Enable grok_image_gen tool",
			enableImageGenHelp: "Lets any conversation model draw with Grok Imagine using this SuperGrok login. Distinct from Codex codex_generate_image."
		};
		/** Chinese Grok configuration copy. */
		const zh = {
			title: "Grok",
			description: "使用 xAI 订阅登录。本插件不使用 console API key。",
			expand: "展开设置",
			collapse: "折叠设置",
			signedOut: "尚未登录。",
			signedInAs: "已登录为 {email}。",
			signedInNoEmail: "已登录。",
			signIn: "用 xAI 登录",
			signOut: "退出登录",
			signingIn: "正在等待浏览器登录…",
			pasteCode: "如果页面要你把代码复制到 Grok Build，把它贴到这里。",
			pasteCodeLabel: "登录代码",
			pasteCodeSubmit: "提交代码",
			pasteCodeEmpty: "请粘贴浏览器页面上的代码。",
			signInFailed: "登录未完成。可以重试。",
			signOutFailed: "无法退出登录。请重试。",
			statusFailed: "无法读取登录状态。",
			loading: "正在加载插件设置…",
			remoteAccess: "远程浏览器无法编辑插件设置。请在主机本机打开页面，或先做端口转发。",
			models: "模型目录",
			summaryModels: "{count} 个模型",
			summaryOn: "已登录",
			summaryOff: "未登录",
			unsaved: "未保存的更改",
			modelDetails: "详细设置",
			dragModel: "拖动调整顺序",
			fetchModels: "从账户中选择",
			fetchingModels: "正在加载账户模型…",
			fetchEmpty: "账户没有返回任何模型。",
			addModel: "手动添加模型",
			modelId: "模型 ID",
			modelName: "显示名称",
			thinking: "推理",
			vision: "视觉",
			tools: "工具",
			defaultEffort: "默认思考",
			contextWindow: "上下文窗口",
			contextWindowDefault: "500000",
			remove: "删除",
			inherited: "使用默认目录",
			customized: "自定义目录",
			discard: "放弃",
			save: "保存",
			saving: "正在保存…",
			saved: "已保存",
			invalidModel: "每个模型都需要唯一的 ID。",
			requestFailed: "请求失败。",
			pickerTitle: "选择模型",
			pickerDescription: "选择要在对话选择器里显示的账户模型。",
			pickerLoading: "正在加载模型…",
			close: "关闭",
			cancel: "取消",
			applySelected: "使用所选",
			usage: "订阅额度",
			usageRefresh: "刷新",
			usageLoading: "正在读取额度…",
			usageUsed: "已用",
			usageUnsupported: "此订阅不提供额度信息。",
			usageFailed: "无法读取额度。",
			usageRefreshFailed: "刷新失败",
			usageUpdatedAt: "{time} 已更新",
			usageResetAt: "重置时间：{time}",
			usageResetAtDays: "重置时间：{date}（还剩 {count} 天）",
			capabilities: "能力",
			enableImageGen: "启用 grok_image_gen 工具",
			enableImageGenHelp: "让任意会话模型用本卡的 SuperGrok 登录调用 Grok Imagine 生图。与 Codex 的 codex_generate_image 不同名。"
		};
		//#endregion
		//#region src/client/index.ts
		/** Stable browser-plugin name. */
		const name = "dsh-llm-grok-client";
		/** Client services required by the Plugin configuration contribution. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"settingsScope"
		];
		/** Register localized Grok configuration under Plugin configuration. */
		function apply(ctx) {
			const localeNamespace = "settings.grok";
			ctx.effect(() => ctx.locale.register(localeNamespace, {
				zh,
				en
			}), "dsh-llm-grok: Plugin configuration copy");
			const t = ctx.locale.bind(localeNamespace);
			const scope = ctx.settingsScope.bind({
				namespace: GROK_SETTINGS_NAMESPACE,
				decode: decodeGrokSettings
			});
			const picker = new GrokModelPickerController();
			const { rpc } = ctx.get("connection");
			const startAuth = async () => {
				const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_START_ENDPOINT, {});
				if (!result.ok) return {
					ok: false,
					retryable: true,
					message: result.error.message
				};
				const decoded = decodeGrokAuthStartReply(result.value);
				if (decoded === void 0) return {
					ok: false,
					retryable: true,
					message: t("signInFailed")
				};
				return decoded;
			};
			const completeAuth = async (code) => {
				const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_COMPLETE_ENDPOINT, { code });
				if (!result.ok) return {
					ok: false,
					retryable: true,
					message: result.error.message
				};
				const decoded = decodeGrokAuthStartReply(result.value);
				if (decoded === void 0) return {
					ok: false,
					retryable: true,
					message: t("signInFailed")
				};
				return decoded;
			};
			const readAuthStatus = async () => {
				const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_STATUS_ENDPOINT, {});
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeGrokAuthStatus(result.value);
				if (decoded === void 0) throw new Error(t("statusFailed"));
				return decoded;
			};
			const logout = async () => {
				const result = await rpc.call(GROK_RPC_CHANNEL, GROK_AUTH_LOGOUT_ENDPOINT, {});
				if (!result.ok) throw new Error(result.error.message);
				if (decodeGrokAuthLogoutReply(result.value) === void 0) throw new Error(t("signOutFailed"));
			};
			const fetchModels = async () => {
				const result = await rpc.call(GROK_RPC_CHANNEL, GROK_MODELS_ENDPOINT, {});
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeGrokModelsReply(result.value);
				if (decoded === void 0) throw new Error(t("statusFailed"));
				return decoded.models;
			};
			const fetchUsage = async () => {
				const result = await rpc.call(GROK_RPC_CHANNEL, GROK_USAGE_ENDPOINT, {});
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeGrokUsageReply(result.value);
				if (decoded === void 0) throw new Error(t("usageFailed"));
				return decoded;
			};
			const saveConfiguration = async (settings) => {
				const snapshot = scope.getSnapshot();
				if (snapshot.revision === void 0) throw new Error(t("requestFailed"));
				const saved = await rpc.call(GROK_RPC_CHANNEL, GROK_SAVE_ENDPOINT, {
					models: settings.models,
					enableImageGen: settings.enableImageGen,
					expectedRevision: snapshot.revision
				});
				if (!saved.ok) throw new Error(saved.error.message);
				const accepted = decodeGrokSaveResult(saved.value);
				if (accepted === void 0) throw new Error(t("requestFailed"));
				return accepted;
			};
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "grok-model-picker",
				order: 100,
				inject: () => ({
					t,
					hooks: { grokModelPicker: picker },
					closePicker: picker.close,
					togglePickerModel: picker.toggle,
					adoptPickerModels: picker.adopt
				})
			}, GrokModelPicker));
			ensureProviderSection(ctx);
			ctx.slots.inject("settings.provider.item", () => ctx.slots.register({
				name: "settings.provider.item",
				key: GROK_SETTINGS_NAMESPACE,
				locale: localeNamespace,
				inject: () => ({
					t,
					hooks: { grokSettings: scope },
					startAuth,
					completeAuth,
					readAuthStatus,
					logout,
					fetchUsage,
					fetchModels,
					saveConfiguration,
					beginModelPicker: (initiallyPicked, onAdopt) => {
						picker.begin(onAdopt, initiallyPicked);
					},
					completeModelPicker: (candidates) => {
						picker.complete(candidates);
					},
					failModelPicker: (message) => {
						picker.fail(message);
					},
					closeModelPicker: picker.close
				})
			}, GrokPluginCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
