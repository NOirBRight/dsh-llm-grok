import type { Context } from '@deepseek-ai/cordis';
import type { ModelSwitchAdapterRegistry } from 'dsh-model-switch/adapter-registry';
declare module '@deepseek-ai/cordis' {
    interface Context {
        modelSwitch: {
            readonly adapters: ModelSwitchAdapterRegistry;
        };
    }
}
/** Optional Image-only integration; no Search/Vision registration or standalone behavior changes. */
export declare function installGrokModelSwitchAdapter(ctx: Context, resolveAccessToken: () => Promise<string>): void;
//# sourceMappingURL=model-switch-adapter.d.ts.map