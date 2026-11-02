import type { InputOptions, LessOptions, LintConfig, OutputOptions, ScssOptions, SourceDialectOptions, StylesConfig } from './types.js';

/*
 * The keys of each typed section of a `styles.config`, and of each setting
 * whose value is an object of a fixed shape (`sourceMap`), at runtime. Each list
 * is checked against its type (`satisfies`), so a setting added to a type and
 * not here, or listed here and not in the type, fails the build.
 */
type Keys<T> = Record<keyof T, true>;

const COMPILE = {
  plugins: true, searchPaths: true, mathMode: true, unitMode: true, functionMode: true, strict: true,
  allowOverloadedImport: true, allowLeakyScope: true, leakyScope: true, allowCallerScope: true,
  processImports: true, allowExtendSelectors: true, allowApplySelectors: true, disableScriptModules: true,
  disablePluginRule: true, jsReadRoot: true
} satisfies Keys<NonNullable<StylesConfig['compile']>>;

const INPUT = {
  file: true, mathMode: true, unitMode: true, functionMode: true, strict: true, allowOverloadedImport: true,
  processImports: true, allowExtendSelectors: true, disableScriptModules: true, disablePluginRule: true,
  searchPaths: true, javascriptEnabled: true, paths: true, globalVars: true, modifyVars: true, rewriteUrls: true,
  rootpath: true, allowLeakyScope: true, leakyScope: true, allowCallerScope: true, bubbleRootAtRules: true
} satisfies Keys<InputOptions>;

const OUTPUT = { file: true, collapseNesting: true, compress: true, sourceMap: true } satisfies Keys<OutputOptions>;

const LINT = {
  files: true, ignoreFiles: true, reportSyntax: true, validProperties: true, rules: true, diagnostics: true
} satisfies Keys<LintConfig>;

const LESS = {
  allowExtendSelectors: true, allowApplySelectors: true, javascriptEnabled: true, disablePluginRule: true,
  depends: true, compress: true, lint: true, paths: true, processImports: true, color: true, strictImports: true,
  insecure: true, ieCompat: true, rootpath: true, rewriteUrls: true, relativeUrls: true, mathMode: true,
  unitMode: true, functionMode: true, moduleMode: true, math: true, strictMath: true, strictUnits: true,
  globalVars: true, modifyVars: true, urlArgs: true, dumpLineNumbers: true, sourceMap: true, verbose: true,
  silent: true, quiet: true, strict: true, allowOverloadedImport: true, allowLeakyScope: true, leakyScope: true,
  allowCallerScope: true, bubbleRootAtRules: true
} satisfies Keys<LessOptions>;

const SCSS = { allowExtendSelectors: true, allowApplySelectors: true, unitMode: true } satisfies Keys<ScssOptions>;

const SOURCE_MAP = {
  sourceMapFullFilename: true, sourceMapRootpath: true, sourceMapBasepath: true, sourceMapURL: true,
  sourceMapFileInline: true, outputSourceFiles: true, disableSourcemapAnnotation: true,
  sourceMapOutputFilename: true, sourceMapFilename: true
} satisfies Keys<Exclude<NonNullable<OutputOptions['sourceMap']>, boolean>>;

const SOURCE_DIALECT = {
  mathMode: true, unitMode: true, functionMode: true, allowLeakyScope: true, leakyScope: true,
  allowCallerScope: true, bubbleRootAtRules: true, processImports: true, allowExtendSelectors: true,
  allowApplySelectors: true
} satisfies Keys<SourceDialectOptions>;

/** The settings of `value` its type defines; every other key is left out. */
function pick<T extends object>(value: T, keys: Keys<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key in keys) {
    if (Object.hasOwn(value, key)) {
      out[key] = value[key];
    }
  }
  return out;
}

/**
 * A setting whose keys a user names (\`lint.rules\`, \`globalVars\`) holds a value
 * that is not plain data (strings, numbers, booleans, null, arrays and plain
 * objects of them): it is refused rather than sent, so a render that needs it
 * fails instead of rendering without it.
 */
export class SettingNotPlainDataError extends Error {
  constructor(readonly setting: string) {
    super(`The styles.config setting ${setting} holds a value that is not plain data.`);
    this.name = 'SettingNotPlainDataError';
  }
}

const isPlainData = (value: unknown): boolean => {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isPlainData);
  }
  if (typeof value !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isPlainData);
};

/** The user-keyed records of a section: kept whole, their values plain data only. */
const plainRecords = <T extends object>(settings: T, records: ReadonlyArray<keyof T & string>, where: string): T => {
  for (const key of records) {
    if (!isPlainData(settings[key])) {
      throw new SettingNotPlainDataError(`${where}.${key}`);
    }
  }
  return settings;
};

/** A section's `sourceMap`, when it is an object, narrowed to the source-map settings. */
const sourceMapIn = <T extends { sourceMap?: OutputOptions['sourceMap'] }>(settings: T): T =>
  typeof settings.sourceMap === 'object' ? { ...settings, sourceMap: pick(settings.sourceMap, SOURCE_MAP) } : settings;

const pickEach = <T extends object>(value: T | T[], keys: Keys<T>): Array<Partial<T>> =>
  (Array.isArray(value) ? value : [value]).map(item => pick(item, keys));

/**
 * The settings of a `styles.config` that Jess defines (each section's typed
 * keys, and inside a setting of a fixed shape such as \`sourceMap\`, its keys;
 * for `language`, the Less, SCSS, CSS and `.jess` blocks), with every other
 * key left out: what crosses into the script sandbox
 * (`docs/design/DENO-SANDBOX-COMPILE.md` §5). Plugin instances in
 * `compile.plugins` are kept as they are. A user-keyed record (\`lint.rules\`,
 * \`lint.diagnostics\`, \`globalVars\`, \`modifyVars\`) is kept whole, and throws
 * {@link SettingNotPlainDataError} when a value in it is not plain data.
 */
export function knownSettings(config: StylesConfig): StylesConfig {
  const out: StylesConfig = {};
  if (config.compile) {
    out.compile = pick(config.compile, COMPILE);
  }
  if (config.input) {
    const input = pickEach(config.input, INPUT).map((item, at) => plainRecords(item, ['globalVars', 'modifyVars'], `input[${at}]`));
    out.input = Array.isArray(config.input) ? input : input[0];
  }
  if (config.output) {
    const output = pickEach(config.output, OUTPUT).map(sourceMapIn);
    out.output = Array.isArray(config.output) ? output : output[0];
  }
  if (config.lint) {
    out.lint = plainRecords(pick(config.lint, LINT), ['rules', 'diagnostics'], 'lint');
  }
  const language = config.language;
  if (language) {
    out.language = {
      ...language.less && { less: plainRecords(sourceMapIn(pick(language.less, LESS)), ['globalVars', 'modifyVars'], 'language.less') },
      ...language.scss && { scss: pick(language.scss, SCSS) },
      ...language.css && { css: pick(language.css, SOURCE_DIALECT) },
      ...language.jess && { jess: pick(language.jess, SOURCE_DIALECT) }
    };
  }
  return out;
}
