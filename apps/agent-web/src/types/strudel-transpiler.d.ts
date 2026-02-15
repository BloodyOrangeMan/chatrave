declare module '@strudel/transpiler' {
  export interface TranspilerMeta {
    output: string;
    miniLocations?: unknown[];
    widgets?: unknown[];
    sliders?: unknown[];
    labels?: Array<{ name: string; index: number; end: number; activeVisualizer?: string | null }>;
  }

  export interface TranspilerOptions {
    id?: string;
    [key: string]: unknown;
  }

  export function transpiler(input: string, options?: TranspilerOptions): TranspilerMeta;
}
