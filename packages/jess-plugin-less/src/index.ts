import {
  type Plugin,
  AbstractPlugin,
  TreeContext,
  JessError,
  JsFunction,
  Rules,
  Ruleset,
  AtRule,
  AtRuleStatement,
  Declaration,
  ProgressiveVariableDeclaration,
  Node,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type LocationInfo,
  type ISafeParseResult,
  type SafeParseOptions,
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
  countRequestedIslandKinds,
  countRequestedOwnerKinds,
  createStructuralProbeSnapshot,
  structuralDiagnosticRanges,
  type FieldRange,
  type FieldRangeKind,
  type FieldRangeName,
  type LanguageActivation,
  type ParseStructureOptions,
  type RawIslandNode,
  type StructuralContainerNode,
  type StructuralStatementNode
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
  structuralFedPrototype?: boolean;
};

export type LessPluginOptions = LessOptions & {
  scannerFirstProbe?: boolean | ScannerFirstProbeOptions;
};

export type ScannerFirstPrototypeResult = ScannerFirstProbeResult & {
  runtimeTreeSource: 'structural-fed' | 'canonical-fallback';
  fallbackReason?: string;
  /**
   * Cheap progressive core nodes constructed directly from structural fields
   * instead of from canonical island materialization.
   */
  progressiveNodes?: number;
  /**
   * Offset-first structural diagnostics promoted to line/column only for probe
   * reporting. The compiler still owns user-facing diagnostic formatting.
   */
  structuralDiagnosticRanges?: Array<{
    code: string;
    start: number;
    end: number;
    line: number;
    column: number;
  }>;
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
  scannerFirstPrototypeResults: ScannerFirstPrototypeResult[] = [];
  lastScannerFirstPrototype?: ScannerFirstPrototypeResult;

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
   * wires its Less parser instance into island providers. `safeParse` remains
   * the compiler entrypoint; this capability is for staged structural
   * consumers.
   */
  structuralActivation(): LanguageActivation {
    return {
      name: this.name,
      profile: lessProfile,
      supportedExtensions: this.supportedExtensions,
      configureIslandProviders: (registry) => {
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
   * Each island parse receives its own throwaway tree context so sidecar
   * trivia/source-root state cannot leak into the canonical compiler parse.
   */
  islandParsePlan(
    filePath: string,
    source: string,
    registry: IslandParserRegistry = new IslandParserRegistry()
  ): IslandParsePlan {
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
    let requestedIslands = 0;
    let executedIslands = 0;
    let islandDiagnostics = 0;
    let materializationMs = 0;
    const structuralSnapshot = createStructuralProbeSnapshot(filePath, source.length, plan);

    for (const island of plan.document.islands()) {
      if (!shouldMaterializeIsland(island.islandKind, options)) {
        continue;
      }

      const targetShape = lessTargetShapeForIsland(island.islandKind);
      if (!targetShape) {
        continue;
      }

      requestedIslands++;
      const id = plan.requestIsland(island, targetShape, configKey);
      const materializationStartedAt = nowMs();
      const record = plan.execute(id);
      materializationMs += nowMs() - materializationStartedAt;
      executedIslands++;
      islandDiagnostics += record.diagnostics.length;
    }

    const endedAt = nowMs();
    const result: ScannerFirstProbeResult = {
      ...structuralSnapshot,
      structuralScanMs: structuralEndedAt - structuralStartedAt,
      materializationMs,
      totalProbeMs: endedAt - startedAt,
      requestedIslands,
      executedIslands,
      islandDiagnostics,
      actualParses: plan.counters.actualParses,
      promotedBytes: plan.counters.promotedBytes,
      cacheHits: plan.counters.cacheHits,
      cacheMisses: plan.counters.cacheMisses,
      fallbackFullTreeMaterializations: plan.counters.fallbackFullTreeMaterializations,
      requestsByIslandKind: countRequestedIslandKinds(plan),
      requestsByOwnerKind: countRequestedOwnerKinds(plan)
    };
    return this.recordScannerFirstProbe(result);
  }

  /**
   * Attempts the first structural-fed compiler tree for a tiny CSS/Less subset.
   *
   * This is intentionally hidden and conservative. It supports ordinary rules
   * whose bodies contain ordinary declarations and nested ordinary rules.
   * The supported subset stores scanner-native strings plus packed field
   * ranges for simple selectors and simple literal declaration values, then
   * constructs progressive core nodes directly at the compiler boundary.
   * Anything outside that shape records a canonical fallback instead of
   * proving the new path with legacy parser islands.
   */
  runScannerFirstPrototype(
    filePath: string,
    source: string,
    context: TreeContext
  ): { tree?: Rules; result: ScannerFirstPrototypeResult } {
    const startedAt = nowMs();
    const structuralStartedAt = nowMs();
    const plan = this.islandParsePlan(filePath, source);
    const structuralEndedAt = nowMs();
    const structuralSnapshot = createStructuralProbeSnapshot(filePath, source.length, plan);
    const structuralProbe = this.recordScannerFirstProbe({
      ...structuralSnapshot,
      structuralScanMs: structuralEndedAt - structuralStartedAt,
      materializationMs: 0,
      totalProbeMs: structuralEndedAt - startedAt,
      requestedIslands: 0,
      executedIslands: 0,
      islandDiagnostics: 0,
      actualParses: 0,
      promotedBytes: 0,
      cacheHits: 0,
      cacheMisses: 0,
      fallbackFullTreeMaterializations: 0,
      requestsByIslandKind: {},
      requestsByOwnerKind: {}
    });
    const fallback = (reason: string): { result: ScannerFirstPrototypeResult } => {
      plan.counters.fallbackFullTreeMaterializations++;
      const result = this.recordScannerFirstPrototype({
        ...structuralProbe,
        runtimeTreeSource: 'canonical-fallback',
        fallbackReason: reason,
        requestedIslands: plan.counters.requestIds,
        executedIslands: plan.counters.actualParses,
        actualParses: plan.counters.actualParses,
        promotedBytes: plan.counters.promotedBytes,
        cacheHits: plan.counters.cacheHits,
        cacheMisses: plan.counters.cacheMisses,
        fallbackFullTreeMaterializations: plan.counters.fallbackFullTreeMaterializations,
        progressiveNodes: 0,
        materializationMs: nowMs() - startedAt,
        totalProbeMs: nowMs() - startedAt,
        requestsByIslandKind: countRequestedIslandKinds(plan),
        requestsByOwnerKind: countRequestedOwnerKinds(plan),
        structuralDiagnosticRanges: structuralDiagnosticRanges(plan.document)
      });
      return { result };
    };

    if (plan.document.diagnostics.length > 0) {
      return fallback('structural diagnostics are present');
    }
    if (plan.document.trivia.some(trivia => trivia.kind === 'block-comment' || trivia.kind === 'line-comment')) {
      return fallback('comments require canonical trivia preservation');
    }

    const rootVariables = collectStructuralFedScopeVariables(plan.document, plan.document.root.children, new Map());
    const rules: Node[] = [];
    const variables = rootVariables.variables;
    let progressiveNodes = 0;
    const ownerIslands = indexIslandsByOwner(plan.document.islands());

    for (const child of plan.document.root.children) {
      if (
        child.kind !== 'rule'
        && child.kind !== 'at-rule'
        && child.kind !== 'at-rule-statement'
        && child.kind !== 'import'
        && child.kind !== 'variable-declaration'
      ) {
        return fallback(`unsupported root node ${child.kind}`);
      }
      if (child.kind === 'import') {
        const result = buildStructuralFedImportStatement(plan, child, context);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        progressiveNodes += result.progressiveNodes ?? 0;
        continue;
      }
      if (child.kind === 'at-rule-statement') {
        const result = buildStructuralFedAtRuleStatement(plan, child, ownerIslands, context);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        progressiveNodes += result.progressiveNodes ?? 0;
        continue;
      }
      if (child.kind === 'variable-declaration') {
        const eligibilityReason = validateStructuralFedVariableDeclaration(plan.document, child);
        if (eligibilityReason) {
          return fallback(eligibilityReason);
        }
        const result = buildStructuralFedVariableDeclaration(plan, child, ownerIslands, context);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        variables.set(result.name, result.valueToken);
        rules.push(result.node);
        progressiveNodes += result.progressiveNodes;
        continue;
      }
      if (child.kind === 'at-rule') {
        const eligibilityReason = validateStructuralFedAtRule(plan.document, child, variables, 'root', this.mathMode);
        if (eligibilityReason) {
          return fallback(eligibilityReason);
        }
        const result = buildStructuralFedAtRule(plan, child, ownerIslands, context, variables, 'root', this.mathMode);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        progressiveNodes += result.progressiveNodes ?? 0;
        continue;
      }
      const eligibilityReason = validateStructuralFedRule(plan.document, child, variables, true, true, this.mathMode);
      if (eligibilityReason) {
        return fallback(eligibilityReason);
      }
      const result = buildStructuralFedRuleset(plan, child, ownerIslands, context, variables, true, true, this.mathMode);
      if ('reason' in result) {
        return fallback(result.reason);
      }
      rules.push(result.node);
      progressiveNodes += result.progressiveNodes ?? 0;
    }

    const tree = new Rules(
      rules,
      undefined,
      locationFromRange(plan.document, 0, plan.document.source.length),
      context
    );
    const materializationMs = nowMs() - startedAt;
    const result = this.recordScannerFirstPrototype({
      ...structuralProbe,
      runtimeTreeSource: 'structural-fed',
      requestedIslands: plan.counters.requestIds,
      executedIslands: plan.counters.actualParses,
      actualParses: plan.counters.actualParses,
      promotedBytes: plan.counters.promotedBytes,
      cacheHits: plan.counters.cacheHits,
      cacheMisses: plan.counters.cacheMisses,
      fallbackFullTreeMaterializations: plan.counters.fallbackFullTreeMaterializations,
      progressiveNodes,
      requestsByIslandKind: countRequestedIslandKinds(plan),
      requestsByOwnerKind: countRequestedOwnerKinds(plan),
      materializationMs,
      totalProbeMs: nowMs() - startedAt
    });
    return { tree, result };
  }

  private recordScannerFirstProbe(result: ScannerFirstProbeResult): ScannerFirstProbeResult {
    this.lastScannerFirstProbe = result;
    this.scannerFirstProbes.push(result);
    return result;
  }

  private recordScannerFirstPrototype(result: ScannerFirstPrototypeResult): ScannerFirstPrototypeResult {
    this.lastScannerFirstPrototype = result;
    this.scannerFirstPrototypeResults.push(result);
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

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
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
        if (
          scannerFirstProbe.structuralFedPrototype
          && !shouldSkipStructuralFedPrototype(parseOptions)
        ) {
          const prototype = this.runScannerFirstPrototype(filePath, source, context);
          tree = prototype.tree;
        } else {
          this.runScannerFirstProbe(filePath, source, scannerFirstProbe);
        }
      }
      if (!tree) {
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

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
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

function shouldSkipStructuralFedPrototype(parseOptions: SafeParseOptions | undefined): boolean {
  const importOptions = parseOptions?.importOptions;
  return (
    importOptions?.reference === true
    || importOptions?._dedupe === true
    || importOptions?.multiple === true
  );
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

function indexIslandsByOwner(islands: readonly RawIslandNode[]): Map<object, RawIslandNode[]> {
  const byOwner = new Map<object, RawIslandNode[]>();
  for (const island of islands) {
    const list = byOwner.get(island.owner);
    if (list) {
      list.push(island);
    } else {
      byOwner.set(island.owner, [island]);
    }
  }
  return byOwner;
}

function singleIsland(
  byOwner: Map<object, RawIslandNode[]>,
  owner: object,
  islandKind: string
): RawIslandNode | undefined {
  let match: RawIslandNode | undefined;
  for (const island of byOwner.get(owner) ?? []) {
    if (island.islandKind !== islandKind) {
      continue;
    }
    if (match) {
      return undefined;
    }
    match = island;
  }
  return match;
}

type StructuralFedBuildResult =
  | { node: Node; progressiveNodes?: number }
  | { reason: string };

type StructuralFedVariableBuildResult =
  | { node: ProgressiveVariableDeclaration; name: string; valueToken: ScannerNativeValueToken; progressiveNodes: 1 }
  | { reason: string };

function validateStructuralFedRule(
  document: StructuralDocument,
  rule: StructuralContainerNode,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  allowLessVariables = true,
  allowAtRules = true,
  mathMode: MathMode = 'parens-division'
): string | undefined {
  const { variables: localVariables } = collectStructuralFedScopeVariables(document, rule.children, variables);
  for (const child of rule.children) {
    if (child.kind === 'rule') {
      const nestedReason = validateStructuralFedRule(document, child, localVariables, allowLessVariables, allowAtRules, mathMode);
      if (nestedReason) {
        return nestedReason;
      }
      continue;
    }
    if (child.kind === 'variable-declaration') {
      if (!allowLessVariables) {
        return 'Less variable declarations are not in this structural-fed subset';
      }
      const variableReason = validateStructuralFedVariableDeclaration(document, child);
      if (variableReason) {
        return variableReason;
      }
      const name = structuralFieldText(document, child, 'name', 'declaration-name')!;
      const valueToken = structuralScannerNativeVariableDeclarationValueToken(document, child);
      if (!valueToken) {
        return 'variable declaration value is outside the scanner-native structural-fed subset';
      }
      localVariables.set(name, valueToken);
      continue;
    }
    if (child.kind === 'at-rule') {
      if (!allowAtRules) {
        return `unsupported rule child ${child.kind}`;
      }
      const atRuleReason = validateStructuralFedAtRule(document, child, localVariables, 'rule', mathMode);
      if (atRuleReason) {
        return atRuleReason;
      }
      continue;
    }
    if (child.kind !== 'declaration') {
      return `unsupported rule child ${child.kind}`;
    }

    const declarationReason = validateStructuralFedDeclaration(document, child, localVariables, allowLessVariables, mathMode);
    if (declarationReason) {
      return declarationReason;
    }
  }
  return undefined;
}

function validateStructuralFedAtRule(
  document: StructuralDocument,
  atRule: StructuralContainerNode,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  parentKind: 'root' | 'rule' | 'at-rule',
  mathMode: MathMode = 'parens-division'
): string | undefined {
  const name = structuralFieldText(document, atRule, 'name', 'at-rule-name');
  if (name !== '@media' && name !== '@layer' && name !== '@supports') {
    return 'only @media, @supports, and root @layer block at-rules are in the progressive structural-fed subset';
  }
  if ((name === '@layer' || name === '@supports') && parentKind !== 'root') {
    return 'only root @layer and @supports block at-rules are in the progressive structural-fed subset';
  }
  const prelude = structuralFieldText(document, atRule, 'prelude', 'prelude');
  if (prelude === undefined && name !== '@layer') {
    return 'at-rule prelude is outside the scanner-native structural-fed subset';
  }
  if (prelude !== undefined && MULTILINE_VALUE_PATTERN.test(prelude)) {
    return 'multiline at-rule preludes are not in the progressive structural-fed subset';
  }
  if (prelude !== undefined && !isScannerNativeAtRulePrelude(name, prelude)) {
    return 'at-rule prelude is outside the scanner-native structural-fed subset';
  }
  for (const child of atRule.children) {
    if (child.kind === 'rule') {
      if (parentKind !== 'root' && name !== '@media') {
        return `unsupported at-rule child ${child.kind}`;
      }
      const reason = validateStructuralFedRule(
        document,
        child,
        variables,
        parentKind === 'root' && name !== '@layer',
        parentKind === 'root',
        mathMode
      );
      if (reason) {
        return reason;
      }
      continue;
    }
    if (parentKind === 'root' || child.kind !== 'declaration') {
      return `unsupported at-rule child ${child.kind}`;
    }
    const declarationReason = validateStructuralFedDeclaration(document, child, variables, true, mathMode);
    if (declarationReason) {
      return declarationReason;
    }
  }
  return undefined;
}

function buildStructuralFedRuleset(
  plan: IslandParsePlan,
  rule: StructuralContainerNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  allowLessVariables = true,
  allowAtRules = true,
  mathMode: MathMode = 'parens-division'
): StructuralFedBuildResult {
  const selectorIsland = singleIsland(ownerIslands, rule, 'selector');
  const selectorText = structuralFieldText(plan.document, rule, 'selector', 'selector');
  const scopeOnly = selectorText === '&' || selectorText === '';
  const selectorToken = readScannerNativeSelectorToken(plan, rule, selectorIsland);
  if (!selectorToken && !scopeOnly) {
    return { reason: 'selector is outside the scanner-native structural-fed subset' };
  }

  const rules: Node[] = [];
  const { variables: localVariables } = collectStructuralFedScopeVariables(plan.document, rule.children, variables);
  let progressiveNodes = 1;
  for (const child of rule.children) {
    const builtChild = buildStructuralFedRuleChild(
      plan,
      child,
      ownerIslands,
      context,
      'rule',
      localVariables,
      allowLessVariables,
      allowAtRules,
      mathMode
    );
    if ('reason' in builtChild) {
      return builtChild;
    }
    if ('name' in builtChild) {
      localVariables.set(builtChild.name, builtChild.valueToken);
    }
    rules.push(builtChild.node);
    progressiveNodes += builtChild.progressiveNodes ?? 0;
  }

  if (scopeOnly) {
    return {
      node: new Rules(
        rules,
        undefined,
        locationFromRange(plan.document, rule.start, rule.end),
        context
      ),
      progressiveNodes
    };
  }

  return {
    node: new Ruleset({
      selector: selectorToken!.text,
      rules
    }, undefined, locationFromRange(plan.document, rule.start, rule.end), context),
    progressiveNodes
  };
}

function collectStructuralFedScopeVariables(
  document: StructuralDocument,
  children: readonly StructuralContainerNode['children'][number][],
  inheritedVariables: ReadonlyMap<string, ScannerNativeValueToken>
): { variables: Map<string, ScannerNativeValueToken> } {
  const variables = new Map(inheritedVariables);
  for (const child of children) {
    if (child.kind !== 'variable-declaration') {
      continue;
    }
    const name = structuralFieldText(document, child, 'name', 'declaration-name');
    const valueToken = structuralScannerNativeVariableDeclarationValueToken(document, child);
    if (name !== undefined && SIMPLE_VARIABLE_NAME_PATTERN.test(name) && valueToken) {
      variables.set(name, valueToken);
    }
  }
  return { variables };
}

function buildStructuralFedAtRule(
  plan: IslandParsePlan,
  atRule: StructuralContainerNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  parentKind: 'root' | 'rule' | 'at-rule',
  mathMode: MathMode = 'parens-division'
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, atRule, 'name', 'at-rule-name');
  if (name !== '@media' && name !== '@layer' && name !== '@supports') {
    return { reason: 'only @media, @supports, and root @layer block at-rules are in the progressive structural-fed subset' };
  }
  if ((name === '@layer' || name === '@supports') && parentKind !== 'root') {
    return { reason: 'only root @layer and @supports block at-rules are in the progressive structural-fed subset' };
  }
  const preludeIsland = singleIsland(ownerIslands, atRule, 'at-rule-prelude');
  if (!preludeIsland && name !== '@layer') {
    return { reason: 'at-rule prelude island missing' };
  }
  const preludeToken = preludeIsland
    ? readScannerNativeAtRulePreludeToken(plan, atRule, preludeIsland, name)
    : undefined;
  if (!preludeToken && preludeIsland) {
    return { reason: 'at-rule prelude is outside the scanner-native structural-fed subset' };
  }
  if (name === '@layer' && preludeToken && preludeToken.kind !== 'identifier') {
    return { reason: 'root @layer prelude is outside the scanner-native structural-fed subset' };
  }

  const rules: Node[] = [];
  let progressiveNodes = 1;
  for (const child of atRule.children) {
    if (child.kind === 'rule') {
      if (parentKind !== 'root' && name !== '@media') {
        return { reason: `unsupported at-rule child ${child.kind}` };
      }
      const builtChild = buildStructuralFedRuleset(
        plan,
        child,
        ownerIslands,
        context,
        variables,
        parentKind === 'root' && name !== '@layer',
        parentKind === 'root',
        mathMode
      );
      if ('reason' in builtChild) {
        return builtChild;
      }
      rules.push(builtChild.node);
      progressiveNodes += builtChild.progressiveNodes ?? 0;
      continue;
    }
    if (parentKind === 'root' || child.kind !== 'declaration') {
      return { reason: `unsupported at-rule child ${child.kind}` };
    }
    const builtChild = buildStructuralFedDeclaration(plan, child, ownerIslands, context, variables, true, mathMode);
    if ('reason' in builtChild) {
      return builtChild;
    }
    rules.push(builtChild.node);
    progressiveNodes += builtChild.progressiveNodes ?? 0;
  }

  return {
    node: new AtRule({
      name,
      prelude: preludeToken?.text,
      rules
    }, undefined, locationFromRange(plan.document, atRule.start, atRule.end), context),
    progressiveNodes
  };
}

function buildStructuralFedRuleChild(
  plan: IslandParsePlan,
  child: StructuralContainerNode['children'][number],
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext,
  parentKind: 'at-rule' | 'rule',
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  allowLessVariables = true,
  allowAtRules = true,
  mathMode: MathMode = 'parens-division'
): StructuralFedBuildResult | StructuralFedVariableBuildResult {
  if (child.kind === 'rule') {
    return buildStructuralFedRuleset(plan, child, ownerIslands, context, variables, allowLessVariables, allowAtRules, mathMode);
  }
  if (child.kind === 'at-rule') {
    if (!allowAtRules) {
      return { reason: `unsupported ${parentKind} child ${child.kind}` };
    }
    if (parentKind === 'at-rule') {
      return { reason: `unsupported ${parentKind} child ${child.kind}` };
    }
    return buildStructuralFedAtRule(plan, child, ownerIslands, context, variables, parentKind, mathMode);
  }
  if (child.kind === 'variable-declaration') {
    if (!allowLessVariables) {
      return { reason: 'Less variable declarations are not in this structural-fed subset' };
    }
    return buildStructuralFedVariableDeclaration(plan, child, ownerIslands, context);
  }
  if (child.kind === 'declaration') {
    return buildStructuralFedDeclaration(plan, child, ownerIslands, context, variables, allowLessVariables, mathMode);
  }
  return { reason: `unsupported ${parentKind} child ${child.kind}` };
}

function buildStructuralFedAtRuleStatement(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, child, 'name', 'at-rule-name');
  if (name !== '@charset') {
    return { reason: 'only @charset statement at-rules are in the scanner-native structural-fed subset' };
  }
  const preludeIsland = singleIsland(ownerIslands, child, 'at-rule-prelude');
  if (!preludeIsland) {
    return { reason: 'at-rule statement prelude island missing' };
  }
  const prelude = structuralFieldText(plan.document, child, 'prelude', 'prelude');
  if (!prelude || !RAW_QUOTED_STRING_PATTERN.test(prelude)) {
    return { reason: 'at-rule statement prelude is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new AtRuleStatement({
      name,
      prelude
    }, undefined, locationFromRange(plan.document, child.start, child.end), context),
    progressiveNodes: 1
  };
}

function buildStructuralFedImportStatement(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  context: TreeContext
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, child, 'name', 'import-name');
  if (name !== '@import') {
    return { reason: 'import statement metadata is missing from structural field table' };
  }
  const prelude = structuralFieldText(plan.document, child, 'prelude', 'prelude');
  if (!prelude || !isScannerNativeCssImportPrelude(prelude)) {
    return { reason: 'import statement prelude is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new AtRuleStatement({
      name,
      prelude
    }, undefined, locationFromRange(plan.document, child.start, child.end), context),
    progressiveNodes: 1
  };
}

function validateStructuralFedDeclaration(
  document: StructuralDocument,
  child: StructuralStatementNode,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  allowLessVariableReferences = true,
  mathMode: MathMode = 'parens-division'
): string | undefined {
  const name = structuralFieldText(document, child, 'name', 'declaration-name');
  const valueText = structuralFieldText(document, child, 'value', 'value');
  if (name === undefined || valueText === undefined) {
    return 'declaration metadata is missing from structural field table';
  }
  const assignmentText = document.source.slice(child.nameEnd, child.valueStart);
  if (!isPlainStructuralFedDeclarationName(name)) {
    return 'declaration name is outside the first structural-fed subset';
  }
  if (!PLAIN_ASSIGNMENT_PATTERN.test(assignmentText)) {
    return 'declaration assignment is outside the first structural-fed subset';
  }
  if (MULTILINE_VALUE_PATTERN.test(valueText)) {
    return 'multiline declaration values are not in the first structural-fed subset';
  }
  if (isCustomPropertyName(name)) {
    if (IMPORTANT_FLAG_PATTERN.test(valueText)) {
      return 'custom property important values are not in the scanner-native structural-fed subset';
    }
    if (CUSTOM_PROPERTY_LESS_VARIABLE_LIKE_PATTERN.test(valueText)) {
      return 'custom property values with Less variable-like tokens are not in the scanner-native structural-fed subset';
    }
    return undefined;
  }
  const valueParts = splitScannerNativeDeclarationImportant(valueText);
  if (IMPORTANT_FLAG_PATTERN.test(valueText) && !valueParts) {
    return 'important declarations are not in the first structural-fed subset';
  }
  if (valueParts?.important && looksLikeSimpleVariableReference(valueParts.valueText)) {
    return 'important declarations with Less variable references are not in the scanner-native structural-fed subset';
  }
  const scannerNativeValueText = valueParts?.valueText ?? valueText;
  if (supportsScannerNativeArithmetic(mathMode) && resolveScannerNativeArithmeticValue(scannerNativeValueText, variables)) {
    return undefined;
  }
  if (!looksLikeSimpleVariableReference(valueText) && RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(valueText)) {
    return 'raw declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset';
  }
  if (
    !valueParts
    && isConservativeRawScannerNativeValue(scannerNativeValueText)
    && !RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(scannerNativeValueText)
  ) {
    return undefined;
  }
  if (looksLikeSimpleVariableReference(scannerNativeValueText) && !allowLessVariableReferences) {
    return 'Less variable references are not in this structural-fed subset';
  }
  if (looksLikeSimpleVariableReference(scannerNativeValueText) && !variables.has(scannerNativeValueText)) {
    return 'Less variable reference is outside the scanner-native structural-fed subset';
  }
  return undefined;
}

function buildStructuralFedDeclaration(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  allowLessVariableReferences = true,
  mathMode: MathMode = 'parens-division'
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, child, 'name', 'declaration-name');
  if (name === undefined) {
    return { reason: 'declaration metadata is missing from structural field table' };
  }
  const valueIsland = singleIsland(ownerIslands, child, 'declaration-value');
  if (!valueIsland) {
    return { reason: 'declaration value island missing' };
  }
  const valueToken = readScannerNativeDeclarationValueToken(plan, child, valueIsland, variables, allowLessVariableReferences, mathMode);
  if (!valueToken) {
    return { reason: 'declaration value is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new Declaration({
      name,
      value: [valueToken.text],
      important: valueToken.important
    }, undefined, locationFromRange(plan.document, child.start, child.end), context),
    progressiveNodes: 1
  };
}

