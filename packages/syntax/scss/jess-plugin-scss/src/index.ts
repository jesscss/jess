import {
  type Plugin,
  AbstractPlugin,
  type ISafeParseResult,
  parserDiagnostic,
  type EqualityMode,
  type UnitMode,
  type Context,
  buildEvaluator
} from '@jesscss/core';
import { makeSassRegistry } from '@jesscss/fns/sass/registry';
import { parse } from '@jesscss/scss-parser';
import { expandScssImportCandidates } from '@jesscss/style-resolver';

export type ScssPluginOptions = {
  allowExtendSelectors?: ExtendSelectorKind[];

  /**
   * Compatibility input retained on this frontend's option object. The shared
   * evaluator reads the resolved Context compile/input option; configuring a
   * Compiler should use `compile.unitMode` or matched input options.
   */
  unitMode?: UnitMode;

  /**
   * Compatibility input retained on this frontend's option object. It does not
   * select a separate SCSS evaluator; configure the shared evaluator through
   * Context compile/input options.
   */
  equalityMode?: EqualityMode;

  /**
   * Whether to collapse nested selectors (flatten nesting during print).
   * This is a Jess output option, not a Sass option.
   */
  collapseNesting?: boolean;
};

type ExtendSelectorKind = 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

const sassValueEvaluator = buildEvaluator(makeSassRegistry());

export class ScssPlugin extends AbstractPlugin {
  name = 'scss';
  supportedExtensions = ['.scss'];
  unitMode: UnitMode;
  equalityMode: EqualityMode;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.unitMode = opts.unitMode ?? 'preserve';
    this.equalityMode = opts.equalityMode ?? 'sass';
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  setContext(context: Context): void {
    if (context.documentContext?.plugin !== this) {
      return;
    }
    if (context.opts.unitMode === undefined) {
      context.setOption('unitMode', this.unitMode);
    }
    if (context.opts.equalityMode === undefined) {
      context.setOption('equalityMode', this.equalityMode);
    }
    context.registerValueEvaluator(sassValueEvaluator);
  }

  safeParse(filePath: string, source: string): ISafeParseResult {
    try {
      return { document: parse(source), errors: [], warnings: [] };
    } catch (error) {
      return {
        errors: [parserDiagnostic({ dialect: 'SCSS', error, filePath, source })],
        warnings: []
      };
    }
  }
}

const scssPlugin = ((opts?: ScssPluginOptions) => new ScssPlugin(opts)) satisfies Plugin;

export default scssPlugin;
