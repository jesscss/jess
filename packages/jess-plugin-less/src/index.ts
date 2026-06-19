import {
  type Plugin,
  type PluginInterface,
  AbstractPlugin,
  TreeContext,
  JessError,
  logger,
  JsFunction,
  Rules,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type ISafeParseResult,
  type ErrorDiagnostic,
  type WarningDiagnostic
} from '@jesscss/core';
import type { EqualityMode, MathMode, UnitMode, LessOptions } from 'styles-config';
import * as lessFunctions from '@jesscss/fns';
import {
  Parser,
  lessIslandParsePlan,
  lessParserConfigKey,
  lessProfile,
  parseLessStructure,
  registerLessIslandProviders
} from '@jesscss/less-parser';
import {
  IslandParsePlan,
  IslandParserRegistry,
  type LanguageActivation,
  type ParseStructureOptions,
  type StructuralDocument
} from '@jesscss/parser';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandLessImportCandidates } from '@jesscss/style-resolver';

export type ScannerFirstProbeResult = {
  filePath: string;
  sourceBytes: number;
  structuralScanMs: number;
  materializationMs: number;
  totalProbeMs: number;
  structuralDiagnostics: number;
  islands: number;
  requestedIslands: number;
  executedIslands: number;
  islandDiagnostics: number;
  actualParses: number;
  promotedBytes: number;
  cacheHits: number;
  cacheMisses: number;
  fallbackFullTreeMaterializations: number;
  requestsByIslandKind: Record<string, number>;
  requestsByOwnerKind: Record<string, number>;
  availableByIslandKind: Record<string, number>;
  availableByOwnerKind: Record<string, number>;
  structuralNodesByKind: Record<string, number>;
};

export type ScannerFirstProbeOptions = {
  materializeIslandKinds?: readonly string[] | 'all';
};

