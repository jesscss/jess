import type { PluginInterface } from './plugin';
export type ExtendSelectorKind = 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

export const enum MathMode {
  /**
   * @note - A Jess file always performs math for expressions,
   * but that's because expressions are only parsed as such
   * when wrapped with `$()`, whereas Less & SCSS try to
   * parse expressions in regular value sequences.
   */
  ALWAYS = 0,
  PARENS_DIVISION = 1,
  PARENS = 2
}

export const enum UnitMode {
  /** Less's default 1.x-4.x */
  LOOSE = 0,
  /**
   * @todo - I think Less's current strict unit mode is weirder,
   * so this may need another mode depending on behavior. But
   * if it's too weird, it could be a breaking change.
   */
  STRICT = 1
}

export interface StylesConfig {
  compile?: {
    plugins?: PluginInterface[];
    searchPaths?: string[];
    enableJavaScript?: boolean;
    mathMode?: MathMode;
    unitMode?: UnitMode;
    allowExtendSelectors?: ExtendSelectorKind[];
  };
  output?: {
    collapseNesting?: boolean;
    compress?: boolean;
    sourceMap?: boolean;
  };
  language?: {
    less?: LessOptions;
    [key: string]: LessOptions | Record<string, any> | undefined;
    // Future: scss?: ScssOptions, css?: CssOptions, etc.
  };
}

export interface LessOptions {
  allowExtendSelectors?: ExtendSelectorKind[];
  mathMode?: MathMode;
  unitMode?: UnitMode;
  dumpLineNumbers?: string;
  relativeUrls?: boolean;
  compress?: boolean;
  strictMath?: boolean;
  strictUnits?: boolean;
  javascriptEnabled?: boolean;
  sourceMap?: boolean;
  globalVars?: Record<string, any>;
  modifyVars?: Record<string, any>;
  urlArgs?: string;
  rewriteUrls?: boolean;
  rootpath?: string;
  paths?: string[];
  plugin?: any;
  processImports?: boolean;
  syncImport?: boolean;
}
