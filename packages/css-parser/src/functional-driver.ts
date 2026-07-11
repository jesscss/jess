/**
 * Shared functional-parse driver for the css/less/scss/jess grammars. Thin glue
 * over parseman's generic `run()`: parseman owns invoking the entry (compiled fn
 * OR interpreter combinator), threading the ctx (trivia log, recover/expect error
 * sink, the `ctx.build` host), and reporting leftover input after the grammar's
 * own trivia. This module keeps only what is jess policy: shaping the value into a
 * `Rules` tree, collapsing every diagnostic to ONE earliest `JessError`, and
 * building the trivia map. Every functional grammar reuses it, so their
 * `{ tree, errors, warnings, trivia }` output is identical in shape and semantics.
 */
import { run, triviaKindMask, type FieldMap } from 'parseman';
import { Node, Rules, nil, makeJessError, type TriviaMap, type JessError } from '@jesscss/core';
import { buildLazyTriviaMap } from './builders.js';

export type FunctionalParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
  trivia: TriviaMap;
  /** Source `[start, end)` ranges of comments lifted to standalone `Comment`
   *  nodes; the render-time trivia view hides these so they aren't double-emitted. */
  liftedCommentRanges: ReadonlyArray<readonly [number, number]>;
};

/**
 * The build host a functional grammar drives its structural `node()` rules
 * through (`ctx.build`), plus the per-parse source/warning lifecycle the driver
 * needs. Each grammar defines one that reuses its class builders.
 */
export interface FunctionalParseHost {
  setSource(src: string): void;
  resetWarnings(): void;
  getWarnings(): Array<{ message: string; deprecation?: string }>;
  getErrors(): Array<{ message: string; offset?: number; endOffset?: number }>;
  getLiftedCommentRanges(): ReadonlyArray<readonly [number, number]>;
  captureTriviaForNode?(type: string): boolean;
  /**
   * Node types whose captured `triviaLog` should hold COMMENTS ONLY (whitespace
   * skipped) — e.g. `Stylesheet`/`Ruleset`, which lift standalone comments but
   * never consult whitespace. Returning true (with a comment-bearing trivia
   * grammar) lets the builder read comments straight from the log instead of
   * re-scanning source, without paying to log every space. Types NOT listed keep
   * capturing every kind (e.g. `CompoundSelector` needs the whitespace that marks
   * a descendant combinator).
   */
  commentOnlyTriviaForNode?(type: string): boolean;
  /** `ctx.build` host: construct the AST node for a structural `node(type, …)`. */
  build(
    type: string,
    children: ReadonlyArray<unknown>,
    fields: FieldMap | undefined,
    span: { start: number; end: number },
    rawChildren: ReadonlyArray<unknown>,
    triviaLog: readonly number[],
  ): unknown;
}

export interface RunFunctionalParseOptions {
  /**
   * The grammar's trivia parser (e.g. its `rw` rule). Passed to `run()` so
   * trailing whitespace/comments aren't reported as leftover — and the dialect's
   * comment rules are honored for free (CSS trivia → a trailing `//` is leftover;
   * Less trivia → it isn't). Omit to treat any trailing input as leftover.
   */
  trivia?: unknown;
}

// A compiled rule OR interpreter combinator, loosely typed so a grammar map cast
// stays a plain widening (`as Record<string, unknown>`) at the call site.
type Entry = (i: string, p: number, c: any) => any;

/**
 * Convert a raw diagnostic (`{ message, offset }`) into the typed `JessError`
 * every parser must emit — carrying 1-based line/column (derived from `source` +
 * `offset`), the source, and a `parse/syntax-error` code. `offset` is preserved
 * on the instance for callers that still want it.
 */
function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  const clamped = offset < 0 ? 0 : (offset > source.length ? source.length : offset);
  // Offset → line/column in a single forward pass over `String.indexOf('\n')`
  // (V8 vectorizes it). Runs at most ONCE per parse (only on error).
  let lastNl = -1;
  for (let i = source.indexOf('\n'); i !== -1 && i < clamped; i = source.indexOf('\n', i + 1)) {
    line++;
    lastNl = i;
  }
  return { line, column: clamped - lastNl }; // lastNl === -1 (line 1) → column = clamped + 1
}

