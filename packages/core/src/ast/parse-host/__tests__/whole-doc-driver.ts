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
 * Import threading: `filePath` is carried so import resolution can resolve a
 * specifier against the file's own directory (`import.ts` otherwise falls back to
 * `process.cwd()`). The direct dispatch host does not yet WIRE import resolution
 * (resolution today lives only on the bridge path), so a `filePath` is accepted +
 * reported but only becomes load-bearing once an import action lands on the direct
 * host. See `BENCHMARK-AST-FAILURE-INVENTORY.md` (gap G5).
 */
import * as fs from 'node:fs';
import { isThenable } from '@jesscss/awaitable-pipe';
import { lessGrammar } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import type { SerializeResult } from '../../serialize.js';
import type { ValueEvaluator } from '../../value-eval.js';
import { parseToAst } from '../dispatch-host.js';

const g = lessGrammar as Record<string, unknown>;

export interface AstRenderResult {
  /** Serialized CSS bytes, or `undefined` if the render threw before producing any. */
  css: string | undefined;
  /** Parse diagnostics surfaced by the dispatch host (position-tagged). */
  parseErrors: Array<{ message: string; offset?: number }>;
  /** A throw captured during parse/serialize (e.g. `UnsupportedShape`), or `null`. */
  threw: Error | null;
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
  try {
    const grammar = options.grammar ?? g['Stylesheet'];
    const trivia = options.trivia ?? g['rw'];
    const { root, errors } = parseToAst(src, grammar, undefined, { trivia });
    if (root === undefined) {
      return {
        css: undefined,
        parseErrors: errors,
        threw: new Error(`parseToAst produced no root (parse errors: ${JSON.stringify(errors)})`)
      };
    }
    const { css } = requireSync(serialize(root, { evaluator: options.evaluator }));
    return { css, parseErrors: errors, threw: null };
  } catch (e) {
    return { css: undefined, parseErrors: [], threw: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Render a `.less` FILE through the whole-document AST-v2 pipeline. */
export function renderAstFile(filePath: string, options: Omit<AstRenderOptions, 'filePath'> = {}): AstRenderResult {
  const src = fs.readFileSync(filePath, 'utf8');
  return renderAstDoc(src, { ...options, filePath });
}
