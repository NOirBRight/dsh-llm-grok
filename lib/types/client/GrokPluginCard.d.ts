/** Grok Plugin configuration card: logged-out identity and a read-only catalog. */
import type { ReactNode } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { GrokSettingsKey } from './locales.ts';
/** Dependencies injected by the browser-plugin registration. */
export interface GrokPluginCardFace {
    /** Localized card copy. */
    t: (key: GrokSettingsKey) => string;
}
/** Props delivered by the Plugin configuration item slot. */
export type GrokPluginCardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<GrokPluginCardFace>;
/** Render the single-package Grok contribution under Plugin configuration. */
export declare function GrokPluginCard(props: GrokPluginCardProps): ReactNode;
//# sourceMappingURL=GrokPluginCard.d.ts.map