export type LessPluginOptions = LessOptions & {
  scannerFirstProbe?: boolean | ScannerFirstProbeOptions;
};

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  parser: Parser;
  mathMode: MathMode;
  unitMode: UnitMode;
  equalityMode: EqualityMode;
  leakyRules: boolean;
  bubbleRootAtRules: boolean;
  collapseNesting: boolean;
  scannerFirstProbes: ScannerFirstProbeResult[] = [];
  lastScannerFirstProbe?: ScannerFirstProbeResult;

  constructor(public opts: LessPluginOptions = {}) {
    super();

    // Handle deprecated math option -> mathMode conversion
    let mathMode: MathMode;
    if (opts.mathMode !== undefined) {
      mathMode = opts.mathMode;
    } else if (opts.math !== undefined) {
      // Convert deprecated math option to mathMode
      if (opts.math === 0 || opts.math === 'always') {
        mathMode = 'always';
      } else if (opts.math === 1 || opts.math === 'parens-division') {
        mathMode = 'parens-division';
      } else if (opts.math === 2 || opts.math === 'parens' || opts.math === 'strict') {
        mathMode = 'parens';
      } else {
        // 3 or 'strict-legacy' -> 'parens' (deprecated, use 'strict' instead)
        mathMode = 'parens';
      }
    } else {
      mathMode = 'parens-division';
    }
    this.mathMode = mathMode;

    // Handle deprecated strictUnits option -> unitMode conversion
    let unitMode: UnitMode;
    if (opts.unitMode !== undefined) {
      unitMode = opts.unitMode;
    } else if (opts.strictUnits === true) {
      unitMode = 'strict';
    } else {
      unitMode = 'preserve';
    }
    this.unitMode = unitMode;
    this.equalityMode = opts.equalityMode ?? 'coerce';
    this.leakyRules = opts.leakyRules ?? true;
    this.bubbleRootAtRules = opts.bubbleRootAtRules ?? true;
    this.collapseNesting = opts.collapseNesting ?? false;

    this.parser = new Parser({
      mathMode: this.mathMode,
      leakyRules: this.leakyRules
    });
  }

  /**
   * Describes the structural parser capabilities owned by this plugin.
   *
   * The plugin, not `@jesscss/parser`, binds Less syntax to `.less` files and
   * wires the Less parser instance into island providers. `safeParse` remains
   * the compiler entrypoint; this capability is for staged structural consumers.
   */
  structuralActivation(): LanguageActivation {
    return {
      name: this.name,
      profile: lessProfile,
      supportedExtensions: this.supportedExtensions,
      configureIslandProviders: registry => {
        registerLessIslandProviders(registry, {
          mathMode: this.mathMode,
          leakyRules: this.leakyRules
        }, this.parser);
      }
    };
  }

  /**
   * Runs the shared structural parser with Less profile metadata and file-path
   * preserving source text. This returns structural nodes and raw islands only;
   * it does not build canonical Less/Jess compiler nodes.
   */
  structureParse(filePath: string, source: string, options?: ParseStructureOptions): StructuralDocument {
    return parseLessStructure(filePath, source, options);
  }

  /**
   * Creates a demand-driven island parse plan for Less source.
   *
   * Providers reuse this plugin's parser instance and parser options so JIT
   * materialization observes the same option-sensitive shape as `safeParse`.
   */
  islandParsePlan(filePath: string, source: string, registry = new IslandParserRegistry()): IslandParsePlan {
    return lessIslandParsePlan(filePath, source, {
      mathMode: this.mathMode,
      leakyRules: this.leakyRules
    }, registry, this.parser);
  }

  /**
   * Runs the scanner-first path as an e2e probe before canonical parsing.
   *
   * This hidden/test-only gate proves CSS/Less inputs can be structurally
   * scanned and selectively materialized while the current parser still owns
   * the runtime AST used by eval/render. It records negative evidence too:
   * available islands and requested islands are counted separately so tests can
   * assert that structural-only syntax stayed structural-only.
   */
  runScannerFirstProbe(
    filePath: string,
    source: string,
    options: ScannerFirstProbeOptions = {}
  ): ScannerFirstProbeResult {
    const startedAt = nowMs();
    const configKey = lessParserConfigKey({
      mathMode: this.mathMode,
      leakyRules: this.leakyRules
    });
    const structuralStartedAt = nowMs();
    const plan = this.islandParsePlan(filePath, source);
    const structuralEndedAt = nowMs();
    const availableByIslandKind: Record<string, number> = {};
    const availableByOwnerKind: Record<string, number> = {};
    const requestsByIslandKind: Record<string, number> = {};
    const requestsByOwnerKind: Record<string, number> = {};
    const structuralNodesByKind: Record<string, number> = {};
    let requestedIslands = 0;
    let executedIslands = 0;
    let islandDiagnostics = 0;
    let materializationMs = 0;

    collectStructuralNodeKinds(plan.document.root, structuralNodesByKind);

    for (const island of plan.document.islands()) {
      incrementCounter(availableByIslandKind, island.islandKind);
      incrementCounter(availableByOwnerKind, island.owner.kind);

      if (!shouldMaterializeIsland(island.islandKind, options)) {
        continue;
      }

      const targetShape = lessTargetShapeForIsland(island.islandKind);
      if (!targetShape) {
        continue;
      }

      requestedIslands++;
      incrementCounter(requestsByIslandKind, island.islandKind);
      incrementCounter(requestsByOwnerKind, island.owner.kind);
      const id = plan.requestIsland(island, targetShape, configKey);
      const materializationStartedAt = nowMs();
      const record = plan.execute(id);
      materializationMs += nowMs() - materializationStartedAt;
      executedIslands++;
      islandDiagnostics += record.diagnostics.length;
    }

    const endedAt = nowMs();
    const result: ScannerFirstProbeResult = {
      filePath,
      sourceBytes: source.length,
      structuralScanMs: structuralEndedAt - structuralStartedAt,
      materializationMs,
      totalProbeMs: endedAt - startedAt,
      structuralDiagnostics: plan.document.diagnostics.length,
      islands: plan.document.islands().length,
      requestedIslands,
      executedIslands,
      islandDiagnostics,
      actualParses: plan.counters.actualParses,
      promotedBytes: plan.counters.promotedBytes,
      cacheHits: plan.counters.cacheHits,
      cacheMisses: plan.counters.cacheMisses,
      fallbackFullTreeMaterializations: plan.counters.fallbackFullTreeMaterializations,
      requestsByIslandKind,
      requestsByOwnerKind,
      availableByIslandKind,
      availableByOwnerKind,
      structuralNodesByKind
    };
    this.lastScannerFirstProbe = result;
    this.scannerFirstProbes.push(result);
    return result;
  }

  private _registerFunctions(tree: Rules) {
    const registeredNames: string[] = [];
    for (const [key, value] of Object.entries(lessFunctions)) {
      if (typeof value !== 'function') {
        continue;
      }
      const runtimeName = value.name || key;
      tree.setFunctionBinding(runtimeName, new JsFunction({ name: runtimeName, fn: value }));
      registeredNames.push(runtimeName);
    }
  }

  expandImport(importPath: string, currentDir: string) {
    void currentDir;
    // Keep import expansion in sync with the language service.
    return expandLessImportCandidates(importPath);
  }

  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const mapped = paths.map((candidate) => {
      if (candidate.startsWith('@less/test-import-module/')) {
        const after = candidate.slice('@less/test-import-module/'.length);
        const marker = `${path.sep}packages${path.sep}test-data${path.sep}`;
        const idx = currentDir.indexOf(marker);
        if (idx !== -1) {
          const packagesRoot = currentDir.slice(0, idx + `${path.sep}packages`.length);
          return path.join(packagesRoot, 'test-import-module', after);
        }
      }
      const m = candidate.match(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
      if (m?.[1]) {
        return m[1];
      }
      const mProtocolRelative = candidate.match(/^\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
      if (mProtocolRelative?.[1]) {
        return mProtocolRelative[1];
      }
      return candidate;
    });

    const resolved = super.resolve(mapped, currentDir, searchPaths);
    const out = [...resolved];
    const bases = [currentDir, ...searchPaths, process.cwd()];
    const looksBareSpecifier = (p: string) =>
      !path.isAbsolute(p)
      && !p.startsWith('./')
      && !p.startsWith('../')
      && !p.startsWith('/')
      && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);

    for (const candidate of mapped) {
      if (!looksBareSpecifier(candidate)) {
        continue;
      }
      for (const base of bases) {
        const baseDir = path.isAbsolute(base) ? base : path.resolve(currentDir, base);
        try {
          const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
          const resolvedModule = req.resolve(candidate);
          if (!out.includes(resolvedModule)) {
            out.push(resolvedModule);
          }
          break;
        } catch {
          try {
            const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
            const resolvedModuleLess = req.resolve(`${candidate}.less`);
            if (!out.includes(resolvedModuleLess)) {
              out.push(resolvedModuleLess);
            }
            break;
          } catch {
            // keep trying other base dirs
          }
        }
      }
    }
    return out;
  }

  safeParse(filePath: string, source: string, parseOptions?: { compilerOptions?: Record<string, any> }): ISafeParseResult {
    const scannerFirstProbe = getScannerFirstProbeOptions(
      this.opts.scannerFirstProbe,
      parseOptions?.compilerOptions?.scannerFirstProbe
    );
    const context = new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        source: source
      },
      mathMode: this.mathMode,
      unitMode: this.unitMode,
      equalityMode: this.equalityMode,
      plugin: this,
      allowExtendSelectors: (this.opts as LessOptions & { allowExtendSelectors?: string[] }).allowExtendSelectors,
      collapseNesting: this.collapseNesting,
      leakyRules: this.leakyRules,
      bubbleRootAtRules: this.bubbleRootAtRules
    });

    const errors: ErrorDiagnostic[] = [];
    const warnings: WarningDiagnostic[] = [];
    let tree: Rules | undefined;

    try {
      if (scannerFirstProbe) {
        this.runScannerFirstProbe(filePath, source, scannerFirstProbe);
      }
      const parseResult = this.parser.parse(source, 'stylesheet', { context });
      tree = parseResult.tree;

      // Convert parser deprecation warnings to diagnostics
      if ('warnings' in parseResult && parseResult.warnings) {
        for (const warning of parseResult.warnings) {
          const line = warning.token?.startLine ?? 1;
          const column = warning.token?.startColumn ?? 1;
          warnings.push({
            code: 'parse/deprecated',
            phase: 'parse',
            message: warning.message,
            reason: warning.message,
            fix: 'Update your code to use the recommended syntax.',
            file: context.file,
            filePath: filePath,
            line,
            column,
            lines: extractRelevantLines(source, line)
          });
        }
      }

      // Convert all parser/lexer errors to normalized diagnostics
      if (parseResult.errors.length || parseResult.lexerResult?.errors?.length) {
        // Convert each parser error to a diagnostic
        for (const error of parseResult.errors) {
          const line = error.token?.startLine ?? 1;
          const jessError = getErrorFromParser([error], undefined, filePath, source, { file: context.file });
          const diagnostic = toDiagnostic(jessError);
          // Ensure lines are extracted
          if (!diagnostic.lines) {
            diagnostic.lines = extractRelevantLines(source, line);
          }
          if ('errors' in diagnostic) {
            errors.push(diagnostic);
          } else {
            warnings.push(diagnostic);
          }
        }
        // Convert lexer errors
        if (parseResult.lexerResult?.errors) {
          for (const lexError of parseResult.lexerResult.errors) {
            const line = typeof lexError.line === 'number' ? lexError.line : 1;
            const jessError = getErrorFromParser([], [lexError], filePath, source, { file: context.file });
            const diagnostic = toDiagnostic(jessError);
            // Ensure lines are extracted
            if (!diagnostic.lines) {
              diagnostic.lines = extractRelevantLines(source, line);
            }
            if ('errors' in diagnostic) {
              errors.push(diagnostic);
            } else {
              warnings.push(diagnostic);
            }
          }
        }
      }
    } catch (error: unknown) {
      // Convert caught error to diagnostic
      if (error instanceof JessError) {
        const diagnostic = toDiagnostic(error);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        const message = error instanceof Error ? error.message : 'Unknown parsing error';
        errors.push({
          code: 'internal/unknown',
          phase: 'parse',
          message,
          reason: message || 'An unexpected error occurred during parsing.',
          fix: 'Check the file syntax and ensure it is valid.',
          file: context.file,
          filePath: filePath,
          line: 1,
          column: 1,
          lines: extractRelevantLines(source, 1)
        });
      }
      // Return with errors/warnings only (no tree)
      return { errors, warnings };
    }

    // Only register functions if parsing succeeded without errors
    if (tree && errors.length === 0) {
      this._registerFunctions(tree);
    }

    return {
      tree,
      errors,
      warnings
    };
  }
}

