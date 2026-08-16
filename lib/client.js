window.__ModuleLoader__.load({
	id: "dsh-llm-grok",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-contract.ts
		/**
		* Source-frozen advisory catalog. V1 does not fetch an account directory;
		* later tickets may append ids to this constant only.
		*/
		const GROK_CATALOG = Object.freeze([Object.freeze({
			id: "grok-4.6",
			thinking: true,
			vision: true
		})]);
		//#endregion
		//#region src/client/GrokPluginCard.tsx
		/** Grok Plugin configuration card: logged-out identity and a read-only catalog. */
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
		const statusStyle = {
			margin: 0,
			fontSize: 13,
			color: "var(--dsw-alias-label-secondary)"
		};
		const buttonStyle = {
			minHeight: 34,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			padding: "6px 14px",
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			cursor: "not-allowed"
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
		/** Render the single-package Grok contribution under Plugin configuration. */
		function GrokPluginCard(props) {
			const { t } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const title = t("title");
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
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: sectionStyle,
						"aria-label": t("signedOut"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: statusStyle,
							children: t("signedOut")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							disabled: true,
							children: t("signIn")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: sectionStyle,
						"aria-label": t("models"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: sectionTitleStyle,
							children: t("models")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: catalogStyle,
							children: GROK_CATALOG.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								"data-model-row": model.id,
								style: modelRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
					})]
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
			signIn: "Sign in with xAI",
			models: "Model catalog",
			thinking: "Reasoning",
			vision: "Vision"
		};
		/** Chinese Grok configuration copy. */
		const zh = {
			title: "Grok",
			description: "使用 xAI 订阅登录。本插件不使用 console API key。",
			expand: "展开设置",
			collapse: "折叠设置",
			signedOut: "尚未登录。",
			signIn: "用 xAI 登录",
			models: "模型目录",
			thinking: "推理",
			vision: "视觉"
		};
		//#endregion
		//#region src/client/index.ts
		/** Stable browser-plugin name. */
		const name = "dsh-llm-grok-client";
		/** Client services required by the Plugin configuration contribution. */
		const inject = ["slots", "locale"];
		/** Register localized Grok configuration under Plugin configuration. */
		function apply(ctx) {
			const localeNamespace = "settings.grok";
			ctx.effect(() => ctx.locale.register(localeNamespace, {
				zh,
				en
			}), "dsh-llm-grok: Plugin configuration copy");
			const t = ctx.locale.bind(localeNamespace);
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "grok",
				order: 40,
				locale: localeNamespace,
				inject: () => ({ t })
			}, GrokPluginCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
