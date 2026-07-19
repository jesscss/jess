/**
 * Whole-document AST-v2 render driver (test-space Less-binding harness).
 *
 * The heavy pipeline (parseToAst → resolveDirectImports → serialize) now lives in
 * production core at `../render-doc.ts` (parser-agnostic; `renderAstDoc`/`renderAstFile`).
 * This file is the test-space LESS BINDING: it injects the Less grammar + trivia
 * entries and the inline-JS (backtick) migration guard from `@jesscss/less-parser`
 * (importing the parser is allowed in test space), then delegates. It preserves the
 * pre-existing harness signature — `grammar`/`trivia` remain optional, defaulting to
 * the Less grammar — so every existing test call site is unchanged.
 *
 * The production `.less` counterpart is `@jesscss/plugin-less`'s `renderLessViaAst`,
 * which does the identical binding on the consumer side. Both share this one core
 * pipeline (no duplicated engine logic).
 */
import { lessGrammar, firstInlineJsBacktick, INLINE_JS_UNSUPPORTED_MESSAGE, parseLessFn } from '@jesscss/less-parser';
import type { ValueEvaluator } from '../../value-eval.js';
import type { ModuleResolver } from '../import.js';
import {
  renderAstDoc as renderAstDocCore,
  renderAstFile as renderAstFileCore,
  type AstRenderResult,
} from '../render-doc.js';

export type { AstRenderResult } from '../render-doc.js';

const g = lessGrammar as Record<string, unknown>;

export interface AstRenderOptions {
  /** Absolute path of the source file (threads import base dir). */
  filePath?: string;
  /** Injected typed value evaluator (built via `buildEvaluator(registry)`). */
  evaluator?: ValueEvaluator;
  /** Override the `Stylesheet` grammar entry. Defaults to `lessGrammar.Stylesheet`. */
  grammar?: unknown;
  /** Override the trivia parser entry. Defaults to `lessGrammar.rw`. */
  trivia?: unknown;
  /**
   * Output mode threaded to `serialize`. `false` = NESTED (Less v5 default),
   * `true`/omitted = FLAT (composed selectors).
   */
  collapseNesting?: boolean;
  /**
   * Injected node_modules / package-specifier resolver for bare `@import`
   * specifiers (see core `ModuleResolver`). The harness leaves this undefined by
   * default (core import tests are hermetic); the differential oracle supplies a
   * `@jesscss/plugin-node-modules`-backed resolver so `@import "@less/…"` inlines.
   */
  resolveModule?: ModuleResolver;
  /**
   * [import:paths] Include-path search dirs (Less's `paths` option), threaded into
   * `@import` resolution + IO-fn asset resolution. Relative entries resolve against
   * the source file's directory.
   */
  searchDirs?: readonly string[];
}

/**
 * Throw the canonical inline-JS diagnostic if `src` contains a backtick in code
 * position. Reuses `less-parser`'s exported scanner + message so the ast/ render
 * path errors identically to `LessParser.parse` (which guards the same way before
 * `parseLessFn`).
 */
function guardInlineJs(src: string): void {
  if (firstInlineJsBacktick(src) !== -1) {
    throw new Error(INLINE_JS_UNSUPPORTED_MESSAGE);
  }
}

/**
 * Render a `.less` SOURCE string through the whole-document AST-v2 pipeline.
 * Never throws: any parse/serialize throw is captured on `.threw`.
 */
export function renderAstDoc(src: string, options: AstRenderOptions = {}): AstRenderResult {
  return renderAstDocCore(src, {
    grammar: options.grammar ?? g['Stylesheet'],
    trivia: options.trivia ?? g['rw'],
    filePath: options.filePath,
    evaluator: options.evaluator,
    guardSource: guardInlineJs,
    parseFileVars: parseLessFn,
    resolveModule: options.resolveModule,
    searchDirs: options.searchDirs,
    collapseNesting: options.collapseNesting,
  });
}

/** Render a `.less` FILE through the whole-document AST-v2 pipeline. */
export function renderAstFile(filePath: string, options: Omit<AstRenderOptions, 'filePath'> = {}): AstRenderResult {
  return renderAstFileCore(filePath, {
    grammar: options.grammar ?? g['Stylesheet'],
    trivia: options.trivia ?? g['rw'],
    evaluator: options.evaluator,
    guardSource: guardInlineJs,
    parseFileVars: parseLessFn,
    resolveModule: options.resolveModule,
    searchDirs: options.searchDirs,
    collapseNesting: options.collapseNesting,
  });
}
