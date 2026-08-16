/** Browser half: Grok setup inside Plugin configuration. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { GrokSettingsKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Grok Plugin configuration copy. */
        'settings.grok': GrokSettingsKey;
    }
}
/** Stable browser-plugin name. */
export declare const name = "dsh-llm-grok-client";
/** Client services required by the Plugin configuration contribution. */
export declare const inject: string[];
/** Register localized Grok configuration under Plugin configuration. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map