export type { LessOptions } from 'styles-config';

const lessPlugin = ((opts?: LessPluginOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;

function lessTargetShapeForIsland(
  islandKind: string
): 'less-media-prelude' | 'less-mixin' | 'less-selector' | 'less-value' | undefined {
  switch (islandKind) {
    case 'selector':
    case 'extend-candidate':
      return 'less-selector';
    case 'declaration-value':
    case 'variable-reference':
      return 'less-value';
    case 'mixin-definition':
    case 'mixin-call':
      return 'less-mixin';
    case 'at-rule-prelude':
      return 'less-media-prelude';
    default:
      return undefined;
  }
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function collectStructuralNodeKinds(
  node: { kind: string; children?: () => Iterable<{ kind: string }> } | { kind: string; children?: Array<any> },
  counter: Record<string, number>
): void {
  incrementCounter(counter, node.kind);
  const children = typeof node.children === 'function'
    ? [...node.children()]
    : Array.isArray(node.children)
      ? node.children
      : [];
  for (const child of children) {
    collectStructuralNodeKinds(child, counter);
  }
}

function getScannerFirstProbeOptions(
  pluginOption: boolean | ScannerFirstProbeOptions | undefined,
  parseOption: unknown
): ScannerFirstProbeOptions | undefined {
  const option = parseOption ?? pluginOption;
  if (option === true) {
    return {};
  }
  if (option && typeof option === 'object') {
    return option as ScannerFirstProbeOptions;
  }
  return undefined;
}

function shouldMaterializeIsland(
  islandKind: string,
  options: ScannerFirstProbeOptions
): boolean {
  if (options.materializeIslandKinds === 'all') {
    return true;
  }
  return options.materializeIslandKinds?.includes(islandKind) ?? false;
}
