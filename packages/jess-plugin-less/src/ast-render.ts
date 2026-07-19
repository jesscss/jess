/**
 * Production `.less` render driver on the AST-v2 engine (engine-cutover render path).
 *
 * This is the consumer-layer LESS BINDING over core's parser-agnostic whole-document
 * pipeline (`@jesscss/core/ast-render` — `renderAstDoc`/`renderAstFile`). It supplies
 * the three dialect-specific pieces core deliberately does NOT know about:
 *
 *   1. the Less grammar + trivia entries (`@jesscss/less-parser`),
 *   2. the inline-JS (backtick) migration guard (removed in v5 — errors identically
 *      to `LessParser.parse`), and
 *   3. the built-in Less fn evaluator (`buildEvaluator(makeBuiltinRegistry())` from
 *      `@jesscss/fns` — the ast/ ValueObj value model, NOT the legacy tree/ classes).
 *
 * `@jesscss/plugin-less` is the correct home: it already imports both `@jesscss/fns`
 * and the Less parser, whereas core imports neither. The evaluator is built once and
 * memoized (the fn set is static). This driver is ADDITIVE — the legacy tree/ render
 * path (`LessPlugin.safeParse` → `Compiler.renderTree`) is untouched and remains the
 * default; nothing here is on the default render path yet.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildEvaluator, renderAstDoc, renderAstFile } from '@jesscss/core/ast-render';
import type { AstRenderResult, ModuleResolver, PluginHost, ValueEvaluator } from '@jesscss/core/ast-render';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { lessGrammar, firstInlineJsBacktick, INLINE_JS_UNSUPPORTED_MESSAGE } from '@jesscss/less-parser';
import { NodeModulesPlugin } from '@jesscss/plugin-node-modules';
import { createPluginHost, type InstallablePlugin } from './plugin-runtime.js';

export type { AstRenderResult } from '@jesscss/core/ast-render';

const grammar = lessGrammar as Record<string, unknown>;

/**
 * Reject inline JavaScript (backticks in code position) with the canonical v5
 * migration diagnostic — the same source scan + message `LessParser.parse` guards
 * with before `parseLessFn`, so the ast/ path errors identically.
 */
function guardInlineJs(src: string): void {
  if (firstInlineJsBacktick(src) !== -1) {
    throw new Error(INLINE_JS_UNSUPPORTED_MESSAGE);
  }
}

// The built-in fn evaluator is static across renders — build it lazily once.
let sharedEvaluator: ValueEvaluator | undefined;
function builtinEvaluator(): ValueEvaluator {
  return (sharedEvaluator ??= buildEvaluator(makeBuiltinRegistry()));
}

/**
 * [import:module] The node_modules / package-specifier `@import` resolver, backed
 * by `@jesscss/plugin-node-modules` (Node's module-resolution algorithm). A bare
 * specifier (`@import "@scope/pkg/x.less"`) resolves relative to the importing
 * file's directory (`fromDir`), so a package installed alongside the importing
 * `.less` is found. The `.less` extension probing is applied by core's
 * `resolveLessPath` — this only maps a resolvable specifier to its absolute path.
 * Built once (stateless) and reused across renders.
 */
let sharedNodeModules: NodeModulesPlugin | undefined;
function moduleResolver(): ModuleResolver {
  const plugin = (sharedNodeModules ??= new NodeModulesPlugin());
  return (spec, fromDir) => plugin.resolvePackage(spec, fromDir);
}

/** Options for the production ast/ `.less` render. */
export interface RenderLessViaAstOptions {
  /**
   * Output mode. `false` = NESTED (Less v5 default), `true` = FLAT (composed
   * selectors — the legacy 4.x behaviour, now opt-in). Defaults to `false`.
   */
  collapseNesting?: boolean;
  /**
   * [import:paths] Configured include-path search directories (Less's `paths`
   * option), forwarded to core for `@import` + IO-fn (`data-uri`/`image-*`) asset
   * resolution. Relative entries resolve against the importing/source file dir.
   */
  searchDirs?: readonly string[];
  /**
   * [plugin/P2] Config-injected `install`-style Less plugins whose functions are
   * registered GLOBALLY (root frame) for this render — the native path for
   * `less.functions.functionRegistry.add(...)`-style plugins passed via compiler
   * config (e.g. the `functions-harness` fixture). `@plugin "specifier"`
   * directives IN the source are loaded automatically (no config needed).
   */
  plugins?: readonly InstallablePlugin[];
}

/**
 * [plugin/P2] Build the {@link PluginHost} for a render, or `undefined` when there
 * is no plugin work to do (no config plugins AND no `@plugin` directive in the
 * source) — the idle path, where core skips the whole scoped-fn machinery and the
 * render is byte-identical. `baseDir` roots `@plugin` module resolution at the
 * source file's directory (falls back to cwd for in-memory source).
 */
function buildPluginHost(
  source: string,
  filePath: string | undefined,
  plugins: readonly InstallablePlugin[] | undefined,
): PluginHost | undefined {
  const hasDirective = source.includes('@plugin');
  if (!hasDirective && !(plugins && plugins.length > 0)) return undefined;
  const baseDir = filePath ? path.dirname(filePath) : process.cwd();
  return createPluginHost({ baseDir, configPlugins: plugins });
}

/**
 * Render a `.less` SOURCE string end-to-end through the AST-v2 engine.
 * Never throws: any parse/serialize throw is captured on `.threw`.
 */
export function renderLessViaAst(
  src: string,
  options: RenderLessViaAstOptions & { filePath?: string } = {},
): AstRenderResult {
  return renderAstDoc(src, {
    grammar: grammar['Stylesheet'],
    trivia: grammar['rw'],
    filePath: options.filePath,
    evaluator: builtinEvaluator(),
    guardSource: guardInlineJs,
    resolveModule: moduleResolver(),
    searchDirs: options.searchDirs,
    collapseNesting: options.collapseNesting ?? false,
    pluginHost: buildPluginHost(src, options.filePath, options.plugins),
  });
}

/**
 * Render a `.less` FILE end-to-end through the AST-v2 engine.
 * Never throws: any parse/serialize throw is captured on `.threw`.
 */
export function renderLessFileViaAst(filePath: string, options: RenderLessViaAstOptions = {}): AstRenderResult {
  // Peek the source to decide whether a plugin host is needed (idle renders skip
  // it entirely). Any read error falls through to `renderAstFile`, which reports
  // the failure on `.threw`.
  let host: PluginHost | undefined;
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    host = buildPluginHost(src, filePath, options.plugins);
  } catch {
    host = options.plugins && options.plugins.length > 0
      ? createPluginHost({ baseDir: path.dirname(filePath), configPlugins: options.plugins })
      : undefined;
  }
  return renderAstFile(filePath, {
    grammar: grammar['Stylesheet'],
    trivia: grammar['rw'],
    evaluator: builtinEvaluator(),
    guardSource: guardInlineJs,
    resolveModule: moduleResolver(),
    searchDirs: options.searchDirs,
    collapseNesting: options.collapseNesting ?? false,
    pluginHost: host,
  });
}
