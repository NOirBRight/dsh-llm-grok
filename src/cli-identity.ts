/**
 * Headers the cli-chat-proxy requires. A missing version is answered 426
 * "Your Grok CLI version (none) is outdated". Verified live: version 1.0.4
 * (or the documented floor 0.1.202) is enough; User-Agent can stay DSH's.
 */

/** Floor the proxy currently advertises in `/v1/settings`. */
export const GROK_CLI_MIN_VERSION = '0.1.202'
/** Version we send. Matches a current Grok CLI release that the proxy accepts. */
export const GROK_CLI_CLIENT_VERSION = '1.0.4'
/** Client identifier the official CLI sends. */
export const GROK_CLI_CLIENT_IDENTIFIER = 'grok-shell'

/** Headers attached to every cli-chat-proxy request this plugin makes. */
export const GROK_CLI_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'x-grok-client-version': GROK_CLI_CLIENT_VERSION,
  'x-grok-client-identifier': GROK_CLI_CLIENT_IDENTIFIER,
})
