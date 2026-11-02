import type { InputOptions, LessOptions, LintConfig, OutputOptions, ScssOptions, SourceDialectOptions, StylesConfig } from './types.js';

/*
 * The keys of each typed section of a `styles.config`, at runtime. Each list
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

const pickEach = <T extends object>(value: T | T[], keys: Keys<T>): Partial<T> | Array<Partial<T>> =>
  Array.isArray(value) ? value.map(item => pick(item, keys)) : pick(value, keys);

/**
 * The settings of a `styles.config` that Jess defines (each section's typed
 * keys; for `language`, the Less, SCSS, CSS and `.jess` blocks), with every
 * other key left out: what crosses into the script sandbox
 * (`docs/design/DENO-SANDBOX-COMPILE.md` §5). Plugin instances in
 * `compile.plugins` are kept as they are.
 */
export function knownSettings(config: StylesConfig): StylesConfig {
  const out: StylesConfig = {};
  if (config.compile) {
    out.compile = pick(config.compile, COMPILE);
  }
  if (config.input) {
    out.input = pickEach(config.input, INPUT);
  }
  if (config.output) {
    out.output = pickEach(config.output, OUTPUT);
  }
  if (config.lint) {
    out.lint = pick(config.lint, LINT);
  }
  const language = config.language;
  if (language) {
    out.language = {
      ...language.less && { less: pick(language.less, LESS) },
      ...language.scss && { scss: pick(language.scss, SCSS) },
      ...language.css && { css: pick(language.css, SOURCE_DIALECT) },
      ...language.jess && { jess: pick(language.jess, SOURCE_DIALECT) }
    };
  }
  return out;
}