export function toParseError(
  message: string,
  offset: number | undefined,
  source: string,
  filePath?: string,
  endOffset?: number
): JessError {
  const { line, column } = typeof offset === 'number'
    ? offsetToLineCol(source, offset)
    : { line: 1, column: 1 };
  const err = makeJessError({ code: 'parse/syntax-error', phase: 'parse', source, filePath, line, column, summary: message });
  const withPos = err as JessError & { offset?: number; endOffset?: number; endLine?: number; endColumn?: number };
  withPos.offset = offset;
  // When the diagnostic carries the offending construct's full span (not just a
  // point), surface an end line/column too so range-building consumers (e.g. the
  // language service) can highlight the whole statement rather than one char.
  if (typeof endOffset === 'number' && endOffset > (offset ?? 0)) {
    const end = offsetToLineCol(source, endOffset);
    withPos.endOffset = endOffset;
    withPos.endLine = end.line;
    withPos.endColumn = end.column;
  }
  return err;
}

/**
 * Run a resolved entry rule against `input` and shape the outcome into a
 * `Rules` tree + one earliest `JessError`. `entry` is the compiled function or
 * interpreted combinator for the rule.
 */
export function runFunctionalParse(
  input: string,
  entry: unknown,
  host: FunctionalParseHost,
  options: RunFunctionalParseOptions = {}
): FunctionalParseResult {
  host.setSource(input);
  host.resetWarnings();

  // `entry`/`trivia` cross the compiled-grammar boundary as `unknown`
  // (a rule fn or combinator); loosely typing them keeps the call sites a plain
  // widening cast rather than an unsafe one here.
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  const triviaKindLabels = (options.trivia as { _meta?: { triviaKindLabels?: readonly string[] } } | undefined)?._meta?.triviaKindLabels;
  // Mask keeping every non-whitespace trivia kind (block + line comments, and any
  // future non-ws kind) — the per-node-type filter for comment-only capture.
  const commentMask = triviaKindLabels
    ? triviaKindMask(triviaKindLabels, triviaKindLabels.filter(l => l !== 'whitespace'))
    : undefined;
  const build = Object.assign(
    (type: string, children: ReadonlyArray<unknown>, fields: FieldMap | undefined, span: { start: number; end: number }, rawChildren: ReadonlyArray<unknown>, triviaLog: readonly number[]) =>
      host.build(type, children, fields, span, rawChildren, triviaLog),
    host.captureTriviaForNode ? { _parsemanCaptureTrivia: host.captureTriviaForNode.bind(host) } : {},
    host.commentOnlyTriviaForNode && commentMask !== undefined
      ? { _parsemanTriviaKinds: (type: string) => host.commentOnlyTriviaForNode!(type) ? commentMask : undefined }
      : {}
  );
  const res = run(entry as Entry, input, {
    build,
    trivia: options.trivia ? (options.trivia as Entry) : undefined
  });
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

  // A single-node rule yields that node; a `many(...)` entry rule yields an array
  // — wrap it in a Rules so callers get a `.rules` body rather than a bare Nil.
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  const tree = (
    res.ok && res.value instanceof Node
      ? res.value
      : res.ok && Array.isArray(res.value)
        ? new Rules(res.value as Node[], undefined, undefined)
        : nil()
  ) as unknown as Rules;
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

  // Diagnostic sources, all position-tagged: recover()/expect() misses, a hard
  // top-level failure, leftover input, and any error the host builders recorded.
  const collected: Array<{ message: string; offset?: number; endOffset?: number }> = [];
  for (const e of res.errors) {
    const exp = e.expected.filter(x => x !== 'sentinel');
    collected.push({ message: exp.length ? `expected ${exp.join(', ')}` : 'Unexpected input', offset: e.span.start });
  }
  if (!res.ok) {
    collected.push({ message: res.expected.join(', ') || 'Parse error', offset: res.span.start });
  }
  if (res.unconsumedFrom !== null) {
    collected.push({ message: 'Unexpected input', offset: res.unconsumedFrom });
  }
  collected.push(...host.getErrors());
  // Default: report ONE error and stop — the earliest by position.
  collected.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const errors: JessError[] = collected.length > 0
    ? [toParseError(collected[0]!.message, collected[0]!.offset, input, undefined, collected[0]!.endOffset)]
    : [];

  return {
    tree,
    errors,
    warnings: host.getWarnings(),
    trivia: buildLazyTriviaMap(res.triviaLog, input, triviaKindLabels),
    liftedCommentRanges: host.getLiftedCommentRanges()
  };
}
