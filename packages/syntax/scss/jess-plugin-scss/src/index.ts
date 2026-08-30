import {
  type Plugin,
  AbstractPlugin,
  type ISafeParseResult,
  parserDiagnostic,
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
   * Whether to collapse nested selectors (flatten nesting during print).
   * This is a Jess output option, not a Sass option.
   */
  collapseNesting?: boolean;
};

type ExtendSelectorKind = 'class' | 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

const sassValueEvaluator = buildEvaluator(makeSassRegistry());
type ScssDialectDefaults = Required<Pick<
  NonNullable<ISafeParseResult['dialectDefaults']>,
  'unitMode'
>>;

export class ScssPlugin extends AbstractPlugin {
  name = 'scss';
  supportedExtensions = ['.scss'];
  readonly #dialectDefaults: ScssDialectDefaults;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.#dialectDefaults = Object.freeze({ unitMode: opts.unitMode ?? 'preserve' });
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  setContext(context: Context): void {
    if (context.documentContext?.plugin !== this) {
      return;
    }
    context.registerValueEvaluator(sassValueEvaluator);
  }

  /**
   * No `mathMode` here, deliberately. dart-sass 1.101.0 has no user-settable
   * math policy — the full option surface carries none, and `slash-div` is a
   * DEPRECATION in its registry, not a mode — so SCSS has one fixed behaviour
   * and the grammar states it directly (`cssBaseMathOutsideParens`).
   */
  safeParse(filePath: string, source: string): ISafeParseResult {
    try {
      return {
        document: parse(source),
        dialectDefaults: this.#dialectDefaults,
        errors: [],
        warnings: []
      };
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
