import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mergeWith } from 'lodash-es';
import { getConfigWithMeta, type ConfigWithMeta } from './config.js';
import {
  Context,
  type ContextOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  JessError,
  toDiagnostic,
  evalErrorFrameFrom,
  WARN,
  logger,
  Deprecation,
  type WarningsConfigInput,
  type ErrorsConfigInput,
  serialize,
  prepareStaticImports,
  buildAstSourceMap,
  removeSourceMapBasepath,
  type PreparedImports,
  type PluginInterface,
  type Position,
  type SourceSettings
} from '@jesscss/core';
import type { Stylesheet } from '@jesscss/core/ast';
import {
  getOptions,
  applyStrictPreset,
  inferLanguage,
  type StylesConfig,
  type OutputOptions
} from 'styles-config';
import { outputDiagnostics } from './diagnostics.js';

export type ConfigOptions = StylesConfig & {
  /** Output file path for matching against output config options */
  outputFile?: string;

  /** Suppress warnings (similar to Less's suppressWarnings option) */
  suppressWarnings?: boolean;

  /** Break on first error (stop processing after first error). Default: true */
  breakOnError?: boolean;

  /** Show detailed reason and fix in diagnostics. Default: false */
  verbose?: boolean;

  /** Emit ANSI color and terminal hyperlinks in diagnostics. Default: true */
  colors?: boolean;

  /** Deprecation warnings of these types will cause an error to be thrown */
  fatalDeprecations?: Iterable<Deprecation>;

  /** Whether to limit repetition of deprecation warnings (max 5). Default: true */
  limitDeprecationRepetition?: boolean;

  /** Warning-display config (scalar tier or object). Default tier: `line`. */
  warnings?: WarningsConfigInput;

  /** Error-display config (scalar tier or object). Default tier: `frame`. */
  errors?: ErrorsConfigInput;
};

const { isArray } = Array;

function thrownMessage(err: unknown): string {
  return err instanceof JessError
    ? err.message
    : err instanceof Error
      ? err.message
      : String(err);
}

async function readOptionalBinary(context: Context, specifier: string): Promise<Uint8Array | null> {
  try {
    return await context.readBinary(specifier);
  } catch (error) {
    if (error instanceof JessError && error.code === 'import/not-found') {
      return null;
    }
    throw error;
  }
}

/**
 * Build the `internal/unknown` diagnostic for a generic (non-`JessError`) error
 * that escaped eval. The eval dispatch stamps the offending node's source span
 * onto such errors; `evalErrorFrameFrom` recovers it so the diagnostic frames
 * the real line/column/source instead of the `1:1`/empty-frame fallback.
 */
function internalUnknownDiagnostic(
  err: unknown,
  errMsg: string,
  filePath: string | undefined,
  fallbackReason: string
): ErrorDiagnostic {
  const frame = evalErrorFrameFrom(err);
  return {
    code: 'internal/unknown',
    phase: 'eval',
    message: errMsg || 'Unknown error',
    reason: errMsg || fallbackReason,
    fix: 'Check the file and ensure it is valid.',
    filePath,
    line: frame?.line ?? 1,
    column: frame?.column ?? 1,
    lines: frame?.lines,
    ...(frame?.note === undefined ? {} : { note: frame.note })
  };
}

/** The normalized object form of the `output.sourceMap` option. */
type SourceMapConfig = Exclude<NonNullable<OutputOptions['sourceMap']>, boolean>;

/** The generated CSS plus, when source maps are on, the v3 map and its URL. */
export interface RenderedStylesheet {
  css: string;

  /** v3 source map JSON (external form), when source maps are enabled. */
  map?: string;

  /**
   * The external map's URL, basepath-stripped. The annotation names it, except
   * that `sourceMapFileInline` writes a `data:` URI and
   * `disableSourcemapAnnotation` writes nothing; it is returned either way.
   */
  sourceMapURL?: string;
}

/**
 * Assemble the source map + CSS annotation from the render's position stream.
 *
 * Sources are relative to the input file's directory unless `sourceMapBasepath`
 * is given; the map's `file` is the output CSS name (`<input>.css` when none is
 * known); the annotation URL is `sourceMapURL`, else `sourceMapFilename`, else
 * that output name + `.map`, appended with no trailing newline;
 * `sourceMapFileInline` embeds the map as a base64 `data:` URI;
 * `disableSourcemapAnnotation` writes nothing; and empty output gets neither a
 * map nor an annotation. Like Less 4.x (`source-map-builder.js`), the basepath
 * is stripped from the annotation URL as from every source. The corpus
 * `sourcemaps*` fixtures (goldens and expected maps) pin these. The external
 * `.map` string is returned for callers that write it to disk — this compiler
 * has no file-writing CLI.
 */
function assembleSourceMap(
  css: string,
  positions: Position[],
  option: SourceMapConfig,
  inputFilePath: string | undefined,
  outputFilePath: string | undefined
): RenderedStylesheet {
  if (css.length === 0) {
    return { css };
  }
  const outputFilename = option.sourceMapOutputFilename
    ?? (outputFilePath === undefined
      ? (inputFilePath === undefined ? 'output.css' : `${path.basename(inputFilePath, path.extname(inputFilePath))}.css`)
      : path.basename(outputFilePath));
  const basepath = (option.sourceMapBasepath
    ?? (inputFilePath === undefined ? undefined : path.dirname(path.resolve(inputFilePath))))?.replace(/\\/g, '/');
  const encoded = buildAstSourceMap(css, positions, {
    outputFilename,
    sourceMapRootpath: option.sourceMapRootpath,
    sourceMapBasepath: basepath,
    outputSourceFiles: option.outputSourceFiles
  });
  const map = JSON.stringify(encoded);

  const url = option.sourceMapURL
    ?? option.sourceMapFilename?.replace(/\\/g, '/')
    ?? (option.sourceMapFullFilename === undefined ? undefined : path.basename(option.sourceMapFullFilename))
    ?? (inputFilePath === undefined && outputFilePath === undefined && option.sourceMapOutputFilename === undefined
      ? undefined
      : `${outputFilename}.map`);
  const sourceMapURL = url === undefined ? undefined : removeSourceMapBasepath(url, basepath);
  const annotationURL = option.sourceMapFileInline === true
    ? `data:application/json;base64,${Buffer.from(map, 'utf8').toString('base64')}`
    : sourceMapURL;
  const annotatedCss = option.disableSourcemapAnnotation !== true && annotationURL !== undefined
    ? `${css}/*# sourceMappingURL=${annotationURL} */`
    : css;

  return { css: annotatedCss, map, sourceMapURL };
}

/**
 * Context records a plugin diagnostic before it throws the corresponding
 * JessError. Public compiler result methods begin with that recorded list, so
 * only append the thrown conversion when it is a distinct diagnostic. This
 * preserves independent sites while avoiding a second copy of one parser (or
 * context-owned) failure.
 */