function validateStructuralFedVariableDeclaration(
  document: StructuralDocument,
  child: StructuralStatementNode
): string | undefined {
  const name = structuralFieldText(document, child, 'name', 'declaration-name');
  const valueText = structuralFieldText(document, child, 'value', 'value');
  if (name === undefined || valueText === undefined) {
    return 'variable declaration metadata is missing from structural field table';
  }
  if (!SIMPLE_VARIABLE_NAME_PATTERN.test(name)) {
    return 'variable declaration name is outside the scanner-native structural-fed subset';
  }
  if (MULTILINE_VALUE_PATTERN.test(valueText)) {
    return 'multiline variable declarations are not in the scanner-native structural-fed subset';
  }
  if (IMPORTANT_FLAG_PATTERN.test(valueText)) {
    return 'important variable declarations are not in the scanner-native structural-fed subset';
  }
  if (looksLikeSimpleVariableReference(valueText)) {
    return 'Less variable declaration reference is outside the scanner-native structural-fed subset';
  }
  if (
    !SIMPLE_LITERAL_VALUE_PATTERN.test(valueText)
    && !isConservativeRawScannerNativeValue(valueText)
  ) {
    return 'variable declaration value is outside the scanner-native structural-fed subset';
  }
  return undefined;
}

function buildStructuralFedVariableDeclaration(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext
): StructuralFedVariableBuildResult {
  const name = structuralFieldText(plan.document, child, 'name', 'declaration-name');
  if (name === undefined) {
    return { reason: 'variable declaration metadata is missing from structural field table' };
  }
  if (!SIMPLE_VARIABLE_NAME_PATTERN.test(name)) {
    return { reason: 'variable declaration name is outside the scanner-native structural-fed subset' };
  }
  const valueIsland = singleIsland(ownerIslands, child, 'declaration-value');
  if (!valueIsland) {
    return { reason: 'variable declaration value island missing' };
  }
  const valueToken = readScannerNativeVariableDeclarationValueToken(plan, child, valueIsland);
  if (!valueToken) {
    return { reason: 'variable declaration value is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new ProgressiveVariableDeclaration({
      name,
      value: [valueToken.text]
    }, undefined, locationFromRange(plan.document, child.start, child.end), context),
    name,
    valueToken,
    progressiveNodes: 1
  };
}

