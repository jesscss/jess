/**
 * Whole-document AST-v2 render driver (test-space harness).
 *
 * Renders a COMPLETE `.less` stylesheet through the `ast/` engine directly:
 *
 *     source bytes → parseToAst (the P0/P1-clean direct build host,
 *                    NO legacy `Rules` tree, NO bridge) → serialize → CSS bytes
 *
 * This is the T1 deliverable of `docs/future/core-architecture/BENCHMARK-PERF-PATH.md`
 * and the seed of the T8 real-fixture perf harness (which, like `race.test.ts`,
 * lives in test space). It lives under `__tests__/` on purpose: it is measurement
 * tooling, not a production render path (nothing in `Compiler`/`jess-plugin-less`
 * calls it), and test space is where importing `@jesscss/less-parser` is allowed
 * and where the eventual T8 harness belongs.
 *
 * Boundary: engine side stays clean — it drives `parseToAst` + `../../index.js`
 * serialize + the dispatch host, never the legacy `../../../tree`. The value
 * EVALUATOR is injected (mirroring `serialize`'s evaluator seam) so the fns
 * registry is the caller's choice.
 *
 * Import threading: `filePath` is carried so import resolution resolves a
 * specifier against the file's own directory (`import.ts` otherwise falls back to
 * `process.cwd()`). After the parse, `resolveDirectImports` walks the built root,
 * resolving each `@import` by parsing the target through this SAME direct pipeline
 * and splicing its statements at the import site (once / multiple / reference /
 * optional / inline — gap G5). A deferred shape (interpolated / CSS-passthrough
 * path) stays verbatim and is reported on `deferredImports`.
 */
import * as fs from 'node:fs';
import { isThenable } from '@jesscss/awaitable-pipe';
import { lessGrammar, firstInlineJsBacktick, INLINE_JS_UNSUPPORTED_MESSAGE } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import type { Root, Statement } from '../../index.js';
import type { SerializeResult } from '../../serialize.js';
import type { ValueEvaluator } from '../../value-eval.js';
import { parseToAst } from '../dispatch-host.js';
import { createImportState, resolveDirectImports } from '../import.js';

const g = lessGrammar as Record<string, unknown>;

export interface AstRenderResult {
  /** Serialized CSS bytes, or `undefined` if the render threw before producing any. */
  css: string | undefined;
  /** Parse diagnostics surfaced by the dispatch host (position-tagged). */
  parseErrors: Array<{ message: string; offset?: number }>;
  /** A throw captured during parse/serialize (e.g. `UnsupportedShape`), or `null`. */
  threw: Error | null;
  /** `@import`s left verbatim (deferred shape / unresolved) with their feature tag. */
  deferredImports: Array<{ feature: string; detail: string }>;
}

export interface AstRenderOptions {
  /** Absolute path of the source file (threads import base dir; see module doc). */
  filePath?: string;
  /** Injected typed value evaluator (built via `buildEvaluator(registry)`). */
  evaluator?: ValueEvaluator;
  /**
   * Override the `Stylesheet` grammar entry (untyped at the parseman boundary,
   * exactly as `dispatch-host.ts` types it). Defaults to `lessGrammar.Stylesheet`.
   */
  grammar?: unknown;
  /** Override the trivia parser entry. Defaults to `lessGrammar.rw`. */
  trivia?: unknown;
  /**
   * Output mode threaded to `serialize`. `false` = NESTED (Less v5 default),
   * `true`/omitted = FLAT (composed selectors). A fixture's `styles.config.ts`
   * (`output.collapseNesting`) governs this; the harness resolves it per fixture.
   */
  collapseNesting?: boolean;
}

/**
 * Throw the canonical inline-JS diagnostic if `src` contains a backtick in code
 * position. Reuses `less-parser`'s exported scanner + message so the ast/ render
 * path errors identically to `LessParser.parse` (which guards the same way before
 * `parseLessFn`). The throw is captured on `AstRenderResult.threw` by the caller.
 */
function guardInlineJs(src: string): void {
  if (firstInlineJsBacktick(src) !== -1) {
    throw new Error(INLINE_JS_UNSUPPORTED_MESSAGE);
  }
}

/** The synchronous driver requires a synchronous evaluator; a Promise is a bug. */
function requireSync(r: ReturnType<typeof serialize>): SerializeResult {
  if (isThenable(r)) {
    throw new Error('serialize returned a Promise; the whole-doc driver requires a synchronous evaluator');
  }
  return r;
}

/**
 * Render a `.less` SOURCE string through the whole-document AST-v2 pipeline.
 * Never throws: any parse/serialize throw is captured on `.threw`.
 */
export function renderAstDoc(src: string, options: AstRenderOptions = {}): AstRenderResult {
  const deferredImports: Array<{ feature: string; detail: string }> = [];
  try {
    const grammar = options.grammar ?? g['Stylesheet'];
    const trivia = options.trivia ?? g['rw'];
    // Inline JavaScript (backticks) was removed in v5. The Parseman grammar has no
    // backtick token, so `parseToAst` would otherwise pass the raw `` `…` `` bytes
    // straight through to serialize. Mirror `LessParser.parse`'s wrapper guard here
    // — the same source scan + identical diagnostic — so the ast/ render path surfaces
    // the migration error instead of emitting inline JS verbatim. Imported files are
    // scanned too (see the `parse` closure below).
    guardInlineJs(src);
    const { root, errors } = parseToAst(src, grammar, undefined, { trivia });
    if (root === undefined) {
      return {
        css: undefined,
        parseErrors: errors,
        threw: new Error(`parseToAst produced no root (parse errors: ${JSON.stringify(errors)})`),
        deferredImports,
      };
    }
    // [import G5] Resolve + inline `@import`s on the direct host: parse each
    // imported file through the SAME direct pipeline and splice its statements at
    // the import site (once / multiple / reference / optional / inline semantics
    // in `resolveDirectImports`). Deferred shapes stay verbatim (see driver doc).
    const parse = (source: string): Statement[] => {
      guardInlineJs(source);
      const res = parseToAst(source, grammar, undefined, { trivia });
      return res.root ? res.root.children : [];
    };
    const resolved = resolveDirectImports(
      root.children,
      options.filePath,
      createImportState(),
      parse,
      (feature, detail) => deferredImports.push({ feature, detail }),
    );
    const resolvedRoot: Root = { ...root, children: resolved };
    const { css } = requireSync(
      serialize(resolvedRoot, { evaluator: options.evaluator, collapseNesting: options.collapseNesting }),
    );
    return { css, parseErrors: errors, threw: null, deferredImports };
  } catch (e) {
    return { css: undefined, parseErrors: [], threw: e instanceof Error ? e : new Error(String(e)), deferredImports };
  }
}

/** Render a `.less` FILE through the whole-document AST-v2 pipeline. */
export function renderAstFile(filePath: string, options: Omit<AstRenderOptions, 'filePath'> = {}): AstRenderResult {
  const src = fs.readFileSync(filePath, 'utf8');
  return renderAstDoc(src, { ...options, filePath });
}