function sameDiagnosticSite(
  left: ErrorDiagnostic | WarningDiagnostic,
  right: ErrorDiagnostic | WarningDiagnostic
): boolean {
  return left.code === right.code
    && left.phase === right.phase
    && left.message === right.message
    && left.reason === right.reason
    && left.fix === right.fix
    && left.note === right.note
    && left.filePath === right.filePath
    && left.line === right.line
    && left.column === right.column;
}

function appendThrownJessDiagnostic(
  errors: ErrorDiagnostic[],
  warnings: WarningDiagnostic[],
  error: JessError
): void {
  const diagnostic = toDiagnostic(error);
  const target = 'errors' in diagnostic ? errors : warnings;
  if (!target.some(existing => sameDiagnosticSite(existing, diagnostic))) {
    target.push(diagnostic);
  }
}

type PluginFactoryCacheKey = string;
type LazyPluginInterface = PluginInterface;
type ExecutablePluginInterface = PluginInterface & {
  importPlugin(absoluteFilePath: string, options?: string | null): Promise<unknown>;
};
type ProfileMemorySnapshot = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};
type RenderProfile = {
  id: number;
  label: string;
  metadata: Record<string, unknown>;
  startedAtMs: number;
  startedMemory: ProfileMemorySnapshot;
  phases: Array<{
    phase: string;
    durationMs: number;
    memoryDelta: ProfileMemorySnapshot;
  }>;
};

type PluginFactoryRecord = {
  name: string;
  create: (overrideConfig?: JsPluginConfig & { runtimeApi?: string }) => PluginInterface;
};

type JsPluginConfig = {
  allowHttp?: boolean;
  allowNetHosts?: string[];
  jsReadRoot?: string;
};

export type CompilerPluginContext = {
  filePath?: string;
  configFilePath?: string;
  effectiveConfig: ConfigOptions;
  activeOptions: Record<string, unknown>;
  resolvedOutputFilePath?: string;
  language?: string;
  resolutionBaseDir?: string;
  optionsFor(language?: string): Record<string, unknown>;

  /**
   * The options `configFilePath` alone sets (empty when no config file was
   * found), so a plugin can name that file when one of its values is invalid.
   */
  configFileOptionsFor(language?: string): Record<string, unknown>;
};

export type CompilerHooks = {
  defaultPlugins?(context: CompilerPluginContext): readonly PluginInterface[];
  normalizeConfiguredPlugin?(plugin: PluginInterface, context: CompilerPluginContext): PluginInterface;

  /**
   * Rewrite the entry source before it is parsed. The object form keeps the
   * authored source unchanged at `sourceOffset`, with any injected text ahead
   * of it and after it, so source maps still point into, and embed, the file as
   * written.
   */
  prepareSource?(
    source: string,
    context: CompilerPluginContext
  ): string | { source: string; sourceOffset: number };
  scriptPluginSpecifier?: string | false;
  scriptPluginResolveFrom?: string | URL;
};

type ResolvedRenderConfig = {
  filePath?: string;
  configFilePath?: string;
  effectiveConfig: ConfigOptions;
  activeOptions: Record<string, unknown>;
  resolvedOutputFilePath?: string;
  jsPluginConfig: JsPluginConfig;
  printOptions: {
    collapseNesting?: boolean | 'native' | 'compact';
    compress?: boolean;
    sourceMap?: OutputOptions['sourceMap'];
  };

  /** Dialect of this render's entry source; selects the built-in fn set. */
  language?: string;
  optionsFor(language?: string): Record<string, unknown>;
  configFileOptionsFor(language?: string): Record<string, unknown>;

  /** The compile modes passed to the compiler or the render; the Context's own. */
  explicitModes: NonNullable<StylesConfig['compile']>;

  /** The settings covering one source file; see `ContextOptions.sourceOptions`. */
  sourceOptions(filePath: string, language: string): SourceSettings;
};

const isSourceMapOption = (value: unknown): value is NonNullable<OutputOptions['sourceMap']> =>
  typeof value === 'boolean' || (typeof value === 'object' && value !== null);

/** The prepared entry source, and where the authored source sits in it. */
const preparedSourceOf = (
  prepared: string | { source: string; sourceOffset: number },
  authored: string
): { source: string; sourceOffset: number; sourceEnd?: number } =>
  typeof prepared === 'string'
    ? { source: prepared, sourceOffset: 0 }
    : { ...prepared, sourceEnd: prepared.sourceOffset + authored.length };

/**
 * Serialize accepts only `false | 'native' | 'compact'`; `collapseNesting: true`
 * is a deprecated alias for `'native'`. Normalize the config value here.
 */
const collapseNestingFor = (
  value: boolean | 'native' | 'compact' | undefined
): false | 'native' | 'compact' => (value === true ? 'native' : (value ?? false));

const createBaseConfig = (): ConfigOptions => ({
  compile: {},
  output: {},
  language: {}
});

/**
 * Customizer for mergeWith that concatenates arrays instead of replacing them
 */