function readScannerNativeVariableDeclarationValueToken(
  plan: IslandParsePlan,
  owner: StructuralStatementNode,
  island: RawIslandNode
): ScannerNativeValueToken | undefined {
  const range = structuralFieldRange(plan.document, owner, 'value', 'value');
  if (!range || range.start !== island.start || range.end !== island.end) {
    return undefined;
  }
  return structuralScannerNativeVariableDeclarationValueToken(plan.document, owner);
}

function structuralScannerNativeVariableDeclarationValueToken(
  document: StructuralDocument,
  owner: StructuralStatementNode
): ScannerNativeValueToken | undefined {
  const range = structuralFieldRange(document, owner, 'value', 'value');
  if (!range) {
    return undefined;
  }
  const valueText = document.source.text.slice(range.start, range.end);
  const literalMatch = SIMPLE_LITERAL_VALUE_PATTERN.exec(valueText);
  if (literalMatch) {
    return scannerNativeLiteralValueTokenFromMatch(valueText, range.start, range.end, literalMatch);
  }
  if (!isConservativeRawScannerNativeValue(valueText)) {
    return undefined;
  }
  return {
    kind: 'raw-value',
    start: range.start,
    end: range.end,
    text: valueText
  };
}

type ScannerNativeSelectorToken = {
  kind: 'selector';
  start: number;
  end: number;
  text: string;
};

