/**
 * Registry-driven parseman build host + a tree2 parse driver.
 *
 * `ParseBuildHost` is a `FunctionalParseHost` whose `build(type, …)` is ONE
 * monomorphic map lookup into an `ACTION_LIST` (see `actions/index.ts`). Adding a
 * node family is purely additive — a new `actions/<family>.ts` appended to the
 * list — so parallel family agents never collide on a shared `switch`.
 *
 * `parseToAst` is the tree2 variant of the css-parser
 * `runFunctionalParse`: it drives parseman's `run()` with this host and returns
 * the built tree2 root VERBATIM (`res.value`), instead of coercing the result to
 * a legacy `Node`/`Rules`. No legacy-tree dependency.
 *
 * Boundary: front-end only — touches the parser layer + `../tree2`, never the
 * legacy `../tree`.
 */
import { run } from 'parseman';
import type { FunctionalParseHost } from '@jesscss/css-parser/jess';
import * as t2 from '../index.js';
import {
  type BuildAction,
  type BuildContext,
  type BuildFn,
  type Span,
  placeholder,
} from './host-context.js';
import { ACTION_LIST } from './actions/index.js';

/** A compiled parseman rule OR interpreter combinator (loosely typed at the
 *  grammar boundary; the call site widens the grammar map). */
type Entry = Parameters<typeof run>[0];

export class ParseBuildHost implements FunctionalParseHost {
  private readonly _actions: ReadonlyMap<string, BuildFn>;
  private _ctx: BuildContext = { src: '' };
  /**
   * The tree2 root produced by the outermost `Stylesheet` build. The T2 driver
   * returns it directly, but it is also captured here so a caller reusing the
   * LEGACY `runFunctionalParse` driver (which discards a non-`Node` result) can
   * still read it off the host — the same escape hatch the POC used.
   */
  root: unknown;

  constructor(actions: readonly BuildAction[] = ACTION_LIST) {
    const map = new Map<string, BuildFn>();
    for (const a of actions) map.set(a.type, a.build);
    this._actions = map;
  }

  setSource(src: string): void {
    this._ctx = { src };
    this.root = undefined;
  }

  resetWarnings(): void {
    /* no warnings families registered yet */
  }

  getWarnings(): Array<{ message: string; deprecation?: string }> {
    return [];
  }

  getErrors(): Array<{ message: string; offset?: number; endOffset?: number }> {
    return [];
  }

  getLiftedCommentRanges(): ReadonlyArray<readonly [number, number]> {
    return [];
  }

  build(
    type: string,
    children: ReadonlyArray<unknown>,
    fields: unknown,
    span: Span,
    rawChildren: ReadonlyArray<unknown>,
    triviaLog: readonly number[],
  ): unknown {
    const action = this._actions.get(type);
    if (action === undefined) return placeholder(type);
    const out = action({ type, children, span, rawChildren, triviaLog, ctx: this._ctx });
    if (type === 'Stylesheet') this.root = out;
    return out;
  }
}

export interface AstParseResult {
  /** The built tree2 root (a `Root`), or `undefined` if the parse produced none. */
  root: t2.Root | undefined;
  /** Raw parseman diagnostics (position-tagged); shaping into `JessError` is a
   *  later concern, kept out of the front-end template. */
  errors: Array<{ message: string; offset?: number }>;
}

/**
 * Run a resolved grammar entry against `input` with the tree2 build host and
 * return the built root directly. Reuses parseman's `run()` (default trivia
 * capture, exactly like the POC path) but skips the legacy `Rules` coercion +
 * `JessError` shaping the css-parser driver does. When a comment/whitespace-
 * sensitive family needs the trivia-kind capture hooks, they thread through here
 * additively — the current value/selector families do not.
 */
export function parseToAst(
  input: string,
  entry: unknown,
  host: ParseBuildHost = new ParseBuildHost(),
  options: { trivia?: unknown } = {},
): AstParseResult {
  host.setSource(input);
  host.resetWarnings();

  const build = (
    type: string,
    children: ReadonlyArray<unknown>,
    fields: unknown,
    span: Span,
    rawChildren: ReadonlyArray<unknown>,
    triviaLog: readonly number[],
  ): unknown => host.build(type, children, fields, span, rawChildren, triviaLog);

  const res = run(entry as Entry, input, {
    build,
    trivia: options.trivia !== undefined ? (options.trivia as Entry) : undefined,
  }) as {
    ok: boolean;
    value: unknown;
    span: { start: number };
    expected: string[];
    errors: Array<{ span: { start: number }; expected: string[] }>;
    unconsumedFrom: number | null;
  };

  const errors: Array<{ message: string; offset?: number }> = [];
  for (const e of res.errors) {
    const exp = e.expected.filter((x) => x !== 'sentinel');
    errors.push({ message: exp.length ? `expected ${exp.join(', ')}` : 'Unexpected input', offset: e.span.start });
  }
  if (!res.ok) errors.push({ message: res.expected.join(', ') || 'Parse error', offset: res.span.start });
  if (res.unconsumedFrom !== null) errors.push({ message: 'Unexpected input', offset: res.unconsumedFrom });

  const root = res.ok && res.value instanceof t2.Root ? res.value : host.root instanceof t2.Root ? host.root : undefined;
  return { root, errors };
}
