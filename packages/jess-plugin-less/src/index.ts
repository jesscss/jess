import {
  type Plugin,
  AbstractPlugin,
  TreeContext,
  JessError,
  JsFunction,
  Rules,
  Any,
  Declaration,
  VarDeclaration,
  Ruleset,
  AtRule,
  Selector,
  Node,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type LocationInfo,
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
  countRequestedIslandKinds,
  countRequestedOwnerKinds,
  createStructuralProbeSnapshot,
  structuralDiagnosticRanges,
  type LanguageActivation,
  type ParserConfigKey,
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
   * wires the Less parser instance into island providers. `safeParse` remains
   * the compiler entrypoint; this capability is for staged structural consumers.
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
   * whose bodies contain ordinary declarations, nested ordinary rules, plain
   * Less variables, plus @media block at-rules with the same supported body
   * shapes.
   * Selectors, values, and at-rule preludes still materialize through Less
   * island providers. Anything outside that shape records a canonical fallback
   * instead of pretending the structural path owns more Less semantics than it
   * actually proves.
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
    const configKey = lessParserConfigKey({
      mathMode: this.mathMode,
      leakyRules: this.leakyRules
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

    const rules: Node[] = [];
    const ownerIslands = indexIslandsByOwner(plan.document.islands());

    for (const child of plan.document.root.children) {
      if (child.kind !== 'rule' && child.kind !== 'at-rule' && child.kind !== 'variable-declaration') {
        return fallback(`unsupported root node ${child.kind}`);
      }
      if (child.kind === 'variable-declaration') {
        const eligibilityReason = validateStructuralFedVariableDeclaration(plan.document, child);
        if (eligibilityReason) {
          return fallback(eligibilityReason);
        }
        const result = buildStructuralFedVariableDeclaration(plan, child, ownerIslands, configKey, context);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        continue;
      }
      if (child.kind === 'at-rule') {
        const eligibilityReason = validateStructuralFedAtRule(plan.document, child);
        if (eligibilityReason) {
          return fallback(eligibilityReason);
        }
        const result = buildStructuralFedAtRule(plan, child, ownerIslands, configKey, context);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        continue;
      }
      const eligibilityReason = validateStructuralFedRule(plan.document, child);
      if (eligibilityReason) {
        return fallback(eligibilityReason);
      }
      const result = buildStructuralFedRuleset(plan, child, ownerIslands, configKey, context);
      if ('reason' in result) {
        return fallback(result.reason);
      }
      rules.push(result.node);
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
        if (scannerFirstProbe.structuralFedPrototype) {
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
  const matches = (byOwner.get(owner) ?? []).filter(island => island.islandKind === islandKind);
  return matches.length === 1 ? matches[0] : undefined;
}

type StructuralFedBuildResult =
  | { node: Node }
  | { reason: string };

function validateStructuralFedRule(
  document: StructuralDocument,
  rule: StructuralContainerNode
): string | undefined {
  for (const child of rule.children) {
    if (child.kind === 'rule') {
      const nestedReason = validateStructuralFedRule(document, child);
      if (nestedReason) {
        return nestedReason;
      }
      continue;
    }
    if (child.kind === 'variable-declaration') {
      const reason = validateStructuralFedVariableDeclaration(document, child);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'at-rule') {
      const reason = validateStructuralFedAtRule(document, child);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind !== 'declaration') {
      return `unsupported rule child ${child.kind}`;
    }

    const name = document.source.slice(child.nameStart, child.nameEnd);
    const valueText = document.source.slice(child.valueStart, child.valueEnd);
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
    if (IMPORTANT_FLAG_PATTERN.test(valueText)) {
      return 'important declarations are not in the first structural-fed subset';
    }
  }
  return undefined;
}

function validateStructuralFedVariableDeclaration(
  document: StructuralDocument,
  child: StructuralStatementNode
): string | undefined {
  const name = document.source.slice(child.nameStart, child.nameEnd);
  const valueText = document.source.slice(child.valueStart, child.valueEnd);
  const assignmentText = document.source.slice(child.nameEnd, child.valueStart);
  if (!PLAIN_LESS_VARIABLE_NAME_PATTERN.test(name)) {
    return 'variable declaration name is outside the first structural-fed subset';
  }
  if (!PLAIN_ASSIGNMENT_PATTERN.test(assignmentText)) {
    return 'variable declaration assignment is outside the first structural-fed subset';
  }
  if (MULTILINE_VALUE_PATTERN.test(valueText)) {
    return 'multiline variable declaration values are not in the first structural-fed subset';
  }
  if (IMPORTANT_FLAG_PATTERN.test(valueText)) {
    return 'important variable declarations are not in the first structural-fed subset';
  }
  return undefined;
}

function validateStructuralFedAtRule(
  document: StructuralDocument,
  atRule: StructuralContainerNode
): string | undefined {
  if (!structuralAtRuleName(document, atRule)) {
    return 'at-rule name is outside the first structural-fed subset';
  }
  if (!isSupportedStructuralFedAtRule(document, atRule)) {
    return 'unsupported block at-rule in the first structural-fed subset';
  }
  for (const child of atRule.children) {
    if (child.kind === 'rule') {
      const reason = validateStructuralFedRule(document, child);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'at-rule') {
      const reason = validateStructuralFedAtRule(document, child);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'variable-declaration') {
      const reason = validateStructuralFedVariableDeclaration(document, child);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'declaration') {
      const name = document.source.slice(child.nameStart, child.nameEnd);
      const valueText = document.source.slice(child.valueStart, child.valueEnd);
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
      if (IMPORTANT_FLAG_PATTERN.test(valueText)) {
        return 'important declarations are not in the first structural-fed subset';
      }
      continue;
    }
    return `unsupported at-rule child ${child.kind}`;
  }
  return undefined;
}

function buildStructuralFedRuleset(
  plan: IslandParsePlan,
  rule: StructuralContainerNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  configKey: ParserConfigKey,
  context: TreeContext
): StructuralFedBuildResult {
  const selectorIsland = singleIsland(ownerIslands, rule, 'selector');
  if (!selectorIsland) {
    return { reason: 'rule selector island missing' };
  }
  const selectorRecord = plan.execute<Selector>(
    plan.requestIsland(selectorIsland, 'less-selector', configKey)
  );
  if (selectorRecord.fallbackFullTree || selectorRecord.diagnostics.length > 0) {
    return { reason: 'selector island did not materialize cleanly' };
  }
  if (!(selectorRecord.value instanceof Selector)) {
    return { reason: 'selector island returned a non-selector value' };
  }

  const rules: Node[] = [];
  for (const child of rule.children) {
    const builtChild = buildStructuralFedRuleChild(plan, child, ownerIslands, configKey, context, 'rule');
    if ('reason' in builtChild) {
      return builtChild;
    }
    rules.push(builtChild.node);
  }

  return {
    node: new Ruleset({
      selector: selectorRecord.value,
      rules
    }, undefined, locationFromRange(plan.document, rule.start, rule.end), context)
  };
}

function buildStructuralFedAtRule(
  plan: IslandParsePlan,
  atRule: StructuralContainerNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  configKey: ParserConfigKey,
  context: TreeContext
): StructuralFedBuildResult {
  const nameText = structuralAtRuleName(plan.document, atRule);
  if (!nameText) {
    return { reason: 'at-rule name is outside the first structural-fed subset' };
  }

  const preludeIsland = singleIsland(ownerIslands, atRule, 'at-rule-prelude');
  const preludeRecord = preludeIsland
    ? plan.execute<Node>(plan.requestIsland(preludeIsland, 'less-media-prelude', configKey))
    : undefined;
  if (preludeRecord && (preludeRecord.fallbackFullTree || preludeRecord.diagnostics.length > 0)) {
    return { reason: 'at-rule prelude island did not materialize cleanly' };
  }
  if (preludeRecord && !(preludeRecord.value instanceof Node)) {
    return { reason: 'at-rule prelude island returned a non-node value' };
  }

  const rules: Node[] = [];
  for (const child of atRule.children) {
    const builtChild = buildStructuralFedRuleChild(plan, child, ownerIslands, configKey, context, 'at-rule');
    if ('reason' in builtChild) {
      return builtChild;
    }
    rules.push(builtChild.node);
  }

  return {
    node: new AtRule({
      name: new Any(
        nameText,
        { role: 'atkeyword' },
        locationFromRange(plan.document, atRule.headerStart, atRule.headerStart + nameText.length),
        context
      ),
      prelude: preludeRecord?.value,
      rules
    }, { nestable: true }, locationFromRange(plan.document, atRule.start, atRule.end), context)
  };
}

function buildStructuralFedRuleChild(
  plan: IslandParsePlan,
  child: StructuralContainerNode['children'][number],
  ownerIslands: Map<object, RawIslandNode[]>,
  configKey: ParserConfigKey,
  context: TreeContext,
  parentKind: 'at-rule' | 'rule'
): StructuralFedBuildResult {
  if (child.kind === 'rule') {
    return buildStructuralFedRuleset(plan, child, ownerIslands, configKey, context);
  }
  if (child.kind === 'at-rule') {
    return buildStructuralFedAtRule(plan, child, ownerIslands, configKey, context);
  }
  if (child.kind === 'variable-declaration') {
    return buildStructuralFedVariableDeclaration(plan, child, ownerIslands, configKey, context);
  }
  if (child.kind === 'declaration') {
    return buildStructuralFedDeclaration(plan, child, ownerIslands, configKey, context);
  }
  return { reason: `unsupported ${parentKind} child ${child.kind}` };
}

function buildStructuralFedDeclaration(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  configKey: ParserConfigKey,
  context: TreeContext
): StructuralFedBuildResult {
  const name = plan.document.source.slice(child.nameStart, child.nameEnd);
  const valueIsland = singleIsland(ownerIslands, child, 'declaration-value');
  if (!valueIsland) {
    return { reason: 'declaration value island missing' };
  }
  const valueRecord = plan.execute<Node>(
    plan.requestIsland(valueIsland, 'less-value', configKey)
  );
  if (valueRecord.fallbackFullTree || valueRecord.diagnostics.length > 0) {
    return { reason: 'declaration value island did not materialize cleanly' };
  }
  if (!(valueRecord.value instanceof Node)) {
    return { reason: 'declaration value island returned a non-node value' };
  }
  return {
    node: new Declaration({
      name: new Any(name, { role: 'property' }, locationFromRange(plan.document, child.nameStart, child.nameEnd), context),
      value: valueRecord.value
    }, { assign: ':' }, locationFromRange(plan.document, child.start, child.end), context)
  };
}

function buildStructuralFedVariableDeclaration(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  configKey: ParserConfigKey,
  context: TreeContext
): StructuralFedBuildResult {
  const rawName = plan.document.source.slice(child.nameStart, child.nameEnd);
  const valueIsland = singleIsland(ownerIslands, child, 'declaration-value');
  if (!valueIsland) {
    return { reason: 'variable declaration value island missing' };
  }
  const valueRecord = plan.execute<Node>(
    plan.requestIsland(valueIsland, 'less-value', configKey)
  );
  if (valueRecord.fallbackFullTree || valueRecord.diagnostics.length > 0) {
    return { reason: 'variable declaration value island did not materialize cleanly' };
  }
  if (!(valueRecord.value instanceof Node)) {
    return { reason: 'variable declaration value island returned a non-node value' };
  }

  return {
    node: new VarDeclaration({
      name: new Any(
        rawName.slice(1),
        { role: 'ident' },
        locationFromRange(plan.document, child.nameStart, child.nameEnd),
        context
      ),
      value: valueRecord.value
    }, undefined, locationFromRange(plan.document, child.start, child.end), context)
  };
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

function isPlainStructuralFedDeclarationName(name: string): boolean {
  return PLAIN_DECLARATION_NAME_PATTERN.test(name) && !name.endsWith('_');
}

function structuralAtRuleName(
  document: StructuralDocument,
  atRule: StructuralContainerNode
): string | undefined {
  const header = document.source.slice(atRule.headerStart, atRule.headerEnd);
  return AT_RULE_NAME_PATTERN.exec(header)?.[0];
}

function isSupportedStructuralFedAtRule(
  document: StructuralDocument,
  atRule: StructuralContainerNode
): boolean {
  return structuralAtRuleName(document, atRule) === '@media';
}

const IMPORTANT_FLAG_PATTERN = /!\s*important\b/iu;
const MULTILINE_VALUE_PATTERN = /[\r\n]/u;
const AT_RULE_NAME_PATTERN = /^@[-\w]+/u;
const PLAIN_ASSIGNMENT_PATTERN = /^\s*:\s*$/u;
const PLAIN_DECLARATION_NAME_PATTERN = /^-?[a-zA-Z_][\w-]*$/u;
const PLAIN_LESS_VARIABLE_NAME_PATTERN = /^@[a-zA-Z_][\w-]*$/u;