type ScannerNativeValueToken = {
  kind:
    | 'hex-color'
    | 'dimension-or-number'
    | 'identifier'
    | 'flat-literal-list'
    | 'custom-property-raw'
    | 'raw-value'
    | 'raw-at-rule-prelude';
  start: number;
  end: number;
  text: string;
  important?: string;
};

function readScannerNativeSelectorToken(
  plan: IslandParsePlan,
  owner: StructuralContainerNode,
  island?: RawIslandNode
): ScannerNativeSelectorToken | undefined {
  const range = structuralFieldRange(plan.document, owner, 'selector', 'selector');
  if (!range || (island && (range.start !== island.start || range.end !== island.end))) {
    return undefined;
  }
  const selectorText = plan.document.source.text.slice(range.start, range.end);
  if (!SCANNER_NATIVE_SELECTOR_PATTERN.test(selectorText)) {
    return undefined;
  }
  return {
    kind: 'selector',
    start: range.start,
    end: range.end,
    text: selectorText
  };
}

function readScannerNativeAtRulePreludeToken(
  plan: IslandParsePlan,
  owner: StructuralContainerNode,
  island: RawIslandNode,
  atRuleName: string
): ScannerNativeValueToken | undefined {
  const range = structuralFieldRange(plan.document, owner, 'prelude', 'prelude');
  if (!range || range.start !== island.start || range.end !== island.end) {
    return undefined;
  }
  const preludeText = plan.document.source.text.slice(range.start, range.end);
  if (!isScannerNativeAtRulePrelude(atRuleName, preludeText)) {
    return undefined;
  }
  const literalMatch = SIMPLE_LITERAL_VALUE_PATTERN.exec(preludeText);
  if (literalMatch) {
    return scannerNativeLiteralValueTokenFromMatch(preludeText, range.start, range.end, literalMatch);
  }
  return {
    kind: 'raw-at-rule-prelude',
    start: range.start,
    end: range.end,
    text: preludeText
  };
}

