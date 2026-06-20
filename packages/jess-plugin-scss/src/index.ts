import {
  type Plugin,
  AbstractPlugin,
  TreeContext,
  type ISafeParseResult,
  type SafeParseOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  JessError,
  getErrorFromParser,
  toDiagnostic,
  extractRelevantLines,
  type Rules
} from '@jesscss/core';
import {
  Parser,
  parseScssStructure,
  registerScssIslandProviders,
  scssIslandParsePlan,
  scssProfile
} from '@jesscss/scss-parser';
import {
  IslandParsePlan,
  IslandParserRegistry,
  countRequestedIslandKinds,
  countRequestedOwnerKinds,
  createStructuralProbeSnapshot,
  type LanguageActivation,
  type ParseStructureOptions,
  type StructuralDocument
} from '@jesscss/parser';
import path from 'node:path';
import { expandScssImportCandidates } from '@jesscss/style-resolver';
import type { EqualityMode, UnitMode } from '@jesscss/core';

export type ScssPluginOptions = {
  allowExtendSelectors?: ExtendSelectorKind[];
  /**
   * Unit mode for handling unit arithmetic.
   * - 'loose': Convert units when possible (default for Less)
   * - 'preserve': Create calc() expressions for unit errors (default for SCSS)
   * - 'strict': Throw errors for unit mismatches
   * @default 'preserve'
   */
  unitMode?: UnitMode;
  /**
   * Equality mode for guard/comparison semantics.
   * @default 'strict'
   */
  equalityMode?: EqualityMode;
  /**
   * Whether to collapse nested selectors (flatten nesting during print).
   * This is a Jess output option, not a Sass option.
   */
  collapseNesting?: boolean;
  /**
   * Hidden scanner-first instrumentation gate. It records structural scan and
   * selected island materialization metrics while canonical parsing remains
   * responsible for the compiler tree.
   */
  scannerFirstProbe?: boolean | ScannerFirstProbeOptions;
  /**
   * Retains every scanner-first probe result on the plugin instance. Disabled
   * by default so watch-mode experiments keep only the latest metrics.
   */
  retainScannerFirstProbeHistory?: boolean;
};

type ExtendSelectorKind = 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

export type ScannerFirstProbeOptions = {
  materializeIslandKinds?: readonly string[] | 'all';
};

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

export class ScssPlugin extends AbstractPlugin {
  name = 'scss';
  supportedExtensions = ['.scss'];
  parser: Parser;
  unitMode: UnitMode;
  equalityMode: EqualityMode;
  scannerFirstProbes: ScannerFirstProbeResult[] = [];
  lastScannerFirstProbe?: ScannerFirstProbeResult;

  constructor(public opts: ScssPluginOptions = {}) {
    super();
    this.unitMode = opts.unitMode ?? 'preserve';
    this.equalityMode = opts.equalityMode ?? 'strict';
    this.parser = new Parser();
  }

  expandImport(importPath: string) {
    // Keep import expansion in sync with the language service.
    return expandScssImportCandidates(importPath);
  }

  /**
   * Describes the structural parser capabilities owned by this plugin.
   *
   * The plugin binds SCSS syntax to `.scss` files and reuses its parser
   * instance for island materialization. `safeParse` remains the compiler
   * entrypoint until the scanner-first path is explicitly promoted.
   */
  structuralActivation(): LanguageActivation {
    return {
      name: this.name,
      profile: scssProfile,
      supportedExtensions: this.supportedExtensions,
      configureIslandProviders: (registry) => {
        registerScssIslandProviders(registry, this.parser);
      }
    };
  }

  /**
   * Runs the shared structural parser with SCSS profile metadata and file-path
   * preserving source text. This returns structural nodes and raw islands only;
   * it does not build canonical compiler nodes.
   */
  structureParse(filePath: string, source: string, options?: ParseStructureOptions): StructuralDocument {
    return parseScssStructure(filePath, source, options);
  }

