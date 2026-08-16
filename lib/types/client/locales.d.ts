/** Localized copy for the Grok Plugin configuration card. */
/** English Grok configuration copy. */
export declare const en: {
    readonly title: "Grok";
    readonly description: "Sign in with an xAI subscription. This plugin does not use a console API key.";
    readonly expand: "Expand settings";
    readonly collapse: "Collapse settings";
    readonly signedOut: "Not signed in.";
    readonly signedInAs: "Signed in as {email}.";
    readonly signedInNoEmail: "Signed in.";
    readonly signIn: "Sign in with xAI";
    readonly signOut: "Sign out";
    readonly signingIn: "Waiting for browser sign-in…";
    readonly signInFailed: "Sign-in did not complete. You can try again.";
    readonly signOutFailed: "Could not sign out. Try again.";
    readonly statusFailed: "Could not read sign-in status.";
    readonly models: "Model catalog";
    readonly thinking: "Reasoning";
    readonly vision: "Vision";
    readonly usage: "Subscription usage";
    readonly usageRefresh: "Refresh";
    readonly usageLoading: "Reading usage…";
    readonly usageUsed: "Used";
    readonly usageUnsupported: "This subscription does not report usage.";
    readonly usageFailed: "Could not read usage.";
};
/** Locale keys owned by the Grok configuration card. */
export type GrokSettingsKey = keyof typeof en;
/** Chinese Grok configuration copy. */
export declare const zh: Record<GrokSettingsKey, string>;
//# sourceMappingURL=locales.d.ts.map