function readScannerNativeDeclarationValueToken(
  plan: IslandParsePlan,
  owner: StructuralStatementNode,
  island: RawIslandNode,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  allowLessVariableReferences = true,
  mathMode: MathMode = 'parens-division'
): ScannerNativeValueToken | undefined {
  const range = structuralFieldRange(plan.document, owner, 'value', 'value');
  if (!range || range.start !== island.start || range.end !== island.end) {
    return undefined;
  }
  const valueText = plan.document.source.text.slice(range.start, range.end);
  const valueParts = splitScannerNativeDeclarationImportant(valueText);
  if (valueParts?.important && looksLikeSimpleVariableReference(valueParts.valueText)) {
    return undefined;
  }
  const scannerNativeValueText = valueParts?.valueText ?? valueText;
  const arithmeticValue = supportsScannerNativeArithmetic(mathMode)
    ? resolveScannerNativeArithmeticValue(scannerNativeValueText, variables)
    : undefined;
  if (arithmeticValue) {
    return {
      kind: 'dimension-or-number',
      start: range.start,
      end: range.end,
      text: arithmeticValue,
      important: valueParts?.important
    };
  }
  if (looksLikeSimpleVariableReference(valueText)) {
    if (!allowLessVariableReferences) {
      return undefined;
    }
    const variable = variables.get(valueText);
    return variable
      ? {
          ...variable,
          start: range.start,
          end: range.end
        }
      : undefined;
  }
  return structuralScannerNativeDeclarationValueToken(plan.document, owner);
}