  /**
   * Creates a demand-driven island parse plan for SCSS source.
   *
   * Providers reuse this plugin's parser instance so JIT materialization
   * observes the same grammar surface as `safeParse`.
   */
  islandParsePlan(
    filePath: string,
    source: string,
    registry: IslandParserRegistry = new IslandParserRegistry()
  ): IslandParsePlan {
    return scssIslandParsePlan(filePath, source, registry, this.parser);
  }

  /**
   * Runs the scanner-first path as a structural sidecar before canonical SCSS
   * parsing. The probe can optionally materialize selected islands, but it
   * never replaces the compiler AST returned by `safeParse`.
   */
  runScannerFirstProbe(
    filePath: string,
    source: string,
    options: ScannerFirstProbeOptions = {}
  ): ScannerFirstProbeResult {
    const startedAt = nowMs();
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

      const targetShape = scssTargetShapeForIsland(island.islandKind);
      if (!targetShape) {
        continue;
      }

      requestedIslands++;
      const id = plan.requestIsland(island, targetShape);
      const materializationStartedAt = nowMs();
      const record = plan.execute(id);
      materializationMs += nowMs() - materializationStartedAt;
      executedIslands++;
      islandDiagnostics += record.diagnostics.length;
    }

    const result: ScannerFirstProbeResult = {
      ...structuralSnapshot,
      structuralScanMs: structuralEndedAt - structuralStartedAt,
      materializationMs,
      totalProbeMs: nowMs() - startedAt,
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
    this.lastScannerFirstProbe = result;
    if (this.opts.retainScannerFirstProbeHistory) {
      this.scannerFirstProbes.push(result);
    }
    return result;
  }

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    const scannerFirstProbe = getScannerFirstProbeOptions(
      this.opts.scannerFirstProbe,
      parseOptions?.compilerOptions?.scannerFirstProbe
    );
    const allowExtendSelectors = this.opts.allowExtendSelectors
      ?? parseOptions?.compilerOptions?.allowExtendSelectors
      ?? ['simple'];

    const context = new TreeContext({
      file: {
        name: path.basename(filePath),
        path: path.dirname(filePath),
        fullPath: filePath,
        source
      },
      plugin: this,
      allowExtendSelectors,
      unitMode: this.unitMode,
      equalityMode: this.equalityMode,
      collapseNesting: this.opts.collapseNesting ?? false
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

      // Convert parser errors to normalized diagnostics
      if (parseResult.errors.length) {
        for (const error of parseResult.errors) {
          const line = error.token?.startLine ?? 1;
          const jessError = getErrorFromParser([error], undefined, filePath, source, { file: context.file });
          const diagnostic = toDiagnostic(jessError);
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

      // Convert lexer errors
      const lexErrors = parseResult.lexerResult?.errors ?? [];
      if (lexErrors.length) {
        for (const lexError of lexErrors) {
          const line = typeof lexError.line === 'number' ? lexError.line : 1;
          const jessError = getErrorFromParser([], [lexError], filePath, source, { file: context.file });
          const diagnostic = toDiagnostic(jessError);
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
    } catch (error: unknown) {
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
          reason: message,
          fix: 'Check the file syntax and ensure it is valid.',
          file: context.file,
          filePath,
          line: 1,
          column: 1,
          lines: extractRelevantLines(source, 1)
        });
      }
      return { errors, warnings };
    }

    return { tree, errors, warnings };
  }
}

const scssPlugin = ((opts?: ScssPluginOptions) => new ScssPlugin(opts)) satisfies Plugin;

export default scssPlugin;

function scssTargetShapeForIsland(
  islandKind: string
): 'scss-condition' | 'scss-prelude' | 'scss-selector' | 'scss-value' | undefined {
  switch (islandKind) {
    case 'selector':
      return 'scss-selector';
    case 'at-rule-prelude':
      return 'scss-prelude';
    case 'control-condition':
      return 'scss-condition';
    case 'declaration-value':
    case 'interpolation':
    case 'variable-reference':
      return 'scss-value';
    default:
      return undefined;
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
  if (isScannerFirstProbeOptions(option)) {
    return option;
  }
  return undefined;
}

function isScannerFirstProbeOptions(value: unknown): value is ScannerFirstProbeOptions {
  return typeof value === 'object' && value !== null;
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

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}
