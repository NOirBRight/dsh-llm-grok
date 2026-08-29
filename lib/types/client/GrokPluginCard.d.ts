/** Grok Plugin configuration card: Host-owned xAI login, usage, and an editable displayed catalog. */
import type { ReactNode } from 'react';
import type { SettingsScope } from './shim.js';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { GrokAuthStartReply, GrokAuthAttemptStatus, GrokAuthStatus, GrokCatalogModel, GrokSaveResult, GrokSettingsView, GrokUsageReply } from '../client-contract.ts';
import type { GrokSettingsKey } from './locales.ts';
/** Dependencies injected by the browser-plugin registration. */
export interface GrokPluginCardFace {
    /** Localized card copy. */
    t: (key: GrokSettingsKey) => string;
    hooks: {
        /** Reactive Host-owned settings section. */
        grokSettings: SettingsScope<GrokSettingsView>;
    };
    /** Begin Host PKCE; the browser never receives tokens. */
    startAuth: () => Promise<GrokAuthStartReply>;
    /** Deliver a Grok Build paste-code into the in-flight Host exchange. */
    completeAuth: (code: string, attemptId?: string) => Promise<GrokAuthStartReply>;
    /** Cancel the current Host-owned sign-in attempt. */
    cancelAuth: (attemptId: string) => Promise<void>;
    /** Read secret-free login status. */
    readAuthStatus: () => Promise<GrokAuthStatus>;
    /** Read one secret-free attempt state. */
    readAuthAttemptStatus: (attemptId: string) => Promise<GrokAuthAttemptStatus>;
    /** Delete the Host session. */
    logout: () => Promise<void>;
    /** Read the Host-decoded billing snapshot. Tokens never cross this call. */
    fetchUsage: () => Promise<GrokUsageReply>;
    /** Read the signed-in account catalog (picker candidates, not the displayed set). */
    fetchModels: () => Promise<readonly GrokCatalogModel[]>;
    /** Atomically store the displayed catalog. */
    saveConfiguration: (settings: GrokSettingsView) => Promise<GrokSaveResult>;
    /** Open the frame-level picker immediately with the current selected ids. */
    beginModelPicker: (initiallyPicked: ReadonlySet<string>, onAdopt: (models: readonly GrokCatalogModel[]) => void) => void;
    /** Populate the open picker with account candidates. */
    completeModelPicker: (candidates: readonly GrokCatalogModel[]) => void;
    /** Show a discovery failure in the open picker. */
    failModelPicker: (message: string) => void;
    /** Close a picker whose owning settings card unmounts. */
    closeModelPicker: () => void;
}
/** Props delivered by the Plugin configuration item slot. */
export type GrokPluginCardProps = PropsRuntime<'settings.provider.item'> & InjectFace<GrokPluginCardFace>;
/** Render the single-package Grok contribution under Plugin configuration. */
export declare function GrokPluginCard(props: GrokPluginCardProps): ReactNode;
//# sourceMappingURL=GrokPluginCard.d.ts.map