function resolveScannerNativeArithmeticValue(
  valueText: string,
  variables: ReadonlyMap<string, ScannerNativeValueToken>
): string | undefined {
  const match = SCANNER_NATIVE_BINARY_ARITHMETIC_PATTERN.exec(valueText);
  if (!match?.groups) {
    return undefined;
  }
  const left = scannerNativeArithmeticOperand(match.groups.left, variables);
  const right = scannerNativeArithmeticOperand(match.groups.right, variables);
  const operator = match.groups.operator;
  if (!left || !right || (operator !== '+' && operator !== '-')) {
    return undefined;
  }
  if (left.unit !== right.unit) {
    return undefined;
  }
  const result = operator === '+'
    ? left.value + right.value
    : left.value - right.value;
  return `${formatScannerNativeNumber(result)}${left.unit}`;
}

function supportsScannerNativeArithmetic(mathMode: MathMode): boolean {
  return mathMode === 'always' || mathMode === 'parens-division';
}

function scannerNativeArithmeticOperand(
  text: string | undefined,
  variables: ReadonlyMap<string, ScannerNativeValueToken>
): { value: number; unit: string } | undefined {
  if (text === undefined) {
    return undefined;
  }
  const variable = looksLikeSimpleVariableReference(text) ? variables.get(text) : undefined;
  const operandText = variable?.text ?? text;
  if (variable && variable.kind !== 'dimension-or-number') {
    return undefined;
  }
  const match = SCANNER_NATIVE_NUMBER_WITH_UNIT_PATTERN.exec(operandText);
  if (!match?.groups) {
    return undefined;
  }
  const value = Number(match.groups.value);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return {
    value,
    unit: match.groups.unit ?? ''
  };
}

function formatScannerNativeNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)));
}

function structuralScannerNativeDeclarationValueToken(
  document: StructuralDocument,
  owner: StructuralStatementNode
): ScannerNativeValueToken | undefined {
  const range = structuralFieldRange(document, owner, 'value', 'value');
  if (!range) {
    return undefined;
  }
  const valueText = document.source.text.slice(range.start, range.end);
  const name = structuralFieldText(document, owner, 'name', 'declaration-name');
  if (name !== undefined && isCustomPropertyName(name)) {
    if (
      MULTILINE_VALUE_PATTERN.test(valueText)
      || IMPORTANT_FLAG_PATTERN.test(valueText)
      || CUSTOM_PROPERTY_LESS_VARIABLE_LIKE_PATTERN.test(valueText)
    ) {
      return undefined;
    }
    return {
      kind: 'custom-property-raw',
      start: range.start,
      end: range.end,
      text: valueText
    };
  }
  const valueParts = splitScannerNativeDeclarationImportant(valueText);
  const scannerNativeValueText = valueParts?.valueText ?? valueText;
  const tokenEnd = valueParts ? range.start + valueParts.valueLength : range.end;
  const literalMatch = SIMPLE_LITERAL_VALUE_PATTERN.exec(scannerNativeValueText);
  if (literalMatch) {
    return scannerNativeLiteralValueTokenFromMatch(
      scannerNativeValueText,
      range.start,
      tokenEnd,
      literalMatch,
      valueParts?.important
    );
  }
  if (!SIMPLE_FLAT_VALUE_PATTERN.test(scannerNativeValueText)) {
    if (
      valueParts
      || !isConservativeRawScannerNativeValue(scannerNativeValueText)
      || RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(scannerNativeValueText)
    ) {
      return undefined;
    }
    return {
      kind: 'raw-value',
      start: range.start,
      end: range.end,
      text: scannerNativeValueText
    };
  }
  return {
    kind: 'flat-literal-list',
    start: range.start,
    end: tokenEnd,
    text: scannerNativeValueText,
    important: valueParts?.important
  };
}

function scannerNativeLiteralValueTokenFromMatch(
  text: string,
  start: number,
  end: number,
  match: RegExpExecArray,
  important?: string
): ScannerNativeValueToken {
  return {
    kind: scannerNativeValueKind(match),
    start,
    end,
    text,
    important
  };
}

function scannerNativeValueKind(match: RegExpExecArray): ScannerNativeValueToken['kind'] {
  if (match.groups?.hex) {
    return 'hex-color';
  }
  if (match.groups?.number) {
    return 'dimension-or-number';
  }
  return 'identifier';
}

function locationFromRange(
  document: StructuralDocument,
  start: number,
  endExclusive: number
): LocationInfo {
  const end = Math.max(start, endExclusive - 1);
  const startPos = document.source.offsetToLineColumn(start);
  const endPos = document.source.offsetToLineColumn(end);
  return [start, startPos.line, startPos.column, end, endPos.line, endPos.column];
}

function structuralFieldRange(
  document: StructuralDocument,
  node: StructuralContainerNode | StructuralStatementNode,
  field: FieldRangeName,
  kind?: FieldRangeKind
): FieldRange | undefined {
  const range = document.fieldRanges.get(node, field);
  if (!range || (kind !== undefined && range.kind !== kind)) {
    return undefined;
  }
  return range;
}

function structuralFieldText(
  document: StructuralDocument,
  node: StructuralContainerNode | StructuralStatementNode,
  field: FieldRangeName,
  kind?: FieldRangeKind
): string | undefined {
  const range = structuralFieldRange(document, node, field, kind);
  return range ? document.source.slice(range.start, range.end) : undefined;
}

function isPlainStructuralFedDeclarationName(name: string): boolean {
  return (
    (PLAIN_DECLARATION_NAME_PATTERN.test(name) && !name.endsWith('_'))
    || isCustomPropertyName(name)
  );
}

function isCustomPropertyName(name: string): boolean {
  return CUSTOM_PROPERTY_NAME_PATTERN.test(name);
}

function splitScannerNativeDeclarationImportant(valueText: string): {
  valueText: string;
  valueLength: number;
  important: string;
} | undefined {
  const match = SCANNER_NATIVE_IMPORTANT_PATTERN.exec(valueText);
  if (!match?.groups) {
    return undefined;
  }
  const important = match.groups.important;
  const value = match.groups.value;
  if (!important || !value) {
    return undefined;
  }
  const valueTextWithoutTrailingWhitespace = value.replace(/[ \t]+$/u, '');
  if (valueTextWithoutTrailingWhitespace.length === 0) {
    return undefined;
  }
  return {
    valueText: valueTextWithoutTrailingWhitespace,
    valueLength: valueTextWithoutTrailingWhitespace.length,
    important
  };
}

