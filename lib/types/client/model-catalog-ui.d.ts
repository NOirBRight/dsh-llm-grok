/** Shared catalog visuals extracted from opencode-go. Small interface hides raw style objects from consumers. */
import type { CSSProperties, ReactNode } from 'react';
export declare const inputStyle: CSSProperties;
export declare const rowInputStyle: CSSProperties;
export declare const selectStyle: CSSProperties;
export declare const rowStyle: CSSProperties;
export declare const capabilitiesStyle: CSSProperties;
export declare const modelContentStyle: CSSProperties;
export declare const modelDetailStyle: CSSProperties;
export declare const fieldStyle: CSSProperties;
export declare const labelStyle: CSSProperties;
/** Small wrapper components that hide raw style objects. */
export declare function CatalogRow({ children }: {
    children: ReactNode;
}): ReactNode;
export declare function CatalogCapabilities({ children }: {
    children: ReactNode;
}): ReactNode;
export declare function CatalogModelDetails({ children, gridColumn }: {
    children: ReactNode;
    gridColumn?: string;
}): ReactNode;
//# sourceMappingURL=model-catalog-ui.d.ts.map