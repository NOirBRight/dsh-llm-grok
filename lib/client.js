window.__ModuleLoader__.load({
	id: "dsh-llm-grok",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-contract.ts
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
		function decodeGrokCatalogModel(value) {
			if (!isRecord(value) || hasTokenFields(value)) return void 0;
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
			if (!isRecord(value) || hasTokenFields(value) || !Array.isArray(value["models"])) return void 0;
			const models = [];
			for (const entry of value["models"]) {
				const model = decodeGrokCatalogModel(entry);
				if (model === void 0) return void 0;
				models.push(model);
			}
			return { models };
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
		//#region src/client/GrokPluginCard.tsx
		/** Grok Plugin configuration card: Host-owned xAI login, usage, and a read-only catalog. */
		const cardStyle = {
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const headerStyle = {
			boxSizing: "border-box",
			width: "100%",
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 16,
			border: 0,
			padding: "13px 14px",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer"
		};
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
		const statusStyle = {
			margin: 0,
			fontSize: 13,
			color: "var(--dsw-alias-label-secondary)"
		};
		const errorStyle = {
			...statusStyle,
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
		const catalogStyle = {
			margin: 0,
			padding: 0,
			listStyle: "none",
			display: "flex",
			flexDirection: "column",
			gap: 8
		};
		const modelRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 10,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			padding: "8px 10px"
		};
		const flagsStyle = {
			display: "flex",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 10
		};
		function formatSignedIn(t, email) {
			if (email === void 0) return t("signedInNoEmail");
			return t("signedInAs").replace("{email}", email);
		}
		function messageOf(error, fallback) {
			return error instanceof Error && error.message.length > 0 ? error.message : fallback;
		}
		/** One quota window: used/limit numbers and a solid meter. */
		function UsageBar({ usedText, window: quota }) {
			const ratio = quota.limit > 0 ? quota.used / quota.limit : quota.used > 0 ? 1 : 0;
			const percent = Math.round(ratio * 1e3) / 10;
			const fill = Math.min(100, Math.max(0, percent));
			const label = quota.period === void 0 ? quota.id : `${quota.id} (${quota.period})`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: labelStyle,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: hintStyle,
						children: quota.unit === "percent" ? `${String(quota.used)}%` : `${usedText} ${String(quota.used)} / ${String(quota.limit)}`
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
				})]
			});
		}
		/** Render the single-package Grok contribution under Plugin configuration. */
		function GrokPluginCard(props) {
			const { t, startAuth, completeAuth, readAuthStatus, logout, fetchUsage, fetchModels } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const [auth, setAuth] = (0, react.useState)({ kind: "signed-out" });
			const [pasteCode, setPasteCode] = (0, react.useState)("");
			const [usage, setUsage] = (0, react.useState)({ status: "idle" });
			const [models, setModels] = (0, react.useState)(GROK_CATALOG);
			const title = t("title");
			const busy = auth.kind === "signing-in";
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
				if (!open) return;
				let cancelled = false;
				readAuthStatus().then((status) => {
					if (cancelled) return;
					if (status.loggedIn) {
						setAuth({
							kind: "signed-in",
							...status.email === void 0 ? {} : { email: status.email }
						});
						fetchModels().then((next) => {
							if (!cancelled && next.length > 0) setModels(next);
						}).catch(() => void 0);
						return;
					}
					setAuth({ kind: "signed-out" });
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
			}, [
				open,
				readAuthStatus,
				t
			]);
			(0, react.useEffect)(() => {
				if (!open || auth.kind !== "signed-in" || usage.status !== "idle") return;
				loadUsage();
			}, [
				open,
				auth.kind,
				usage.status
			]);
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
					setUsage({ status: "idle" });
				} catch {
					setAuth((current) => current.kind === "signed-in" ? current : {
						kind: "signed-out",
						message: t("signOutFailed")
					});
				}
			};
			const statusLabel = auth.kind === "signing-in" ? t("signingIn") : auth.kind === "signed-in" ? formatSignedIn(t, auth.email) : auth.message ?? t("signedOut");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: headerStyle,
					"aria-expanded": open,
					"aria-label": t(open ? "collapse" : "expand") + ": " + title,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							display: "flex",
							minWidth: 0,
							flexDirection: "column",
							gap: 3
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								lineHeight: "20px",
								fontWeight: 600
							},
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 13,
								lineHeight: "18px",
								color: "var(--dsw-alias-label-tertiary)"
							},
							children: t("description")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							fontSize: 18,
							transform: open ? "rotate(180deg)" : "none"
						},
						children: "⌄"
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: bodyStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": statusLabel,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: statusStyle,
								children: statusLabel
							}), auth.kind === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									onSignOut();
								},
								children: t("signOut")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									onSignIn();
								},
								children: t("signIn")
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
							}) : null] })]
						}),
						auth.kind === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": t("usage"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: 10
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: sectionTitleStyle,
										children: t("usage")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle,
										disabled: usage.status === "loading",
										onClick: () => {
											loadUsage();
										},
										children: t(usage.status === "loading" ? "usageLoading" : "usageRefresh")
									})]
								}),
								usage.status === "ready" ? usage.usage.windows.map((window, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageBar, {
									usedText: t("usageUsed"),
									window
								}, `${window.id}:${String(index)}`)) : null,
								usage.status === "unsupported" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: hintStyle,
									children: t("usageUnsupported")
								}) : null,
								usage.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: errorStyle,
									children: usage.message
								}) : null
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: sectionStyle,
							"aria-label": t("models"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: sectionTitleStyle,
								children: t("models")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								style: catalogStyle,
								children: models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									"data-model-row": model.id,
									style: modelRowStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [model.name ?? model.id, model.name !== void 0 && model.name !== model.id ? ` (${model.id})` : ""] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: flagsStyle,
										children: [model.thinking === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: hintStyle,
											children: t("thinking")
										}) : null, model.vision === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: hintStyle,
											children: t("vision")
										}) : null]
									})]
								}, model.id))
							})]
						})
					]
				}) : null]
			});
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
			models: "Model catalog",
			thinking: "Reasoning",
			vision: "Vision",
			usage: "Subscription usage",
			usageRefresh: "Refresh",
			usageLoading: "Reading usage…",
			usageUsed: "Used",
			usageUnsupported: "This subscription does not report usage.",
			usageFailed: "Could not read usage."
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
			models: "模型目录",
			thinking: "推理",
			vision: "视觉",
			usage: "订阅额度",
			usageRefresh: "刷新",
			usageLoading: "正在读取额度…",
			usageUsed: "已用",
			usageUnsupported: "此订阅不提供额度信息。",
			usageFailed: "无法读取额度。"
		};
		//#endregion
		//#region src/client/index.ts
		/** Stable browser-plugin name. */
		const name = "dsh-llm-grok-client";
		/** Client services required by the Plugin configuration contribution. */
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		/** Register localized Grok configuration under Plugin configuration. */
		function apply(ctx) {
			const localeNamespace = "settings.grok";
			ctx.effect(() => ctx.locale.register(localeNamespace, {
				zh,
				en
			}), "dsh-llm-grok: Plugin configuration copy");
			const t = ctx.locale.bind(localeNamespace);
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
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "grok",
				order: 40,
				locale: localeNamespace,
				inject: () => ({
					t,
					startAuth,
					completeAuth,
					readAuthStatus,
					logout,
					fetchUsage,
					fetchModels
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