const IMPORTANT_FLAG_PATTERN = /!\s*important\b/iu;
const SCANNER_NATIVE_IMPORTANT_PATTERN = /^(?<value>.+?[ \t]+)(?<important>!important)$/u;
const MULTILINE_VALUE_PATTERN = /[\r\n]/u;
const PLAIN_ASSIGNMENT_PATTERN = /^\s*:\s*$/u;
const PLAIN_DECLARATION_NAME_PATTERN = /^-?[a-zA-Z_][\w-]*$/u;
const CUSTOM_PROPERTY_NAME_PATTERN = /^--[-_a-zA-Z][\w-]*$/u;
const CUSTOM_PROPERTY_LESS_VARIABLE_LIKE_PATTERN = /(?:[@$][-_a-zA-Z][\w-]*|[@$]\{[-_a-zA-Z][\w-]*\})/u;
const SIMPLE_VARIABLE_NAME_PATTERN = /^@[a-zA-Z_][\w-]*$/u;
const SIMPLE_VARIABLE_REFERENCE_PATTERN = SIMPLE_VARIABLE_NAME_PATTERN;
const SCANNER_NATIVE_NUMBER_WITH_UNIT_PATTERN =
  /^(?<value>[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+)))(?<unit>%|[a-zA-Z]+)?$/u;
const SCANNER_NATIVE_BINARY_ARITHMETIC_PATTERN =
  /^(?<left>@[a-zA-Z_][\w-]*|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?)[ \t]*(?<operator>[+-])[ \t]*(?<right>@[a-zA-Z_][\w-]*|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?)$/u;
const SIMPLE_LITERAL_VALUE_PATTERN =
  /^(?:(?<hex>#(?:[0-9a-fA-F]{3,8}))|(?<number>[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?)|(?<ident>[a-zA-Z_][\w-]*))$/u;
const SIMPLE_FLAT_VALUE_PATTERN =
  /^(?:#(?:[0-9a-fA-F]{3,8})|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?|[a-zA-Z_][\w-]*)(?:[ \t]+(?:#(?:[0-9a-fA-F]{3,8})|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?|[a-zA-Z_][\w-]*))*$/u;
const RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN = /(?:[@$][-_a-zA-Z][\w-]*|[@$]\{[-_a-zA-Z][\w-]*\})/u;
const RAW_QUOTED_STRING_PATTERN = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/u;
const RAW_SIMPLE_URL_PATTERN = /^url\([-./_~%#?=&+{}a-zA-Z0-9]+\)$/u;
const RAW_FONT_LIST_PATTERN =
  /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[-_a-zA-Z][\w-]*)(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[-_a-zA-Z][\w-]*)|[ \t]*,[ \t]*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[-_a-zA-Z][\w-]*))*$/u;
const RAW_SUPPORTS_DECLARATION_CONDITION_PATTERN =
  /^\([ \t]*-?[-_a-zA-Z][\w-]*[ \t]*:[ \t]*(?:#(?:[0-9a-fA-F]{3,8})|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?|[-_a-zA-Z][\w-]*)[ \t]*\)$/u;
const QUOTED_IMPORT_PATH_PATTERN =
  /^(?:"(?<double>(?:\\.|[^"\\])*)"|'(?<single>(?:\\.|[^'\\])*)')(?:[ \t]+.+)?$/u;
const URL_IMPORT_PATH_PATTERN =
  /^url\([ \t]*(?:"(?<double>(?:\\.|[^"\\])*)"|'(?<single>(?:\\.|[^'\\])*)')[ \t]*\)(?:[ \t]+.+)?$/u;
const SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE =
  String.raw`(?:(?:[-_a-zA-Z][\w-]*|\*)(?:[.#][-_a-zA-Z][\w-]*)*|[.#][-_a-zA-Z][\w-]*(?:[.#][-_a-zA-Z][\w-]*)*)`;
const SCANNER_NATIVE_COMPLEX_SELECTOR_SOURCE =
  String.raw`${SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE}(?:(?:[ \t]+|[ \t]*[>+~][ \t]*)${SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE})*`;
const SCANNER_NATIVE_SELECTOR_PATTERN =
  new RegExp(String.raw`^${SCANNER_NATIVE_COMPLEX_SELECTOR_SOURCE}(?:[ \t]*,[ \t]*${SCANNER_NATIVE_COMPLEX_SELECTOR_SOURCE})*$`, 'u');

function isConservativeRawScannerNativeValue(valueText: string): boolean {
  if (RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(valueText) || valueText.includes('/*')) {
    return false;
  }
  return (
    RAW_QUOTED_STRING_PATTERN.test(valueText)
    || RAW_SIMPLE_URL_PATTERN.test(valueText)
    || RAW_FONT_LIST_PATTERN.test(valueText)
  );
}

function isScannerNativeAtRulePrelude(atRuleName: string | undefined, preludeText: string): boolean {
  if (RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(preludeText) || preludeText.includes('/*')) {
    return false;
  }
  if (atRuleName === '@supports') {
    return RAW_SUPPORTS_DECLARATION_CONDITION_PATTERN.test(preludeText);
  }
  return SIMPLE_LITERAL_VALUE_PATTERN.test(preludeText);
}

function isCssImportPath(pathText: string): boolean {
  const lower = pathText.toLowerCase();
  return /\.css(?:[?#].*)?$/u.test(lower)
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('//');
}

function scannerNativeCssImportPath(preludeText: string): string | undefined {
  const quoted = QUOTED_IMPORT_PATH_PATTERN.exec(preludeText);
  if (quoted?.groups) {
    return quoted.groups.double ?? quoted.groups.single;
  }
  const url = URL_IMPORT_PATH_PATTERN.exec(preludeText);
  if (url?.groups) {
    return url.groups.double ?? url.groups.single;
  }
  return undefined;
}

function isScannerNativeCssImportPrelude(preludeText: string): boolean {
  if (
    MULTILINE_VALUE_PATTERN.test(preludeText)
    || RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(preludeText)
    || preludeText.includes('/*')
    || preludeText.trimStart().startsWith('(')
  ) {
    return false;
  }
  const pathText = scannerNativeCssImportPath(preludeText);
  return pathText !== undefined && isCssImportPath(pathText);
}

function looksLikeSimpleVariableReference(valueText: string): boolean {
  return SIMPLE_VARIABLE_REFERENCE_PATTERN.test(valueText);
}
