/**
 * Headers the cli-chat-proxy requires. A missing version is answered 426
 * "Your Grok CLI version (none) is outdated". Verified live on 2026-11-09:
 * the proxy now rejects 1.0.4 with 426 "Please update to version 1.0.13 or
 * later via `grok update`"; 1.0.13 is accepted and keeps the wire behavior
 * this plugin was verified against. User-Agent can stay DSH's.
 */
/** Floor the proxy currently advertises in `/v1/settings`. */
export declare const GROK_CLI_MIN_VERSION = "0.1.202";
/** Version we send. Matches a current Grok CLI release that the proxy accepts. */
export declare const GROK_CLI_CLIENT_VERSION = "1.0.13";
/** Client identifier the official CLI sends. */
export declare const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
/** Headers attached to every cli-chat-proxy request this plugin makes. */
export declare const GROK_CLI_REQUEST_HEADERS: Readonly<Record<string, string>>;
//# sourceMappingURL=cli-identity.d.ts.map