function arrayConcatCustomizer(objValue: unknown, srcValue: unknown): unknown {
  if (isArray(objValue) && isArray(srcValue)) {
    return [...objValue, ...srcValue];
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (!isObjectRecord(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isPluginInterface(value: unknown): value is PluginInterface {
  return isObjectRecord(value) && typeof value.name === 'string';
}

function isExecutablePluginInterface(value: PluginInterface): value is ExecutablePluginInterface {
  return typeof value.importPlugin === 'function';
}

function getSearchPaths(options: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(options.searchPaths)) {
    return options.searchPaths.filter((value): value is string => typeof value === 'string');
  }
  if (Array.isArray(options.paths)) {
    return options.paths.filter((value): value is string => typeof value === 'string');
  }
  return undefined;
}

let nextRenderProfileId = 0;

const isProfileEnabled = (): boolean => process.env.JESS_PROFILE === '1';

const nowMs = (): number => Number(process.hrtime.bigint()) / 1_000_000;

const getMemorySnapshot = (): ProfileMemorySnapshot => {
  const { rss, heapTotal, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapTotal, heapUsed, external, arrayBuffers };
};

const diffMemorySnapshot = (
  before: ProfileMemorySnapshot,
  after: ProfileMemorySnapshot
): ProfileMemorySnapshot => ({
  rss: after.rss - before.rss,
  heapTotal: after.heapTotal - before.heapTotal,
  heapUsed: after.heapUsed - before.heapUsed,
  external: after.external - before.external,
  arrayBuffers: after.arrayBuffers - before.arrayBuffers
});

const createRenderProfile = (
  label: string,
  metadata: Record<string, unknown> = {}
): RenderProfile | undefined => {
  if (!isProfileEnabled()) {
    return undefined;
  }
  return {
    id: ++nextRenderProfileId,
    label,
    metadata,
    startedAtMs: nowMs(),
    startedMemory: getMemorySnapshot(),
    phases: []
  };
};

const measureProfileSync = <T>(
  profile: RenderProfile | undefined,
  phase: string,
  fn: () => T
): T => {
  if (!profile) {
    return fn();
  }
  const startedAt = nowMs();
  const startedMemory = getMemorySnapshot();
  try {
    return fn();
  } finally {
    const endedAt = nowMs();
    const endedMemory = getMemorySnapshot();
    profile.phases.push({
      phase,
      durationMs: endedAt - startedAt,
      memoryDelta: diffMemorySnapshot(startedMemory, endedMemory)
    });
  }
};

const measureProfileAsync = async <T>(
  profile: RenderProfile | undefined,
  phase: string,
  fn: () => Promise<T>
): Promise<T> => {
  if (!profile) {
    return fn();
  }
  const startedAt = nowMs();
  const startedMemory = getMemorySnapshot();
  try {
    return await fn();
  } finally {
    const endedAt = nowMs();
    const endedMemory = getMemorySnapshot();
    profile.phases.push({
      phase,
      durationMs: endedAt - startedAt,
      memoryDelta: diffMemorySnapshot(startedMemory, endedMemory)
    });
  }
};

const finalizeRenderProfile = (
  profile: RenderProfile | undefined,
  extraMetadata: Record<string, unknown> = {}
) => {
  if (!profile) {
    return;
  }
  const endedAtMs = nowMs();
  const endedMemory = getMemorySnapshot();
  console.error(`[jess-profile] ${JSON.stringify({
    id: profile.id,
    label: profile.label,
    metadata: {
      ...profile.metadata,
      ...extraMetadata
    },
    totalDurationMs: endedAtMs - profile.startedAtMs,
    totalMemoryDelta: diffMemorySnapshot(profile.startedMemory, endedMemory),
    phases: profile.phases
  })}`);
};

const createConsumerRequire = (fromDir?: string) => {
  const baseDir = fromDir ? path.resolve(fromDir) : process.cwd();
  return createRequire(path.join(baseDir, '__jess_consumer__.js'));
};

const resolveFromConsumer = (specifier: string, fromDir?: string): string | undefined => {
  try {
    return createConsumerRequire(fromDir).resolve(specifier);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw err;
  }
};

const resolveFromModule = (specifier: string, moduleUrl: string | URL = import.meta.url): string | undefined => {
  try {
    return createRequire(moduleUrl).resolve(specifier);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw err;
  }
};

const resolvePackageImportEntry = (
  specifier: string,
  fromDir?: string,
  moduleUrl?: string | URL
): string | undefined => {
  const resolvePackageJson = (requireFrom: NodeRequire) => {
    try {
      return requireFrom.resolve(`${specifier}/package.json`);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
        return undefined;
      }
      throw err;
    }
  };
  const packageJsonPath = resolvePackageJson(createConsumerRequire(fromDir))
    ?? (moduleUrl === undefined ? undefined : resolvePackageJson(createRequire(moduleUrl)))
    ?? resolvePackageJson(createRequire(import.meta.url));
  if (!packageJsonPath) {
    return undefined;
  }
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as unknown;
  const moduleEntry = packageJson
    && typeof packageJson === 'object'
    && 'module' in packageJson
    && typeof packageJson.module === 'string'
    ? packageJson.module
    : undefined;
  const rootExport = packageJson
    && typeof packageJson === 'object'
    && 'exports' in packageJson
    && packageJson.exports
    && typeof packageJson.exports === 'object'
    && '.' in packageJson.exports
    ? packageJson.exports['.']
    : undefined;
  const rawImport = rootExport !== null && typeof rootExport === 'object' && 'import' in rootExport
    ? (rootExport as Record<string, unknown>).import
    : undefined;
  const exportImport = typeof rawImport === 'string' ? rawImport : undefined;
  const entry = moduleEntry ?? exportImport;
  if (!entry) {
    return undefined;
  }
  return path.resolve(packageRoot, entry);
};

const resolveJsReadRoot = (
  filePath: string | undefined,
  configFilePath: string | undefined,
  explicitReadRoot: string | undefined
): string => {
  if (explicitReadRoot) {
    return path.resolve(explicitReadRoot);
  }
  const entryRoot = filePath ? path.resolve(path.dirname(filePath)) : undefined;
  const configRoot = configFilePath ? path.resolve(path.dirname(configFilePath)) : undefined;
  if (entryRoot && configRoot) {
    if (entryRoot.startsWith(`${configRoot}${path.sep}`) || entryRoot === configRoot) {
      return configRoot;
    }
    if (configRoot.startsWith(`${entryRoot}${path.sep}`) || configRoot === entryRoot) {
      return entryRoot;
    }
    return configRoot.length < entryRoot.length ? configRoot : entryRoot;
  }
  return entryRoot ?? configRoot ?? process.cwd();
};

const getConsumerResolutionBaseDir = (
  filePath: string | undefined,
  configFilePath: string | undefined
): string | undefined => {
  if (filePath) {
    return path.dirname(filePath);
  }
  if (configFilePath) {
    return path.dirname(configFilePath);
  }
  return process.cwd();
};

export class Compiler {
  /** @internal */
  public opts: ConfigOptions;
  private baseOptsNormalized: ConfigOptions;
  private configuredPluginFactoryCache = new Map<PluginFactoryCacheKey, Promise<PluginFactoryRecord>>();
  private jsPluginFactoryCache = new Map<PluginFactoryCacheKey, Promise<PluginFactoryRecord>>();
  private jsPluginProxyCache = new Map<PluginFactoryCacheKey, LazyPluginInterface>();

  constructor(opts: ConfigOptions = {
      compile: {},
      output: {},
      language: {}
    },
  private readonly hooks: CompilerHooks = {}
  ) {
    this.opts = opts;
    this.baseOptsNormalized = mergeWith(
      createBaseConfig(),
      opts,
      arrayConcatCustomizer
    );
  }

  private resolveEffectiveConfig(
    filePath?: string,
    renderOptions?: Partial<ConfigOptions>,
    parseInput: { language?: string; extension?: string } = {}
  ): ResolvedRenderConfig {
    const entryFolder: ConfigWithMeta = filePath ? getConfigWithMeta(path.dirname(filePath)) : { config: {} };
    const { config: loadedFileConfig, configFilePath } = entryFolder;
    const explicitConfig: ConfigOptions = mergeWith(
      createBaseConfig(),
      this.baseOptsNormalized,
      renderOptions || {},
      arrayConcatCustomizer
    );
    const effectiveConfig: ConfigOptions = mergeWith(
      createBaseConfig(),
      loadedFileConfig,
      explicitConfig,
      arrayConcatCustomizer
    );

    /*
     * Expand the `strict` convenience preset once, on the compile config, so the
     * non-mode option it sets (`allowOverloadedImport`) reaches the Context; the
     * modes it sets are read per source file, below. Individual options already
     * set always win.
     */
    if (effectiveConfig.compile?.strict) {
      effectiveConfig.compile = applyStrictPreset(effectiveConfig.compile);
    }

    /*
     * Compile settings resolve per source file (DESIGN-DECISIONS C19). A file's
     * settings are its nearest `styles.config` merged under the settings passed
     * to the compiler and the render, which win field by field (O13). On that
     * merge they are computed for the file's language: its language's defaults,
     * under the `compile` settings (the `strict` preset filling only what nothing
     * sets), under `language.<lang>`. The Context asks for them once per parsed
     * file, through `sourceOptions`; the compile modes passed in are its own
     * mode options only for a source it has no settings for.
     */
    const explicitModes = explicitConfig.compile ?? {};
    const sourceOptions = (sourcePath: string, sourceLanguage: string): SourceSettings => {
      /*
       * A config file is code: none is loaded for a file in an installed
       * package, so compiling a project never runs a dependency's config.
       */
      const folder: ConfigWithMeta = sourcePath === filePath
        ? entryFolder
        : path.isAbsolute(sourcePath) && !sourcePath.split(path.sep).includes('node_modules')
          ? getConfigWithMeta(path.dirname(sourcePath))
          : { config: {} };
      const params = { language: sourceLanguage, input: sourcePath };

      /*
       * ponytail: an invalid value is reported against the nearest config file
       * only when that file sets it itself; one a config above it sets names no
       * file. Pass every file with its own settings if that location is needed.
       */
      return {
        options: getOptions([folder.config, explicitConfig], params),
        configFile: folder.configFilePath === undefined
          ? undefined
          : { path: folder.configFilePath, options: getOptions(folder.ownConfig ?? {}, params) }
      };
    };
    const jsPluginConfig: JsPluginConfig = {
      jsReadRoot: resolveJsReadRoot(filePath, configFilePath, effectiveConfig.compile?.jsReadRoot)
    };
    let resolvedOutputFilePath: string | undefined = renderOptions?.outputFile;
    if (!resolvedOutputFilePath) {
      if (Array.isArray(effectiveConfig.output)) {
        // If output is an array, we need the expected output file path to match
      } else if (effectiveConfig.output && !Array.isArray(effectiveConfig.output) && effectiveConfig.output.file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, effectiveConfig.output.file.replace('{name}', name));
      } else if (renderOptions?.output && !Array.isArray(renderOptions.output) && 'file' in renderOptions.output && renderOptions.output.file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, renderOptions.output.file.replace('{name}', name));
      }
    }
    const configInputPath = filePath ?? (
      parseInput.extension
        ? `virtual${parseInput.extension.startsWith('.') ? parseInput.extension : `.${parseInput.extension}`}`
        : undefined
    );
    const activeOptions = getOptions(effectiveConfig, {
      language: parseInput.language,
      input: configInputPath,
      output: resolvedOutputFilePath
    });

    /*
     * The entry source's dialect: an explicit `language` wins, else the file (or
     * virtual `.ext`) extension, via the same map option resolution uses.
     */
    const language = parseInput.language ?? inferLanguage(configInputPath);

    /*
     * Resolve one `output` option, honored whether or not an `outputFile`
     * selects a specific array entry. A render-time output (an object, or the
     * file-less array entry the config merge appends) overrides a file-local
     * config the same way for EVERY key — collapseNesting, compress, and
     * sourceMap alike — so the projection/serialization options can be combined
     * in one render. Returns undefined when nothing sets the key; the caller
     * applies its own fallback.
     */
    const readOutput = <K extends keyof OutputOptions>(key: K): OutputOptions[K] | undefined => {
      const output = effectiveConfig.output;
      if (!Array.isArray(output)) {
        return output?.[key];
      }
      const isObj = (e: OutputOptions | undefined): e is OutputOptions =>
        !!e && typeof e === 'object';
      const defaults = output.find(e => isObj(e) && !('file' in e));

      if (resolvedOutputFilePath) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        for (const entry of output) {
          if (!isObj(entry) || !('file' in entry)) {
            continue;
          }
          const pattern = String(entry.file ?? '{name}.css');
          if (path.join(dir, pattern.replace('{name}', name)) === resolvedOutputFilePath) {
            if (key in entry) {
              return entry[key];
            }
            return defaults?.[key];
          }
        }
        return undefined;
      }

      /*
       * No target selects an entry. `activeOptions` already absorbs file-less
       * defaults entries (via getMatchingOptions), but not `file`-bearing ones —
       * so honor a file-less default here, else a lone file entry's flag. Stay
       * out of it when several file entries disagree (fall to the default).
       */
      if (defaults && key in defaults) {
        return defaults[key];
      }
      const flagged = output.filter(e => isObj(e) && 'file' in e && key in e);
      return flagged.length === 1 ? flagged[0]![key] : undefined;
    };

    /*
     * Resolve all three output options here. `compress` and `sourceMap` also
     * honor the less.js `language.less.*` shape surfaced on `activeOptions`;
     * `sourceMap` keeps its object form so the sub-options survive.
     */
    const lessSourceMap: unknown = activeOptions.sourceMap;
    const printOptions = {
      collapseNesting: readOutput('collapseNesting') ?? activeOptions.collapseNesting,
      compress: readOutput('compress')
        ?? (typeof activeOptions.compress === 'boolean' ? activeOptions.compress : undefined),
      sourceMap: readOutput('sourceMap') ?? (isSourceMapOption(lessSourceMap) ? lessSourceMap : undefined)
    };

    return {
      filePath,
      configFilePath,
      effectiveConfig,
      activeOptions,
      resolvedOutputFilePath,
      jsPluginConfig,
      printOptions,
      language,
      explicitModes,
      sourceOptions,
      optionsFor: (targetLanguage?: string) =>
        getOptions(effectiveConfig, {
          language: targetLanguage,
          input: configInputPath,
          output: resolvedOutputFilePath
        }) as Record<string, unknown>,
      configFileOptionsFor: (targetLanguage?: string) =>
        getOptions(entryFolder.ownConfig ?? {}, {
          language: targetLanguage,
          input: configInputPath,
          output: resolvedOutputFilePath
        }) as Record<string, unknown>
    };
  }

  private getConfiguredPluginFactory(specifier: string): Promise<PluginFactoryRecord> {
    let factoryPromise = this.configuredPluginFactoryCache.get(specifier);
    if (!factoryPromise) {
      factoryPromise = import(specifier).then((mod: Record<string, unknown>) => {
        const pluginFactoryOrInstance = mod.default ?? mod.plugin ?? mod;
        if (typeof pluginFactoryOrInstance === 'function') {
          return {
            name: specifier,
            create: (): PluginInterface => {
              const plugin = pluginFactoryOrInstance();
              if (!isPluginInterface(plugin)) {
                throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
              }
              return plugin;
            }
          };
        }
        if (!isPluginInterface(pluginFactoryOrInstance)) {
          throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
        }
        return {
          name: pluginFactoryOrInstance.name,
          create: (): PluginInterface => pluginFactoryOrInstance
        };
      });
      this.configuredPluginFactoryCache.set(specifier, factoryPromise);
    }
    return factoryPromise;
  }

  private createConfiguredPluginProxy(specifier: string): LazyPluginInterface {
    let factoryPromise: Promise<PluginFactoryRecord> | undefined;
    let pluginPromise: Promise<PluginInterface> | undefined;
    let loadedPlugin: PluginInterface | undefined;
    const getFactory = (): Promise<PluginFactoryRecord> => {
      factoryPromise ??= this.getConfiguredPluginFactory(specifier);
      return factoryPromise;
    };
    const getPlugin = async (): Promise<PluginInterface> => {
      if (!pluginPromise) {
        pluginPromise = getFactory().then((factory) => {
          loadedPlugin = factory.create();
          return loadedPlugin;
        });
      }
      return pluginPromise;
    };

    const base: LazyPluginInterface = {
      name: specifier,
      prewarm: async () => {
        const plugin = await getPlugin();
        await plugin.prewarm?.();
      }
    };

    return new Proxy<LazyPluginInterface>(base, {
      get(target, prop, receiver) {
        if (prop === 'name' && loadedPlugin?.name) {
          return loadedPlugin.name;
        }
        if (Reflect.has(target, prop)) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? value.bind(receiver) : value;
        }
        if (!loadedPlugin) {
          return undefined;
        }
        const value = Reflect.get(loadedPlugin, prop, loadedPlugin) as unknown;
        return typeof value === 'function' ? value.bind(loadedPlugin) : value;
      }
    });
  }

  private getJsPluginFactory(
    jsConfig: JsPluginConfig,
    resolutionBaseDir?: string
  ): { key: PluginFactoryCacheKey; factoryPromise: Promise<PluginFactoryRecord>; resolvedSpecifier: string } | undefined {
    const specifier = this.scriptPluginSpecifier;
    if (!specifier) {
      return undefined;
    }
    const resolvedSpecifier = resolvePackageImportEntry(specifier, resolutionBaseDir, this.hooks.scriptPluginResolveFrom)
      ?? resolveFromConsumer(specifier, resolutionBaseDir)
      ?? resolveFromModule(specifier, this.hooks.scriptPluginResolveFrom);
    if (!resolvedSpecifier) {
      return undefined;
    }
    const key = stableStringify({
      resolvedSpecifier,
      jsConfig
    });
    let factoryPromise = this.jsPluginFactoryCache.get(key);
    if (!factoryPromise) {
      factoryPromise = import(pathToFileURL(resolvedSpecifier).href).then((mod: Record<string, unknown>) => {
        const pluginFactory = mod.default ?? mod;
        if (typeof pluginFactory !== 'function') {
          throw new Error(`${specifier} did not resolve to a plugin factory`);
        }
        return {
          name: 'js',
          create: (overrideConfig) => {
            const plugin = pluginFactory(overrideConfig ?? jsConfig);
            if (!isPluginInterface(plugin)) {
              throw new Error(`${specifier} did not resolve to a valid plugin instance`);
            }
            return plugin;
          }
        };
      });
      this.jsPluginFactoryCache.set(key, factoryPromise);
    }
    return {
      key,
      factoryPromise,
      resolvedSpecifier
    };
  }

  private createJsPluginProxy(
    jsConfig: JsPluginConfig,
    resolutionBaseDir?: string
  ): LazyPluginInterface | undefined {
    const factoryRecord = this.getJsPluginFactory(jsConfig, resolutionBaseDir);
    if (!factoryRecord) {
      return undefined;
    }
    const cachedProxy = this.jsPluginProxyCache.get(factoryRecord.key);
    if (cachedProxy) {
      return cachedProxy;
    }

    let pluginPromise: Promise<PluginInterface> | undefined;
    let loadedPlugin: PluginInterface | undefined;
    let scriptRuntimePluginPromise: Promise<PluginInterface> | undefined;
    const scriptPluginLabel = this.scriptPluginSpecifier ?? 'the configured script plugin';
    const getPlugin = async (): Promise<PluginInterface> => {
      if (!pluginPromise) {
        pluginPromise = factoryRecord.factoryPromise.then((factory) => {
          loadedPlugin = factory.create();
          return loadedPlugin;
        });
      }
      return pluginPromise;
    };
    const getScriptRuntimePlugin = async (): Promise<PluginInterface> => {
      if (!scriptRuntimePluginPromise) {
        scriptRuntimePluginPromise = factoryRecord.factoryPromise.then(factory =>
          factory.create({
            ...jsConfig,
            runtimeApi: 'less'
          }));
      }
      return scriptRuntimePluginPromise;
    };

    const proxy: LazyPluginInterface = {
      name: 'js',
      supportedExtensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
      import: async (absoluteFilePath) => {
        const plugin = await getPlugin();
        if (!plugin.import) {
          throw new Error(`Feature not supported. Install ${scriptPluginLabel} to enable script execution features.`);
        }
        return plugin.import(absoluteFilePath);
      },
      importPlugin: async (absoluteFilePath: string, options?: string | null) => {
        const plugin = await getScriptRuntimePlugin();
        if (!isExecutablePluginInterface(plugin)) {
          throw new Error(`Feature not supported. Install ${scriptPluginLabel} to enable executable plugin modules.`);
        }
        return plugin.importPlugin(absoluteFilePath, options);
      },
      dispose: async () => {
        const plugins = await Promise.all([
          pluginPromise?.catch(() => undefined),
          scriptRuntimePluginPromise?.catch(() => undefined)
        ]);
        for (const plugin of plugins) {
          await plugin?.dispose?.();
        }
      }
    };
    this.jsPluginProxyCache.set(factoryRecord.key, proxy);
    return proxy;
  }

  private buildPlugins(resolved: ResolvedRenderConfig): PluginInterface[] {
    const pluginMap = new Map<string, PluginInterface>();
    const resolutionBaseDir = getConsumerResolutionBaseDir(resolved.filePath, resolved.configFilePath);
    const pluginContext = this.createPluginContext(resolved, resolutionBaseDir);

    for (const plugin of this.hooks.defaultPlugins?.(pluginContext) ?? []) {
      pluginMap.set(plugin.name, plugin);
    }

    const configuredPlugins = resolved.effectiveConfig.compile?.plugins;
    if (configuredPlugins) {
      for (const plugin of configuredPlugins) {
        if (typeof plugin === 'string') {
          const scriptPluginSpecifier = this.scriptPluginSpecifier;
          if (scriptPluginSpecifier && plugin === scriptPluginSpecifier) {
            const jsPlugin = this.createJsPluginProxy(resolved.jsPluginConfig, resolutionBaseDir);
            if (jsPlugin) {
              pluginMap.set(jsPlugin.name, jsPlugin);
            }
            continue;
          }
          pluginMap.set(plugin, this.createConfiguredPluginProxy(plugin));
          continue;
        }
        if (!isPluginInterface(plugin)) {
          throw new Error('Configured plugin did not resolve to a valid plugin instance');
        }
        const normalized = this.hooks.normalizeConfiguredPlugin?.(plugin, pluginContext) ?? plugin;
        pluginMap.set(normalized.name, normalized);
      }
    }

    const scriptPluginSpecifier = this.scriptPluginSpecifier;
    if (scriptPluginSpecifier && pluginMap.has('js')) {
      try {
        const consumerRequire = createConsumerRequire(resolutionBaseDir);
        consumerRequire(scriptPluginSpecifier);
      } catch {
        // optional: script plugin may be missing; script imports throw at runtime if used
      }
    }

    return [...pluginMap.values()];
  }

  private get scriptPluginSpecifier(): string | undefined {
    return this.hooks.scriptPluginSpecifier === false
      ? undefined
      : this.hooks.scriptPluginSpecifier;
  }

  private createPluginContext(
    resolved: ResolvedRenderConfig,
    resolutionBaseDir: string | undefined
  ): CompilerPluginContext {
    return {
      filePath: resolved.filePath,
      configFilePath: resolved.configFilePath,
      effectiveConfig: resolved.effectiveConfig,
      activeOptions: resolved.activeOptions,
      resolvedOutputFilePath: resolved.resolvedOutputFilePath,
      language: resolved.language,
      resolutionBaseDir,
      optionsFor: resolved.optionsFor,
      configFileOptionsFor: resolved.configFileOptionsFor
    };
  }

  private createContextFromResolved(resolved: ResolvedRenderConfig, plugins: PluginInterface[]): Context {
    const searchPaths = getSearchPaths(resolved.activeOptions)
      ?? getSearchPaths(resolved.effectiveConfig.compile ?? {});
    const explicit = resolved.explicitModes;
    const contextOptions: ContextOptions & Record<string, unknown> = {
      ...resolved.effectiveConfig.compile,
      ...resolved.activeOptions,
      ...(searchPaths ? { searchPaths } : {}),

      /*
       * The Context's mode options are the compile modes passed in alone, for a
       * source with no settings of its own; every parsed file, the entry
       * included, gets its settings through `sourceOptions`, so the entry's
       * config file and language settings never reach the files it imports. A parser
       * reads its other per-file settings (the selector policies) from
       * `sourceOptions` too, so the entry's copies spread above are never read
       * for another file.
       */
      mathMode: explicit.mathMode,
      unitMode: explicit.unitMode,
      functionMode: explicit.functionMode,
      allowLeakyScope: explicit.allowLeakyScope,
      leakyScope: explicit.leakyScope,
      allowCallerScope: explicit.allowCallerScope,
      bubbleRootAtRules: undefined,
      processImports: explicit.processImports,
      sourceOptions: resolved.sourceOptions
    };

    /*
     * Auto-wire a configured script plugin when it is resolvable: Less `@plugin` and
     * script-module imports lazily request an importer for the JS/TS extension
     * via `loadPluginForExtension`. When no script plugin is configured or
     * resolvable, the proxy factory returns undefined and core emits the
     * install gate for script execution. A user-configured
     * `loadPluginForExtension` (if any) still wins.
     */
    const userLoadPluginForExtension = contextOptions.loadPluginForExtension;
    const resolutionBaseDir = getConsumerResolutionBaseDir(resolved.filePath, resolved.configFilePath);
    const autoWireJsPlugin = (extension: string): PluginInterface | undefined => {
      if (!this.scriptPluginSpecifier) {
        return undefined;
      }
      const jsPlugin = this.createJsPluginProxy(resolved.jsPluginConfig, resolutionBaseDir);
      if (jsPlugin?.supportedExtensions?.includes(extension)) {
        return jsPlugin;
      }
      return undefined;
    };
    contextOptions.loadPluginForExtension = (extension: string) => {
      if (!userLoadPluginForExtension) {
        return autoWireJsPlugin(extension);
      }
      const fromUser = userLoadPluginForExtension(extension);
      if (fromUser instanceof Promise) {
        return Promise.resolve(fromUser).then(resolvedPlugin => resolvedPlugin ?? autoWireJsPlugin(extension));
      }
      return fromUser ?? autoWireJsPlugin(extension);
    };

    /*
     * `breakOnError` is a top-level render option (consumed by outputDiagnostics for
     * display), but eval-time collection-vs-throw also reads it off `context.opts`
     * (Context.getTree / the spine import fold). Thread it through so a render called
     * with `breakOnError: false` actually COLLECTS parse/resolution failures instead
     * of hard-throwing out of the whole render.
     */
    if (resolved.effectiveConfig.breakOnError !== undefined) {
      contextOptions.breakOnError = resolved.effectiveConfig.breakOnError;
    }
    const usesDeprecatedDisablePluginRule = Boolean(contextOptions.disablePluginRule);
    contextOptions.disableScriptModules = Boolean(contextOptions.disableScriptModules
      || contextOptions.disablePluginRule);
    contextOptions.output = {
      /*
       * All three projection/serialization options are resolved once in
       * resolveRenderConfig via readOutput — honoring a render-time output entry
       * over a file-local config for every key, and the object form of
       * `sourceMap` (basepath/rootpath/inline/…) — so a render can combine e.g.
       * `collapseNesting` with `sourceMap`. `compress` keeps its
       * `language.less.compress` (`activeOptions`) fallback, applied there.
       */
      compress: resolved.printOptions.compress,
      sourceMap: resolved.printOptions.sourceMap,
      collapseNesting: resolved.printOptions.collapseNesting
    };

    const context = new Context(contextOptions, plugins);

    /* Option deprecations are about the options, not a stylesheet, so they carry no source location. */
    if (usesDeprecatedDisablePluginRule) {
      const deprecation = Deprecation.fromId('disable-plugin-rule-option') ?? Deprecation.userAuthored;
      context.warnDeprecation(deprecation, WARN.deprecated({
        meta: { what: 'disablePluginRule', use: 'disableScriptModules', deprecation }
      }));
    }

    /*
     * Less 4.x `dumpLineNumbers` is accepted and otherwise ignored: v5 emits no
     * line-number comments or debug media queries. A falsy value is 4.x's "off"
     * and requests nothing, so only a real request warns.
     */
    if (contextOptions.dumpLineNumbers) {
      const deprecation = Deprecation.fromId('dump-line-numbers-option') ?? Deprecation.userAuthored;
      context.warnDeprecation(deprecation, WARN.deprecated({
        reason: '"dumpLineNumbers" is deprecated and has no effect: no line-number comments or debug media queries are emitted.',
        fix: 'Remove the option; use "sourceMap" to map the output back to its source.',
        meta: { what: 'dumpLineNumbers', use: 'sourceMap', deprecation }
      }));
    }

    /*
     * Less 4.x `insecure` let a remote import skip certificate checks. Remote
     * imports are https-only and always verify the certificate, so the option
     * is accepted and has no effect; a real request warns.
     */
    if (contextOptions.insecure) {
      const deprecation = Deprecation.fromId('insecure-option') ?? Deprecation.userAuthored;
      context.warnDeprecation(deprecation, WARN.deprecated({
        reason: '"insecure" is deprecated and has no effect: remote imports are https-only and always verify the server certificate.',
        fix: 'Remove the option.',
        meta: { what: 'insecure', use: 'https', deprecation }
      }));
    }
    return context;
  }

  private async prepareRender(
    filePath?: string,
    renderOptions?: Partial<ConfigOptions>,
    parseInput?: { language?: string; extension?: string }
  ) {
    const profile = createRenderProfile('prepareRender', { filePath });
    const resolved = measureProfileSync(profile, 'resolveEffectiveConfig', () =>
      this.resolveEffectiveConfig(filePath, renderOptions, parseInput));
    const plugins = measureProfileSync(profile, 'buildPlugins', () =>
      this.buildPlugins(resolved));
    const context = measureProfileSync(profile, 'createContextFromResolved', () =>
      this.createContextFromResolved(resolved, plugins));
    return { resolved, plugins, context, profile };
  }

  /**
   * Create a context with the configured plugins
   *
   * @internal
   */
  createContext(filePath?: string, renderOptions?: Partial<ConfigOptions>): Context {
    const resolved = this.resolveEffectiveConfig(filePath, renderOptions);
    const plugins = this.buildPlugins(resolved);
    return this.createContextFromResolved(resolved, plugins);
  }

  private async prewarmPlugins(context: Context) {
    for (const plugin of context.plugins) {
      await plugin.prewarm?.();
    }
  }

  /** Parse the source once through the Context-selected AST plugin. */
  private async prepareStylesheet(
    context: Context,
    resolved: ResolvedRenderConfig,
    input: { filePath?: string; source?: string; language?: string; extension?: string },
    profile?: RenderProfile
  ): Promise<Stylesheet> {
    const { filePath, source, language, extension } = input;
    const pluginContext = this.createPluginContext(
      resolved,
      getConsumerResolutionBaseDir(resolved.filePath, resolved.configFilePath)
    );

    await measureProfileAsync(profile, 'prewarmPlugins', () => this.prewarmPlugins(context));

    if (source != null) {
      const prepared = preparedSourceOf(this.hooks.prepareSource?.(source, pluginContext) ?? source, source);
      const parsed = await measureProfileAsync(profile, 'parseString', () =>
        context.parseString(prepared.source, {
          filePath,
          type: language,
          extension,
          sourceOffset: prepared.sourceOffset,
          sourceEnd: prepared.sourceEnd
        }));
      return parsed.node;
    }
    const loaded = this.hooks.prepareSource
      ? await measureProfileAsync(profile, 'getPreparedRootTree', async () => {
          const { resolvedPath } = await context.resolveImportPath(filePath!);
          const sourceGetter = context.plugins.find(plugin => plugin.getSource);
          if (!sourceGetter?.getSource) {
            throw new Error('No source getter found');
          }
          const rootSource = await sourceGetter.getSource(resolvedPath);
          const prepared = preparedSourceOf(this.hooks.prepareSource?.(rootSource, {
            ...pluginContext,
            filePath: resolvedPath
          }) ?? rootSource, rootSource);
          const parsed = await context.parseString(prepared.source, {
            filePath: resolvedPath,
            type: language,
            extension,
            sourceOffset: prepared.sourceOffset,
            sourceEnd: prepared.sourceEnd
          });
          if (parsed.node) {
            context.sourceTrees.set(resolvedPath, parsed.node);
          }
          return parsed;
        })
      : await measureProfileAsync(profile, 'getTree', () => context.getTree(filePath!));
    if (!loaded.node) {
      throw new Error(`Failed to load ${filePath!}`);
    }
    return loaded.node;
  }

  private activateDocumentPlugins(context: Context): void {
    const activePlugin = context.documentContext?.plugin;
    for (const plugin of context.plugins) {
      if (plugin !== activePlugin) {
        plugin.setContext?.(context);
      }
    }
    activePlugin?.setContext?.(context);
  }

  private prepareStaticImportsForStylesheet(
    document: Stylesheet,
    context: Context,
    profile?: RenderProfile
  ): Promise<PreparedImports> {
    return measureProfileAsync(profile, 'prepareStaticImports', () =>
      Promise.resolve(context.withDocument(document, () => {
        this.activateDocumentPlugins(context);
        return prepareStaticImports(document, {
          collapseNesting: collapseNestingFor(context.opts.output?.collapseNesting),
          context,
          pluginHost: context.pluginHost,
          io: { readFile: specifier => readOptionalBinary(context, specifier) }
        });
      })));
  }

  private async renderStylesheet(
    document: Stylesheet,
    context: Context,
    profile?: RenderProfile,
    preparedImports?: PreparedImports,
    files?: Pick<ResolvedRenderConfig, 'filePath' | 'resolvedOutputFilePath'>
  ): Promise<RenderedStylesheet> {
    const sourceMapOption = context.opts.output?.sourceMap;
    const trackPositions = Boolean(sourceMapOption);
    const result = await measureProfileAsync(profile, 'renderAstStylesheet', () =>
      Promise.resolve(context.withDocument(document, () => {
        this.activateDocumentPlugins(context);
        return serialize(document, {
          collapseNesting: collapseNestingFor(context.opts.output?.collapseNesting),
          compress: context.opts.output?.compress ?? false,
          context,
          pluginHost: context.pluginHost,
          io: { readFile: specifier => readOptionalBinary(context, specifier) },
          preparedImports,
          trackPositions
        });
      })));
    let css = result.css;
    for (const plugin of context.plugins || []) {
      if (plugin.runPostProcessors) {
        css = plugin.runPostProcessors(css, {});
      } else if (plugin.postProcessCss) {
        css = plugin.postProcessCss(css, context);
      }
    }
    if (!trackPositions || result.positions === undefined) {
      return { css };
    }

    /*
     * ponytail: positions index into the serialized CSS; a postprocessor that
     * rewrites `css` desyncs the map (same limitation as Less 4.x, whose map is
     * also built pre-postprocess). Regenerate through postprocessors if needed.
     */
    const option: SourceMapConfig = typeof sourceMapOption === 'object' ? sourceMapOption : {};
    return assembleSourceMap(css, result.positions, option, files?.filePath, files?.resolvedOutputFilePath);
  }

  /** @internal AST document preparation; no legacy evaluator tree is exposed. */
  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    const { resolved, context, profile } = await this.prepareRender(filePath, options);

    try {
      const document = await this.prepareStylesheet(context, resolved, { filePath }, profile);
      const preparedImports = await this.prepareStaticImportsForStylesheet(document, context, profile);

      if (context.errors.length > 0 || context.warningCount > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false,
          warnings: options?.warnings,
          errors: options?.errors,
          colors: options?.colors
        });
      }

      finalizeRenderProfile(profile, {
        method: 'compile',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount
      });
      return { document, context, preparedImports };
    } catch (err: unknown) {
      if (context.errors.length > 0 || context.warningCount > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false,
          warnings: options?.warnings,
          errors: options?.errors,
          colors: options?.colors
        });
      } else {
        logger.error(String(err));
      }
      finalizeRenderProfile(profile, {
        method: 'compile',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount,
        failed: true,
        errorMessage: thrownMessage(err)
      });
      throw err;
    }
  }

  /**
   * Emits whatever the render collected. A SUCCESSFUL render can still have
   * recorded real problems (a plugin function that threw, an unresolved
   * function); dropping those on the floor is how a broken plugin stays
   * invisible, so they are always surfaced here.
   */
  private reportCollected(context: Context, options?: Partial<ConfigOptions>): void {
    if (context.errors.length === 0 && context.warningCount === 0) {
      return;
    }
    outputDiagnostics(context.errors, context.warnings, {
      suppressWarnings: options?.suppressWarnings ?? false,
      breakOnError: options?.breakOnError ?? true,
      verbose: options?.verbose ?? false,
      warnings: options?.warnings,
      errors: options?.errors,
      colors: options?.colors
    });
  }

  async render(filePath: string, options?: Partial<ConfigOptions>) {
    const { resolved, context, profile } = await this.prepareRender(filePath, options);
    try {
      const input = { filePath };
      const { css } = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile,
        undefined,
        resolved
      );
      context.finalizeWarnings();
      this.reportCollected(context, options);
      finalizeRenderProfile(profile, {
        method: 'render',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount
      });
      return css;
    } catch (err: unknown) {
      this.reportCollected(context, options);
      if (!(err && typeof err === 'object' && 'code' in err)) {
        logger.error(String(err));
      }
      finalizeRenderProfile(profile, {
        method: 'render',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount,
        failed: true,
        errorMessage: thrownMessage(err)
      });
      throw err;
    }
  }

  async renderString(content: string, options: {
    filePath?: string;
    language?: string;
    extension?: string;
    config?: Partial<ConfigOptions>;
  } = {}) {
    const { filePath, language, extension, config: renderOptions } = options;
    const { resolved, context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const input = { filePath, source: content, language, extension };
      const { css } = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile,
        undefined,
        resolved
      );
      context.finalizeWarnings();
      this.reportCollected(context, renderOptions);
      finalizeRenderProfile(profile, {
        method: 'renderString',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount
      });
      return css;
    } catch (err: unknown) {
      this.reportCollected(context, renderOptions);
      if (!(err && typeof err === 'object' && 'code' in err)) {
        logger.error(String(err));
      }
      finalizeRenderProfile(profile, {
        method: 'renderString',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount,
        failed: true,
        errorMessage: thrownMessage(err)
      });
      throw err;
    }
  }

  async renderToResult(
    input: string | { source: string; filePath?: string; language?: string; extension?: string },

    /*
     * `language` here is the per-language config (`language.less`), as
     * everywhere in `ConfigOptions`. The entry's language name comes only from
     * the input object, else from the file extension.
     */
    options?: Partial<ConfigOptions>
  ): Promise<{
    css: string;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
    loadedUrls: string[];

    /** v3 source map JSON, present only when source maps are enabled. */
    map?: string;

    /** The `sourceMappingURL` written into the CSS annotation, when one is written. */
    sourceMapURL?: string;
  }> {
    const isSourceContent = typeof input === 'object' && 'source' in input;
    const source = isSourceContent ? input.source : undefined;
    const filePath = isSourceContent ? input.filePath : input;
    const language = isSourceContent ? input.language : undefined;
    const extension = isSourceContent ? input.extension : undefined;
    const renderOptions = options;
    const { resolved, context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const input = { filePath, source, language, extension };
      const { css, map, sourceMapURL } = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile,
        undefined,
        resolved
      );

      context.finalizeWarnings();

      const loadedUrls: string[] = [];

      finalizeRenderProfile(profile, {
        method: 'renderToResult',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount
      });
      return {
        css,
        errors: [...context.errors],
        warnings: [...context.warnings],
        loadedUrls,
        ...(map === undefined ? {} : { map }),
        ...(sourceMapURL === undefined ? {} : { sourceMapURL })
      };
    } catch (err: unknown) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];
      const errMsg = thrownMessage(err);

      if (err instanceof JessError) {
        appendThrownJessDiagnostic(errors, warnings, err);
      } else {
        errors.push(internalUnknownDiagnostic(
          err,
          errMsg,
          filePath ?? undefined,
          'An unexpected error occurred during compilation.'
        ));
      }

      if (renderOptions?.suppressWarnings !== true) {
        outputDiagnostics(errors, warnings, {
          suppressWarnings: renderOptions?.suppressWarnings ?? false,
          breakOnError: renderOptions?.breakOnError ?? true,
          verbose: renderOptions?.verbose ?? false,
          warnings: renderOptions?.warnings,
          errors: renderOptions?.errors,
          colors: renderOptions?.colors
        });
      }

      const loadedUrls: string[] = [];
      finalizeRenderProfile(profile, {
        method: 'renderToResult',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return {
        css: '',
        errors,
        warnings,
        loadedUrls
      };
    }
  }

  /** @internal */
  async safeCompile(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    document: Stylesheet | null;
    context: Context;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    const { resolved, context, profile } = await this.prepareRender(filePath, {
      ...options,
      breakOnError: false,
      suppressWarnings: options?.suppressWarnings ?? false
    });

    try {
      const document = await this.prepareStylesheet(context, resolved, { filePath }, profile);

      context.finalizeWarnings();

      finalizeRenderProfile(profile, {
        method: 'safeCompile',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount
      });
      return {
        document,
        context,
        errors: [...context.errors],
        warnings: [...context.warnings]
      };
    } catch (err: unknown) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];
      const errMsg = thrownMessage(err);

      if (err instanceof JessError) {
        appendThrownJessDiagnostic(errors, warnings, err);
      } else {
        errors.push(internalUnknownDiagnostic(
          err,
          errMsg,
          filePath,
          'An unexpected error occurred during compilation.'
        ));
      }

      finalizeRenderProfile(profile, {
        method: 'safeCompile',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return { document: null, context, errors, warnings };
    }
  }

  /** @internal */
  async safeRender(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    css: string | null;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    const { resolved, context, profile } = await this.prepareRender(filePath, {
      ...options,
      breakOnError: false,
      suppressWarnings: options?.suppressWarnings ?? false
    });

    try {
      const input = { filePath };
      const { css } = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile,
        undefined,
        resolved
      );

      finalizeRenderProfile(profile, {
        method: 'safeRender',
        filePath,
        errors: context.errors.length,
        warnings: context.warningCount
      });
      return {
        css,
        errors: [...context.errors],
        warnings: [...context.warnings]
      };
    } catch (err: unknown) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];
      const errMsg = thrownMessage(err);

      if (err instanceof JessError) {
        appendThrownJessDiagnostic(errors, warnings, err);
      } else {
        errors.push(internalUnknownDiagnostic(
          err,
          errMsg,
          filePath,
          'An unexpected error occurred during rendering.'
        ));
      }

      finalizeRenderProfile(profile, {
        method: 'safeRender',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return { css: null, errors, warnings };
    }
  }

  dispose() {
    for (const plugin of this.jsPluginProxyCache.values()) {
      try {
        void plugin.dispose?.();
      } catch {
        // ignore cleanup failures
      }
    }
    this.jsPluginProxyCache.clear();
    this.jsPluginFactoryCache.clear();
    this.configuredPluginFactoryCache.clear();
  }
}
