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
  Comment,
  BasicSelector,
  Color,
  Declaration,
  Dimension,
  Extend,
  ExtendFlag,
  Mixin,
  Call,
  Reference,
  List,
  Num,
  Any,
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
  type StructuralDocument,
  type StructuralNode,
  type StructuralStatementNode
} from '@jesscss/parser';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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

  private createTreeContext(filePath: string, source: string): TreeContext {
    return new TreeContext({
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
    context: TreeContext,
    importedLessPaths = new Set<string>()
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
    if (countRootImportStatements(plan.document) > 1) {
      return fallback('multiple import statements require canonical import ordering and de-dupe semantics');
    }

    const rootVariables = collectStructuralFedScopeVariables(plan.document, plan.document.root.children, new Map());
    const rules: Node[] = [];
    const variables = rootVariables.variables;
    let progressiveNodes = 0;
    const ownerIslands = indexIslandsByOwner(plan.document.islands());
    const canonicalFilePath = canonicalScannerFirstPath(filePath);
    if (canonicalFilePath) {
      importedLessPaths.add(canonicalFilePath);
    }

    let triviaCursor = plan.document.root.bodyStart;
    for (const child of plan.document.root.children) {
      const comments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, child.start, child, context);
      if ('reason' in comments) {
        return fallback(comments.reason);
      }
      rules.push(...comments.nodes);
      progressiveNodes += comments.progressiveNodes;
      triviaCursor = child.end;

      if (
        child.kind !== 'rule'
        && child.kind !== 'at-rule'
        && child.kind !== 'at-rule-statement'
        && child.kind !== 'import'
        && child.kind !== 'mixin-definition'
        && child.kind !== 'mixin-call'
        && child.kind !== 'variable-declaration'
      ) {
        return fallback(`unsupported root node ${child.kind}`);
      }
      if (child.kind === 'import') {
        const result = this.buildStructuralFedImportStatement(plan, child, context, variables, importedLessPaths);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(...result.rules);
        progressiveNodes += result.progressiveNodes;
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
      if (child.kind === 'mixin-definition') {
        const result = buildStructuralFedMixinDefinition(plan, child, ownerIslands, context, variables, this.mathMode);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        progressiveNodes += result.progressiveNodes ?? 0;
        continue;
      }
      if (child.kind === 'mixin-call') {
        const result = buildStructuralFedMixinCall(plan, child, context);
        if ('reason' in result) {
          return fallback(result.reason);
        }
        rules.push(result.node);
        progressiveNodes += result.progressiveNodes ?? 0;
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
    const trailingComments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, plan.document.root.end, undefined, context);
    if ('reason' in trailingComments) {
      return fallback(trailingComments.reason);
    }
    rules.push(...trailingComments.nodes);
    progressiveNodes += trailingComments.progressiveNodes;

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

  private buildStructuralFedImportStatement(
    plan: IslandParsePlan,
    child: StructuralStatementNode,
    context: TreeContext,
    variables: Map<string, ScannerNativeValueToken>,
    importedLessPaths: Set<string>
  ): StructuralFedImportBuildResult {
    const lessPath = scannerNativeLessImportPath(plan.document, child);
    if (!lessPath) {
      const result = buildStructuralFedCssImportStatement(plan, child, context);
      return 'reason' in result
        ? result
        : {
            rules: [result.node],
            progressiveNodes: result.progressiveNodes ?? 0
          };
    }

    const currentFile = plan.document.source.filePath ?? context.file?.fullPath ?? '';
    const currentDir = path.dirname(currentFile);
    const resolvedPath = this.resolveScannerFirstImportPath(lessPath, currentDir);
    if (!resolvedPath) {
      return { reason: 'Less import path is outside the scanner-native structural-fed subset' };
    }
    if (importedLessPaths.has(resolvedPath)) {
      return { reason: 'repeated Less imports require canonical import de-dupe semantics' };
    }
    importedLessPaths.add(resolvedPath);
    const importedSource = readFileSync(resolvedPath, 'utf8');
    const importedContext = this.createTreeContext(resolvedPath, importedSource);
    const imported = this.runScannerFirstPrototype(resolvedPath, importedSource, importedContext, importedLessPaths);
    if (!imported.tree) {
      return { reason: imported.result.fallbackReason ?? 'imported Less file is outside the scanner-native structural-fed subset' };
    }
    const importedDocument = parseLessStructure(resolvedPath, importedSource);
    const importedVariables = collectStructuralFedScopeVariables(
      importedDocument,
      importedDocument.root.children,
      variables
    );
    for (const [name, value] of importedVariables.variables) {
      variables.set(name, value);
    }
    return {
      rules: imported.tree.rules,
      progressiveNodes: imported.result.progressiveNodes ?? 0
    };
  }

  private resolveScannerFirstImportPath(importPath: string, currentDir: string): string | undefined {
    const searchPaths = readConfiguredSearchPaths(this.opts);
    const candidates = this.resolve(this.expandImport(importPath, currentDir), currentDir, searchPaths) ?? [];
    for (const candidate of candidates) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return canonicalScannerFirstPath(candidate) ?? candidate;
      }
    }
    return undefined;
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
    const context = this.createTreeContext(filePath, source);

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
    || importOptions?.once === true
    || importOptions?.inline === true
    || importOptions?.optional === true
    || importOptions?.postlude !== undefined
    || importOptions?.type !== undefined
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

function countRootImportStatements(document: StructuralDocument): number {
  let count = 0;
  for (const child of document.root.children) {
    if (child.kind === 'import') {
      count++;
    }
  }
  return count;
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

type StructuralFedCommentBuildResult =
  | { nodes: Comment[]; progressiveNodes: number }
  | { reason: string };

function structuralFedBlockCommentsBetween(
  document: StructuralDocument,
  start: number,
  end: number,
  next: StructuralNode | undefined,
  context: TreeContext
): StructuralFedCommentBuildResult {
  const nodes: Comment[] = [];
  for (const trivia of document.trivia) {
    if (trivia.kind !== 'block-comment' || trivia.start < start || trivia.end > end) {
      continue;
    }
    if ('closed' in trivia && trivia.closed === false) {
      return { reason: 'unterminated block comments require canonical trivia preservation' };
    }
    if (next) {
      const commentEnd = document.source.offsetToLineColumn(Math.max(trivia.start, trivia.end - 1));
      const nextStart = document.source.offsetToLineColumn(next.start);
      if (commentEnd.line === nextStart.line) {
        return { reason: 'inline block comments require canonical trivia preservation' };
      }
    }
    nodes.push(new Comment(
      document.source.slice(trivia.start, trivia.end),
      undefined,
      locationFromRange(document, trivia.start, trivia.end),
      context
    ));
  }
  return {
    nodes,
    progressiveNodes: nodes.length
  };
}

type StructuralFedBuildResult =
  | { node: Node; progressiveNodes?: number }
  | { reason: string };

type StructuralFedVariableBuildResult =
  | { node: ProgressiveVariableDeclaration; name: string; valueToken: ScannerNativeValueToken; progressiveNodes: 1 }
  | { reason: string };

type StructuralFedImportBuildResult =
  | { rules: Node[]; progressiveNodes: number }
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
    if (child.kind === 'at-rule-statement') {
      const statementReason = validateStructuralFedRuleAtRuleStatement(document, child);
      if (statementReason) {
        return statementReason;
      }
      continue;
    }
    if (child.kind === 'mixin-call') {
      if (!scannerNativeNoArgMixinName(structuralFieldText(document, child, 'name', 'mixin-name'))) {
        return 'mixin call signature is outside the scanner-native structural-fed subset';
      }
      continue;
    }
    if (child.kind === 'mixin-definition') {
      const mixinReason = validateStructuralFedMixinDefinition(document, child, localVariables, mathMode);
      if (mixinReason) {
        return mixinReason;
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

function validateStructuralFedRuleAtRuleStatement(
  document: StructuralDocument,
  child: StructuralStatementNode
): string | undefined {
  const name = structuralFieldText(document, child, 'name', 'at-rule-name');
  const prelude = structuralFieldText(document, child, 'prelude', 'prelude');
  if (name !== '@apply') {
    return `unsupported rule child ${child.kind}`;
  }
  if (!prelude || !isScannerNativeApplyPrelude(prelude)) {
    return '@apply statement prelude is outside the scanner-native structural-fed subset';
  }
  return undefined;
}

type StructuralFedAtRuleParentKind = 'root' | 'rule' | 'at-rule' | 'mixin-definition';

function validateStructuralFedAtRule(
  document: StructuralDocument,
  atRule: StructuralContainerNode,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  parentKind: StructuralFedAtRuleParentKind,
  mathMode: MathMode = 'parens-division'
): string | undefined {
  const name = structuralFieldText(document, atRule, 'name', 'at-rule-name');
  const rootDeclarationBlockPrelude = structuralFedRootDeclarationBlockPrelude(name, parentKind);
  if (name !== '@media' && name !== '@layer' && name !== '@supports' && rootDeclarationBlockPrelude === undefined) {
    return STRUCTURAL_FED_AT_RULE_FAMILY_REASON;
  }
  if (name === '@layer' && parentKind !== 'root') {
    return 'only root @layer block at-rules are in the progressive structural-fed subset';
  }
  const prelude = structuralFieldText(document, atRule, 'prelude', 'prelude');
  if (rootDeclarationBlockPrelude === 'none' && prelude !== undefined) {
    return `${name} preludes are outside the scanner-native structural-fed subset`;
  }
  if (rootDeclarationBlockPrelude === 'required' && prelude === undefined) {
    return `${name} prelude is outside the scanner-native structural-fed subset`;
  }
  if (prelude === undefined && name !== '@layer' && rootDeclarationBlockPrelude === undefined) {
    return 'at-rule prelude is outside the scanner-native structural-fed subset';
  }
  if (prelude !== undefined && MULTILINE_VALUE_PATTERN.test(prelude)) {
    return 'multiline at-rule preludes are not in the progressive structural-fed subset';
  }
  if (prelude !== undefined && !isScannerNativeAtRulePrelude(name, prelude)) {
    return 'at-rule prelude is outside the scanner-native structural-fed subset';
  }
  const { variables: localVariables } = collectStructuralFedScopeVariables(document, atRule.children, variables);
  for (const child of atRule.children) {
    if (child.kind === 'variable-declaration') {
      const variableReason = validateStructuralFedVariableDeclaration(document, child);
      if (variableReason) {
        return variableReason;
      }
      if (rootDeclarationBlockPrelude !== undefined) {
        return 'Less variable declarations are not in this structural-fed subset';
      }
      continue;
    }
    if (child.kind === 'at-rule') {
      const reason = validateStructuralFedAtRule(document, child, localVariables, 'at-rule', mathMode);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'rule') {
      if (rootDeclarationBlockPrelude !== undefined) {
        return `unsupported at-rule child ${child.kind}`;
      }
      if (parentKind !== 'root' && name !== '@media' && name !== '@supports') {
        return `unsupported at-rule child ${child.kind}`;
      }
      const reason = validateStructuralFedRule(
        document,
        child,
        localVariables,
        name !== '@layer',
        structuralFedAtRuleChildRulesAllowAtRules(parentKind, name),
        mathMode
      );
      if (reason) {
        return reason;
      }
      continue;
    }
    if ((rootDeclarationBlockPrelude === undefined && parentKind === 'root') || child.kind !== 'declaration') {
      return `unsupported at-rule child ${child.kind}`;
    }
    const declarationReason = validateStructuralFedDeclaration(document, child, localVariables, true, mathMode);
    if (declarationReason) {
      return declarationReason;
    }
  }
  return undefined;
}

function structuralFedRootDeclarationBlockPrelude(
  name: string | undefined,
  parentKind: StructuralFedAtRuleParentKind
): 'none' | 'required' | undefined {
  if (parentKind !== 'root') {
    return undefined;
  }
  if (name === '@font-face' || name === '@page') {
    return 'none';
  }
  if (name === '@counter-style') {
    return 'required';
  }
  return undefined;
}

function structuralFedAtRuleChildRulesAllowAtRules(
  parentKind: StructuralFedAtRuleParentKind,
  name: string | undefined
): boolean {
  return parentKind === 'root' || name === '@media' || name === '@supports';
}

function validateStructuralFedMixinDefinition(
  document: StructuralDocument,
  mixinDefinition: StructuralContainerNode,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  mathMode: MathMode = 'parens-division'
): string | undefined {
  const mixinName = scannerNativeNoArgMixinName(
    structuralFieldText(document, mixinDefinition, 'selector', 'selector')
  );
  if (!mixinName) {
    return 'mixin definition signature is outside the scanner-native structural-fed subset';
  }
  const { variables: localVariables } = collectStructuralFedScopeVariables(document, mixinDefinition.children, variables);
  for (const child of mixinDefinition.children) {
    if (child.kind === 'rule') {
      const reason = validateStructuralFedRule(document, child, localVariables, true, true, mathMode);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'at-rule') {
      const reason = validateStructuralFedAtRule(document, child, localVariables, 'mixin-definition', mathMode);
      if (reason) {
        return reason;
      }
      continue;
    }
    if (child.kind === 'variable-declaration') {
      const variableReason = validateStructuralFedVariableDeclaration(document, child);
      if (variableReason) {
        return variableReason;
      }
      continue;
    }
    if (child.kind !== 'declaration') {
      return `unsupported mixin-definition child ${child.kind}`;
    }
    const reason = validateStructuralFedDeclaration(document, child, localVariables, true, mathMode);
    if (reason) {
      return reason;
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
  const extendSelector = readScannerNativeExtendSelectorToken(plan, rule, selectorIsland, context);
  const selectorToken = extendSelector
    ? {
        kind: 'selector' as const,
        start: extendSelector.start,
        end: extendSelector.selectorEnd,
        text: extendSelector.selectorText
      }
    : readScannerNativeSelectorToken(plan, rule, selectorIsland);
  if (!selectorToken && !scopeOnly) {
    return { reason: 'selector is outside the scanner-native structural-fed subset' };
  }

  const rules: Node[] = [];
  const { variables: localVariables } = collectStructuralFedScopeVariables(plan.document, rule.children, variables);
  let progressiveNodes = 1;
  if (extendSelector) {
    rules.push(extendSelector.node);
    progressiveNodes++;
  }
  let triviaCursor = rule.bodyStart;
  for (const child of rule.children) {
    const comments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, child.start, child, context);
    if ('reason' in comments) {
      return comments;
    }
    rules.push(...comments.nodes);
    progressiveNodes += comments.progressiveNodes;
    triviaCursor = child.end;

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
  const trailingComments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, rule.end, undefined, context);
  if ('reason' in trailingComments) {
    return trailingComments;
  }
  rules.push(...trailingComments.nodes);
  progressiveNodes += trailingComments.progressiveNodes;

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

function buildStructuralFedMixinDefinition(
  plan: IslandParsePlan,
  mixinDefinition: StructuralContainerNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext,
  variables: ReadonlyMap<string, ScannerNativeValueToken>,
  mathMode: MathMode = 'parens-division'
): StructuralFedBuildResult {
  const mixinName = scannerNativeNoArgMixinName(
    structuralFieldText(plan.document, mixinDefinition, 'selector', 'selector')
  );
  if (!mixinName) {
    return { reason: 'mixin definition signature is outside the scanner-native structural-fed subset' };
  }
  const reason = validateStructuralFedMixinDefinition(plan.document, mixinDefinition, variables, mathMode);
  if (reason) {
    return { reason };
  }

  const rules: Node[] = [];
  const { variables: localVariables } = collectStructuralFedScopeVariables(plan.document, mixinDefinition.children, variables);
  let progressiveNodes = 1;
  let triviaCursor = mixinDefinition.bodyStart;
  for (const child of mixinDefinition.children) {
    const comments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, child.start, child, context);
    if ('reason' in comments) {
      return comments;
    }
    rules.push(...comments.nodes);
    progressiveNodes += comments.progressiveNodes;
    triviaCursor = child.end;

    const builtChild = buildStructuralFedRuleChild(
      plan,
      child,
      ownerIslands,
      context,
      'mixin-definition',
      localVariables,
      true,
      true,
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
  const trailingComments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, mixinDefinition.end, undefined, context);
  if ('reason' in trailingComments) {
    return trailingComments;
  }
  rules.push(...trailingComments.nodes);
  progressiveNodes += trailingComments.progressiveNodes;

  return {
    node: new Mixin({
      name: new Any(mixinName, { role: 'name' }),
      rules
    }, undefined, locationFromRange(plan.document, mixinDefinition.start, mixinDefinition.end), context),
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
  parentKind: StructuralFedAtRuleParentKind,
  mathMode: MathMode = 'parens-division'
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, atRule, 'name', 'at-rule-name');
  const rootDeclarationBlockPrelude = structuralFedRootDeclarationBlockPrelude(name, parentKind);
  if (name !== '@media' && name !== '@layer' && name !== '@supports' && rootDeclarationBlockPrelude === undefined) {
    return { reason: STRUCTURAL_FED_AT_RULE_FAMILY_REASON };
  }
  if (name === '@layer' && parentKind !== 'root') {
    return { reason: 'only root @layer block at-rules are in the progressive structural-fed subset' };
  }
  const preludeIsland = singleIsland(ownerIslands, atRule, 'at-rule-prelude');
  if (!preludeIsland && name !== '@layer' && rootDeclarationBlockPrelude === undefined) {
    return { reason: 'at-rule prelude island missing' };
  }
  if (preludeIsland && rootDeclarationBlockPrelude === 'none') {
    return { reason: `${name} preludes are outside the scanner-native structural-fed subset` };
  }
  if (!preludeIsland && rootDeclarationBlockPrelude === 'required') {
    return { reason: `${name} prelude is outside the scanner-native structural-fed subset` };
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
  const { variables: localVariables } = collectStructuralFedScopeVariables(plan.document, atRule.children, variables);
  let progressiveNodes = 1;
  let triviaCursor = atRule.bodyStart;
  for (const child of atRule.children) {
    const comments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, child.start, child, context);
    if ('reason' in comments) {
      return comments;
    }
    rules.push(...comments.nodes);
    progressiveNodes += comments.progressiveNodes;
    triviaCursor = child.end;

    if (child.kind === 'variable-declaration') {
      const builtChild = buildStructuralFedVariableDeclaration(plan, child, ownerIslands, context);
      if ('reason' in builtChild) {
        return builtChild;
      }
      if (rootDeclarationBlockPrelude !== undefined) {
        return { reason: 'Less variable declarations are not in this structural-fed subset' };
      }
      localVariables.set(builtChild.name, builtChild.valueToken);
      rules.push(builtChild.node);
      progressiveNodes += builtChild.progressiveNodes ?? 0;
      continue;
    }
    if (child.kind === 'at-rule') {
      const builtChild = buildStructuralFedAtRule(plan, child, ownerIslands, context, localVariables, 'at-rule', mathMode);
      if ('reason' in builtChild) {
        return builtChild;
      }
      rules.push(builtChild.node);
      progressiveNodes += builtChild.progressiveNodes ?? 0;
      continue;
    }
    if (child.kind === 'rule') {
      if (rootDeclarationBlockPrelude !== undefined) {
        return { reason: `unsupported at-rule child ${child.kind}` };
      }
      if (parentKind !== 'root' && name !== '@media' && name !== '@supports') {
        return { reason: `unsupported at-rule child ${child.kind}` };
      }
      const builtChild = buildStructuralFedRuleset(
        plan,
        child,
        ownerIslands,
        context,
        localVariables,
        name !== '@layer',
        structuralFedAtRuleChildRulesAllowAtRules(parentKind, name),
        mathMode
      );
      if ('reason' in builtChild) {
        return builtChild;
      }
      rules.push(builtChild.node);
      progressiveNodes += builtChild.progressiveNodes ?? 0;
      continue;
    }
    if ((rootDeclarationBlockPrelude === undefined && parentKind === 'root') || child.kind !== 'declaration') {
      return { reason: `unsupported at-rule child ${child.kind}` };
    }
    const builtChild = buildStructuralFedDeclaration(plan, child, ownerIslands, context, localVariables, true, mathMode);
    if ('reason' in builtChild) {
      return builtChild;
    }
    rules.push(builtChild.node);
    progressiveNodes += builtChild.progressiveNodes ?? 0;
  }
  const trailingComments = structuralFedBlockCommentsBetween(plan.document, triviaCursor, atRule.end, undefined, context);
  if ('reason' in trailingComments) {
    return trailingComments;
  }
  rules.push(...trailingComments.nodes);
  progressiveNodes += trailingComments.progressiveNodes;

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
  parentKind: 'at-rule' | 'mixin-definition' | 'rule',
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
  if (child.kind === 'at-rule-statement') {
    if (parentKind !== 'rule') {
      return { reason: `unsupported ${parentKind} child ${child.kind}` };
    }
    return buildStructuralFedRuleAtRuleStatement(plan, child, context);
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
  if (child.kind === 'mixin-call') {
    return buildStructuralFedMixinCall(plan, child, context);
  }
  if (child.kind === 'mixin-definition') {
    if (parentKind !== 'rule') {
      return { reason: `unsupported ${parentKind} child ${child.kind}` };
    }
    return buildStructuralFedMixinDefinition(plan, child, ownerIslands, context, variables, mathMode);
  }
  return { reason: `unsupported ${parentKind} child ${child.kind}` };
}

function buildStructuralFedMixinCall(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  context: TreeContext
): StructuralFedBuildResult {
  const mixinName = scannerNativeNoArgMixinName(
    structuralFieldText(plan.document, child, 'name', 'mixin-name')
  );
  if (!mixinName) {
    return { reason: 'mixin call signature is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new Call({
      name: new Reference(
        { key: mixinName },
        { type: 'mixin-ruleset', role: 'name' },
        undefined,
        context
      )
    }, undefined, locationFromRange(plan.document, child.start, child.end), context),
    progressiveNodes: 1
  };
}

function buildStructuralFedRuleAtRuleStatement(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  context: TreeContext
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, child, 'name', 'at-rule-name');
  const prelude = structuralFieldText(plan.document, child, 'prelude', 'prelude');
  if (name !== '@apply' || !prelude || !isScannerNativeApplyPrelude(prelude)) {
    return { reason: '@apply statement prelude is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new AtRuleStatement({
      name,
      prelude
    }, undefined, locationFromRange(plan.document, child.start, child.end), context),
    progressiveNodes: 1
  };
}

function buildStructuralFedAtRuleStatement(
  plan: IslandParsePlan,
  child: StructuralStatementNode,
  ownerIslands: Map<object, RawIslandNode[]>,
  context: TreeContext
): StructuralFedBuildResult {
  const name = structuralFieldText(plan.document, child, 'name', 'at-rule-name');
  if (
    name !== '@charset'
    && name !== '@namespace'
    && !isScannerNativeUnknownAtRuleStatementName(name)
  ) {
    return { reason: 'only @charset and @namespace statement at-rules are in the scanner-native structural-fed subset' };
  }
  const preludeIsland = singleIsland(ownerIslands, child, 'at-rule-prelude');
  if (!preludeIsland) {
    return { reason: 'at-rule statement prelude island missing' };
  }
  const prelude = structuralFieldText(plan.document, child, 'prelude', 'prelude');
  const preludeSupported = name === '@charset' || name === '@namespace'
    ? prelude !== undefined && isScannerNativeAtRuleStatementPrelude(name, prelude)
    : prelude !== undefined && isScannerNativeUnknownAtRuleStatementPrelude(prelude);
  if (!preludeSupported) {
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

function buildStructuralFedCssImportStatement(
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
  if (isScannerNativeFunctionCallValue(scannerNativeValueText)) {
    return undefined;
  }
  if (isScannerNativeMixedFunctionValue(scannerNativeValueText)) {
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
  const valueToken = readScannerNativeDeclarationValueToken(
    plan,
    child,
    valueIsland,
    variables,
    context,
    allowLessVariableReferences,
    mathMode
  );
  if (!valueToken) {
    return { reason: 'declaration value is outside the scanner-native structural-fed subset' };
  }
  return {
    node: new Declaration({
      name,
      value: valueToken.segments ?? [valueToken.node ?? valueToken.text],
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
    | 'function-call'
    | 'custom-property-raw'
    | 'raw-value'
    | 'raw-at-rule-prelude';
  start: number;
  end: number;
  text: string;
  node?: Node;
  segments?: Array<string | Node>;
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

function readScannerNativeExtendSelectorToken(
  plan: IslandParsePlan,
  owner: StructuralContainerNode,
  island: RawIslandNode | undefined,
  context: TreeContext
): {
  start: number;
  selectorEnd: number;
  selectorText: string;
  node: Extend;
} | undefined {
  const range = structuralFieldRange(plan.document, owner, 'selector', 'selector');
  if (!range || (island && (range.start !== island.start || range.end !== island.end))) {
    return undefined;
  }
  const selectorText = plan.document.source.text.slice(range.start, range.end);
  const match = SCANNER_NATIVE_EXTEND_SELECTOR_PATTERN.exec(selectorText);
  if (!match?.groups) {
    return undefined;
  }
  const sourceSelector = match.groups.selector;
  const targetSelector = match.groups.target;
  if (
    !sourceSelector
    || !targetSelector
    || !SCANNER_NATIVE_SELECTOR_BRANCH_PATTERN.test(sourceSelector)
    || !SCANNER_NATIVE_EXTEND_TARGET_PATTERN.test(targetSelector)
  ) {
    return undefined;
  }
  const selectorEnd = range.start + sourceSelector.length;
  const targetStart = range.start + sourceSelector.length + ':extend('.length;
  const targetEnd = targetStart + targetSelector.length;
  return {
    start: range.start,
    selectorEnd,
    selectorText: sourceSelector,
    node: new Extend(
      {
        target: new BasicSelector(
          targetSelector,
          undefined,
          locationFromRange(plan.document, targetStart, targetEnd),
          context
        ),
        flag: ExtendFlag.Exact
      },
      undefined,
      locationFromRange(plan.document, range.start, range.end),
      context
    )
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
  context: TreeContext,
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
  const functionToken = scannerNativeFunctionValueToken(
    plan.document,
    range,
    scannerNativeValueText,
    context,
    valueParts?.important
  );
  if (functionToken) {
    return functionToken;
  }
  const mixedFunctionToken = scannerNativeMixedFunctionValueToken(
    plan.document,
    range,
    scannerNativeValueText,
    context,
    valueParts?.important
  );
  if (mixedFunctionToken) {
    return mixedFunctionToken;
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

function isScannerNativeFunctionCallValue(valueText: string): boolean {
  const parts = scannerNativeFunctionParts(valueText);
  if (!parts) {
    return false;
  }
  const args = splitScannerNativeFunctionArgs(parts.argsText, parts.argsStart);
  return args.length > 0
    && args.every(arg =>
      scannerNativeFunctionArgKind(arg.text) !== undefined
    );
}

function isScannerNativeMixedFunctionValue(valueText: string): boolean {
  const match = SCANNER_NATIVE_MIXED_FUNCTION_VALUE_PATTERN.exec(valueText);
  if (!match?.groups) {
    return false;
  }
  const prefix = match.groups.prefix;
  const call = match.groups.call;
  return (
    prefix !== undefined
    && call !== undefined
    && SIMPLE_FLAT_VALUE_PATTERN.test(prefix.trimEnd())
    && isScannerNativeFunctionCallValue(call)
  );
}

function scannerNativeFunctionValueToken(
  document: StructuralDocument,
  range: { start: number; end: number },
  valueText: string,
  context: TreeContext,
  important?: string
): ScannerNativeValueToken | undefined {
  const parts = scannerNativeFunctionParts(valueText);
  if (!parts) {
    return undefined;
  }
  const args = splitScannerNativeFunctionArgs(parts.argsText, range.start + parts.argsStart);
  if (args.length === 0) {
    return undefined;
  }
  const argNodes: Node[] = [];
  for (const arg of args) {
    const node = scannerNativeFunctionArgNode(document, arg, context);
    if (!node) {
      return undefined;
    }
    argNodes.push(node);
  }
  const nameStart = range.start;
  const nameEnd = range.start + parts.name.length;
  const callEnd = range.start + valueText.length;
  const name = new Reference(
    parts.name,
    { type: 'function', fallbackValue: true },
    locationFromRange(document, nameStart, nameEnd),
    context
  );
  const argsList = new List<Node>(
    argNodes,
    undefined,
    locationFromRange(document, range.start + parts.argsStart, range.start + parts.argsEnd),
    context
  );

  return {
    kind: 'function-call',
    start: range.start,
    end: callEnd,
    text: valueText,
    node: new Call(
      { name, args: argsList },
      { silentFail: true },
      locationFromRange(document, range.start, callEnd),
      context
    ),
    important
  };
}

function scannerNativeMixedFunctionValueToken(
  document: StructuralDocument,
  range: { start: number; end: number },
  valueText: string,
  context: TreeContext,
  important?: string
): ScannerNativeValueToken | undefined {
  const match = SCANNER_NATIVE_MIXED_FUNCTION_VALUE_PATTERN.exec(valueText);
  if (!match?.groups) {
    return undefined;
  }
  const prefix = match.groups.prefix;
  const callText = match.groups.call;
  if (
    prefix === undefined
    || callText === undefined
    || !SIMPLE_FLAT_VALUE_PATTERN.test(prefix.trimEnd())
  ) {
    return undefined;
  }
  const callStart = range.start + prefix.length;
  const callToken = scannerNativeFunctionValueToken(
    document,
    { start: callStart, end: callStart + callText.length },
    callText,
    context
  );
  if (!callToken?.node) {
    return undefined;
  }
  return {
    kind: 'function-call',
    start: range.start,
    end: range.start + valueText.length,
    text: valueText,
    segments: [prefix, callToken.node],
    important
  };
}

function scannerNativeFunctionParts(valueText: string): {
  name: string;
  argsText: string;
  argsStart: number;
  argsEnd: number;
} | undefined {
  const match = SCANNER_NATIVE_FUNCTION_CALL_PATTERN.exec(valueText);
  if (!match?.groups) {
    return undefined;
  }
  const name = match.groups.name;
  const argsText = match.groups.args;
  if (!name || argsText === undefined || !SCANNER_NATIVE_FUNCTION_NAMES.has(name)) {
    return undefined;
  }
  if (SCANNER_NATIVE_FUNCTION_UNSUPPORTED_ARGS_PATTERN.test(argsText)) {
    return undefined;
  }
  const argsStart = name.length + 1;
  return {
    name,
    argsText,
    argsStart,
    argsEnd: argsStart + argsText.length
  };
}

function splitScannerNativeFunctionArgs(argsText: string, absoluteStart: number): Array<{
  text: string;
  start: number;
  end: number;
}> {
  const args: Array<{ text: string; start: number; end: number }> = [];
  let segmentStart = 0;
  for (let i = 0; i <= argsText.length; i++) {
    if (i !== argsText.length && argsText[i] !== ',') {
      continue;
    }
    const raw = argsText.slice(segmentStart, i);
    const leading = /^[ \t]*/u.exec(raw)?.[0].length ?? 0;
    const trailing = /[ \t]*$/u.exec(raw)?.[0].length ?? 0;
    const text = raw.slice(leading, raw.length - trailing);
    if (text.length === 0) {
      return [];
    }
    args.push({
      text,
      start: absoluteStart + segmentStart + leading,
      end: absoluteStart + i - trailing
    });
    segmentStart = i + 1;
  }
  return args;
}

function scannerNativeFunctionArgKind(text: string): 'hex-color' | 'dimension' | 'number' | undefined {
  if (SCANNER_NATIVE_HEX_COLOR_PATTERN.test(text)) {
    return 'hex-color';
  }
  const numberMatch = SCANNER_NATIVE_NUMBER_WITH_UNIT_PATTERN.exec(text);
  if (!numberMatch?.groups) {
    return undefined;
  }
  return numberMatch.groups.unit ? 'dimension' : 'number';
}

function scannerNativeFunctionArgNode(
  document: StructuralDocument,
  arg: { text: string; start: number; end: number },
  context: TreeContext
): Node | undefined {
  const kind = scannerNativeFunctionArgKind(arg.text);
  const location = locationFromRange(document, arg.start, arg.end);
  if (kind === 'hex-color') {
    return new Color(arg.text, undefined, location, context);
  }
  const numberMatch = SCANNER_NATIVE_NUMBER_WITH_UNIT_PATTERN.exec(arg.text);
  if (!numberMatch?.groups) {
    return undefined;
  }
  const value = Number(numberMatch.groups.value);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const unit = numberMatch.groups.unit;
  return unit
    ? new Dimension({ number: value, unit }, undefined, location, context)
    : new Num(value, undefined, location, context);
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
const STRUCTURAL_FED_AT_RULE_FAMILY_REASON =
  'only @media, @supports, root @layer, root @font-face, root @page, and root @counter-style block at-rules are in the progressive structural-fed subset';
const SCANNER_NATIVE_IMPORTANT_PATTERN = /^(?<value>.+?[ \t]+)(?<important>!important)$/u;
const MULTILINE_VALUE_PATTERN = /[\r\n]/u;
const PLAIN_ASSIGNMENT_PATTERN = /^\s*:\s*$/u;
const PLAIN_DECLARATION_NAME_PATTERN = /^-?[a-zA-Z_][\w-]*$/u;
const CUSTOM_PROPERTY_NAME_PATTERN = /^--[-_a-zA-Z][\w-]*$/u;
const CUSTOM_PROPERTY_LESS_VARIABLE_LIKE_PATTERN = /(?:[@$][-_a-zA-Z][\w-]*|[@$]\{[-_a-zA-Z][\w-]*\})/u;
const SIMPLE_VARIABLE_NAME_PATTERN = /^@[a-zA-Z_][\w-]*$/u;
const SIMPLE_VARIABLE_REFERENCE_PATTERN = SIMPLE_VARIABLE_NAME_PATTERN;
const SCANNER_NATIVE_NO_ARG_MIXIN_PATTERN = /^([.#][-_a-zA-Z][\w-]*)\([ \t]*\)$/u;
const SCANNER_NATIVE_FUNCTION_NAMES = new Set([
  'lighten',
  'rgb'
]);
const SCANNER_NATIVE_FUNCTION_CALL_PATTERN = /^(?<name>[-_a-zA-Z][\w-]*)\((?<args>.*)\)$/u;
const SCANNER_NATIVE_MIXED_FUNCTION_VALUE_PATTERN = /^(?<prefix>.+[ \t]+)(?<call>[-_a-zA-Z][\w-]*\(.*\))$/u;
const SCANNER_NATIVE_FUNCTION_UNSUPPORTED_ARGS_PATTERN = /[\r\n(){};"']|\/\*|\/\//u;
const SCANNER_NATIVE_HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;
const SCANNER_NATIVE_NUMBER_WITH_UNIT_PATTERN =
  /^(?<value>[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+)))(?<unit>%|[a-zA-Z]+)?$/u;
const SCANNER_NATIVE_BINARY_ARITHMETIC_PATTERN =
  /^(?<left>@[a-zA-Z_][\w-]*|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?)[ \t]*(?<operator>[+-])[ \t]*(?<right>@[a-zA-Z_][\w-]*|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?)$/u;
const SIMPLE_LITERAL_VALUE_PATTERN =
  /^(?:(?<hex>#(?:[0-9a-fA-F]{3,8}))|(?<number>[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?)|(?<ident>[a-zA-Z_][\w-]*))$/u;
const SIMPLE_FLAT_VALUE_ATOM_SOURCE =
  String.raw`(?:#(?:[0-9a-fA-F]{3,8})|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?|[a-zA-Z_][\w-]*)`;
const SIMPLE_FLAT_VALUE_PATTERN =
  new RegExp(String.raw`^${SIMPLE_FLAT_VALUE_ATOM_SOURCE}(?:[ \t]+${SIMPLE_FLAT_VALUE_ATOM_SOURCE})*$`, 'u');
const RAW_COMMA_FLAT_VALUE_PATTERN =
  new RegExp(String.raw`^${SIMPLE_FLAT_VALUE_ATOM_SOURCE}(?:[ \t]+${SIMPLE_FLAT_VALUE_ATOM_SOURCE})*(?:[ \t]*,[ \t]*${SIMPLE_FLAT_VALUE_ATOM_SOURCE}(?:[ \t]+${SIMPLE_FLAT_VALUE_ATOM_SOURCE})*)+$`, 'u');
const RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN = /(?:[@$][-_a-zA-Z][\w-]*|[@$]\{[-_a-zA-Z][\w-]*\})/u;
const RAW_QUOTED_STRING_PATTERN = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/u;
const RAW_SIMPLE_URL_PATTERN = /^url\([-./_~%#?=&+{},a-zA-Z0-9]+\)$/u;
const RAW_QUOTED_URL_PATTERN = /^url\([ \t]*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')[ \t]*\)$/u;
const RAW_FONT_LIST_PATTERN =
  /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[-_a-zA-Z][\w-]*)(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[-_a-zA-Z][\w-]*)|[ \t]*,[ \t]*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[-_a-zA-Z][\w-]*))*$/u;
const RAW_SUPPORTS_DECLARATION_CONDITION_PATTERN =
  /^\([ \t]*-?[-_a-zA-Z][\w-]*[ \t]*:[ \t]*(?:#(?:[0-9a-fA-F]{3,8})|[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:%|[a-zA-Z]+)?|[-_a-zA-Z][\w-]*)[ \t]*\)$/u;
const RAW_NAMESPACE_PRELUDE_PATTERN =
  /^(?:(?:[-_a-zA-Z][\w-]*|\*)[ \t]+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([ \t]*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')[ \t]*\))$/u;
const KNOWN_SEMANTIC_AT_RULE_STATEMENT_NAMES = new Set([
  '@charset',
  '@import',
  '@layer',
  '@namespace',
  '@plugin'
]);
const QUOTED_IMPORT_PATH_PATTERN =
  /^(?:"(?<double>(?:\\.|[^"\\])*)"|'(?<single>(?:\\.|[^'\\])*)')(?:[ \t]+.+)?$/u;
const EXACT_QUOTED_IMPORT_PATH_PATTERN =
  /^(?:"(?<double>(?:\\.|[^"\\])*)"|'(?<single>(?:\\.|[^'\\])*)')$/u;
const URL_IMPORT_PATH_PATTERN =
  /^url\([ \t]*(?:"(?<double>(?:\\.|[^"\\])*)"|'(?<single>(?:\\.|[^'\\])*)')[ \t]*\)(?:[ \t]+.+)?$/u;
const SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE =
  String.raw`(?:(?:[-_a-zA-Z][\w-]*|\*)(?:[.#][-_a-zA-Z][\w-]*)*|[.#][-_a-zA-Z][\w-]*(?:[.#][-_a-zA-Z][\w-]*)*)`;
const SCANNER_NATIVE_COMPLEX_SELECTOR_SOURCE =
  String.raw`${SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE}(?:(?:[ \t]+|[ \t]*[>+~][ \t]*)${SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE})*`;
const SCANNER_NATIVE_SELECTOR_PATTERN =
  new RegExp(String.raw`^${SCANNER_NATIVE_COMPLEX_SELECTOR_SOURCE}(?:[ \t]*,[ \t]*${SCANNER_NATIVE_COMPLEX_SELECTOR_SOURCE})*$`, 'u');
const SCANNER_NATIVE_SELECTOR_BRANCH_PATTERN =
  new RegExp(String.raw`^${SCANNER_NATIVE_SELECTOR_BRANCH_SOURCE}$`, 'u');
const SCANNER_NATIVE_EXTEND_TARGET_PATTERN = /^[.#][-_a-zA-Z][\w-]*$/u;
const SCANNER_NATIVE_EXTEND_SELECTOR_PATTERN =
  /^(?<selector>[^:(){}\r\n]+):extend\((?<target>[^()\s{},;\r\n]+)\)$/u;

function isConservativeRawScannerNativeValue(valueText: string): boolean {
  if (RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(valueText) || valueText.includes('/*')) {
    return false;
  }
  return (
    RAW_QUOTED_STRING_PATTERN.test(valueText)
    || RAW_SIMPLE_URL_PATTERN.test(valueText)
    || RAW_QUOTED_URL_PATTERN.test(valueText)
    || RAW_FONT_LIST_PATTERN.test(valueText)
    || RAW_COMMA_FLAT_VALUE_PATTERN.test(valueText)
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

function isScannerNativeAtRuleStatementPrelude(name: string, preludeText: string): boolean {
  if (MULTILINE_VALUE_PATTERN.test(preludeText) || RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(preludeText) || preludeText.includes('/*')) {
    return false;
  }
  if (name === '@namespace') {
    return RAW_NAMESPACE_PRELUDE_PATTERN.test(preludeText);
  }
  return RAW_QUOTED_STRING_PATTERN.test(preludeText);
}

function isScannerNativeUnknownAtRuleStatementName(name: string | undefined): name is string {
  return name !== undefined
    && /^@[a-zA-Z][\w-]*$/u.test(name)
    && !KNOWN_SEMANTIC_AT_RULE_STATEMENT_NAMES.has(name.toLowerCase());
}

function isScannerNativeUnknownAtRuleStatementPrelude(preludeText: string): boolean {
  if (MULTILINE_VALUE_PATTERN.test(preludeText) || preludeText.includes('/*')) {
    return false;
  }
  return RAW_QUOTED_STRING_PATTERN.test(preludeText)
    || SIMPLE_FLAT_VALUE_PATTERN.test(preludeText);
}

function isScannerNativeApplyPrelude(preludeText: string): boolean {
  if (MULTILINE_VALUE_PATTERN.test(preludeText) || RAW_VALUE_LESS_VARIABLE_LIKE_PATTERN.test(preludeText) || preludeText.includes('/*')) {
    return false;
  }
  return /^-?[_a-zA-Z][\w-]*(?:\s+-?[_a-zA-Z][\w-]*)*$/u.test(preludeText);
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

function scannerNativeLessImportPath(
  document: StructuralDocument,
  child: StructuralStatementNode
): string | undefined {
  const name = structuralFieldText(document, child, 'name', 'import-name');
  if (name !== '@import') {
    return undefined;
  }
  const preludeText = structuralFieldText(document, child, 'prelude', 'prelude');
  if (!preludeText || MULTILINE_VALUE_PATTERN.test(preludeText) || preludeText.includes('/*')) {
    return undefined;
  }
  const quoted = EXACT_QUOTED_IMPORT_PATH_PATTERN.exec(preludeText);
  const pathText = quoted?.groups?.double ?? quoted?.groups?.single;
  if (!pathText || isCssImportPath(pathText)) {
    return undefined;
  }
  const extension = path.extname(pathText).toLowerCase();
  return extension === '' || extension === '.less' ? pathText : undefined;
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

function scannerNativeNoArgMixinName(valueText: string | undefined): string | undefined {
  return valueText ? SCANNER_NATIVE_NO_ARG_MIXIN_PATTERN.exec(valueText)?.[1] : undefined;
}

function readConfiguredSearchPaths(options: LessPluginOptions): string[] {
  const configured = (options as LessPluginOptions & {
    paths?: string[];
    searchPaths?: string[];
  }).searchPaths ?? (options as LessPluginOptions & { paths?: string[] }).paths;
  return Array.isArray(configured) ? configured : [];
}

function canonicalScannerFirstPath(filePath: string): string | undefined {
  return filePath && existsSync(filePath) ? realpathSync.native(filePath) : filePath || undefined;
}
