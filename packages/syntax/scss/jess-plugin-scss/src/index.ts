import {
  type Plugin,
  AbstractPlugin,
  type ISafeParseResult,
  type ModuleConfigRejection,
  type ModuleConfigRequest,
  parserDiagnostic,
  type UnitMode,
  ProvidedModules,
  buildEvaluator,
  recordPluginModule,
  type ValueEvaluator
} from '@jesscss/core';
import { createRequire } from 'node:module';
import { makeSassRegistry } from '@jesscss/fns/sass/registry';
import { SASS_MODULE } from './jess-functions.js';
import { parseRecovering, parseSelector } from '@jesscss/scss-parser';
import { expandScssImportCandidates } from '@jesscss/style-resolver';

export type ScssPluginOptions = {
  allowExtendSelectors?: ExtendSelectorKind[];

  /**
   * Compatibility input retained on this frontend's option object. The shared
   * evaluator reads the resolved Context compile/input option; configuring a
   * Compiler should use `compile.unitMode` or matched input options.
   */
  unitMode?: UnitMode;
};

type ExtendSelectorKind = 'class' | 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

/* A `.scss` `calc()` is a Sass calculation, as dart-sass evaluates it (ledger V32); `selector.parse()` reads a string with the SCSS grammar's own selector list. */
const sassValueEvaluator = buildEvaluator(makeSassRegistry(), { sassCalculations: true, sassOperands: true, parseSelector });

/**
 * `#sass` and `#sass/<module>` are this plugin's private paths to the Sass
 * built-in modules in `@jesscss/fns` (the grammar spells `@use "sass:math"` as
 * `#sass/math`), resolved from THIS package's location. The plugin loads and
 * trusts them (no script runtime); the package spelling reaching the same file
 * is the same module.
 */
const providedModules = new ProvidedModules([
  [SASS_MODULE, '@jesscss/fns/sass'],
  ...['color', 'list', 'map', 'math', 'selector', 'string'].map(name => [`${SASS_MODULE}/${name}`, `@jesscss/fns/sass/${name}`] as const)
], createRequire(import.meta.url));
type ScssDialectDefaults = Required<Pick<
  NonNullable<ISafeParseResult['dialectDefaults']>,
  'unitMode'
>>;

export class ScssPlugin extends AbstractPlugin {
  name = 'scss';
  supportedExtensions = ['.scss'];
  readonly valueEvaluator: ValueEvaluator = sassValueEvaluator;
  readonly #dialectDefaults: ScssDialectDefaults;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.#dialectDefaults = Object.freeze({ unitMode: opts.unitMode ?? 'preserve' });
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    return super.resolve(paths.map(candidate => providedModules.resolve(candidate) ?? candidate), currentDir, searchPaths);
  }

  canImportModule(absoluteFilePath: string): boolean {
    return providedModules.owns(absoluteFilePath);
  }

  import(absoluteFilePath: string): Promise<Record<string, unknown>> {
    return providedModules.import(absoluteFilePath);
  }

  /**
   * No `mathMode` here, deliberately. dart-sass 1.101.0 has no user-settable
   * math policy — the full option surface carries none, and `slash-div` is a
   * DEPRECATION in its registry, not a mode — so SCSS has one fixed behaviour
   * and the grammar states it directly (`cssBaseMathOutsideParens`).
   */
  safeParse(filePath: string, source: string): ISafeParseResult {
    try {
      const { document, recovered } = parseRecovering(source);
      return {
        document,
        dialectDefaults: this.#dialectDefaults,
        errors: recovered.filter(problem => !('severity' in problem)).map(error => parserDiagnostic({ dialect: 'SCSS', error, filePath, source })),
        warnings: recovered.filter(problem => 'severity' in problem).map(warning => parserDiagnostic({ dialect: 'SCSS', error: warning, filePath, source }))
      };
    } catch (error) {
      return {
        errors: [parserDiagnostic({ dialect: 'SCSS', error, filePath, source })],
        warnings: []
      };
    }
  }

  /*
   * An SCSS module variable is configurable only when declared `$x: v !default`
   * (an if-absent write; Sass `@use … with` parity, spec R6 Part E §E.5).
   * Configuring a name not declared `!default` is rejected.
   */
  applyModuleConfig(request: ModuleConfigRequest): ModuleConfigRejection[] {
    const knobs = new Set<string>();
    for (const statement of request.moduleRules) {
      if (statement.type === 'VariableDeclaration' && statement.write.mode === 'if-absent') {
        knobs.add(statement.name);
      }
    }
    const rejected: ModuleConfigRejection[] = [];
    for (const binding of request.bindings) {
      if (!knobs.has(binding.name)) {
        rejected.push({
          name: binding.name,
          message: `Cannot configure "$${binding.name}": an SCSS module variable is configurable only when declared with \`!default\`.`
        });
      }
    }
    return rejected;
  }
}

const scssPlugin = ((opts?: ScssPluginOptions) =>
  recordPluginModule(new ScssPlugin(opts), import.meta.url, 'default', [opts])) satisfies Plugin;

export { jessFunctions } from './jess-functions.js';
export default scssPlugin;
