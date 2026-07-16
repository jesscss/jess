/**
 * tree2 VALUE domain + the synchronous VALUE-EVALUATOR seam (R2).
 *
 * This replaces the rung-8 `ValueService` (bytes-in / bytes-out) scaffold with a
 * TYPED, synchronous evaluator over a boundary-clean runtime value domain.
 *
 * Two things live here, both boundary-clean (NO `../tree` import):
 *
 *  1. The runtime VALUE DOMAIN (`ValueObj`) — the typed *results* an evaluation
 *     produces and operates on (`Numeric`/`Color`/`Quoted`/`Keyword`/`List`/
 *     `Bool`/`Nil`), distinct from the value AST (`Operation`/`FunctionCall`/…)
 *     that describes HOW to compute. Plus the lazy value-literal leaf
 *     (`ValueLiteral = { bytes, tag }`) that stays a string-shaped leaf until
 *     something FORCES object behaviour (VALUE-LITERAL-TAG, perf #2).
 *
 *  2. The `ValueEvaluator` seam — the only allowed boundary crossing (an injected
 *     interface, like the old `ValueService`), whose currency is now TYPED value
 *     objects rather than serialized bytes. The real implementation lives OUTSIDE
 *     `tree2/` (`tree2-frontend/value-eval.ts`); it MAY reach the shared value
 *     math (the fns registry + the legacy value nodes' arithmetic) — that is math
 *     machinery, not the eval/render engine tree2 replaces. tree2 depends ONLY on
 *     this interface.
 *
 * Sync by default (arch C1): `operate`/`guardCmp`/`guardCall`/`materialize` are
 * synchronous; only `call` returns `MaybePromise` (a genuinely async built-in —
 * `data-uri`, or the async color-format fns — forces the enclosing declaration's
 * emit onto the async branch, scoped to that leaf; there is NO global record
 * pre-pass).
 */

import type { MaybePromise } from '@jesscss/awaitable-pipe';

/* ------------------------------------------------------------ lazy leaf */

/** A value-literal tag: lets a forcing site skip re-classification in hot cases. */
export type VTag = 'keyword' | 'numeric' | 'color' | 'quoted' | 'unknown';

/**
 * The lazy value-literal leaf (VALUE-LITERAL-TAG, perf #2): the authored/canonical
 * byte string plus a small tag. Emit reads `bytes` directly — NO object is
 * materialized for the common static case. Materialization to a `ValueObj` happens
 * on demand, only when an operation / comparison / guard / typed function param
 * forces object behaviour.
 */
export interface ValueLiteral {
  readonly lit: true;
  readonly bytes: string;
  readonly tag: VTag;
}

export const literal = (bytes: string, tag: VTag = 'unknown'): ValueLiteral => ({ lit: true, bytes, tag });

/* --------------------------------------------------------- value domain */

/** A number + unit result, e.g. `3px`, `50%`, `5`. */
export interface Numeric {
  readonly kind: 'numeric';
  readonly number: number;
  readonly unit: string;
  /** Canonical emitted bytes (produced by the evaluator, byte-faithful). */
  readonly bytes: string;
}

/** A color result. `format`/`modernSyntax`/`node` preserve output spelling. */
export interface ColorVal {
  readonly kind: 'color';
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
  /** Output-format tag (a small opaque enum value shared with the adapter). */
  readonly format: number;
  readonly modernSyntax?: boolean;
  /** Original literal source (e.g. `#aaa`, `blue`) preserved for verbatim emit. */
  readonly node?: string;
  readonly bytes: string;
}

/** A quoted string result (`~"..."` escaping tracked). */
export interface Quoted {
  readonly kind: 'quoted';
  readonly value: string;
  readonly quote: string;
  readonly escaped: boolean;
  readonly bytes: string;
}

/** A non-operable identifier (`solid`, `red` before color-ification). */
export interface Keyword {
  readonly kind: 'keyword';
  readonly text: string;
  readonly bytes: string;
}

/** A list result (comma / space / slash separated). */
export interface ListVal {
  readonly kind: 'list';
  readonly items: readonly ValueObj[];
  readonly sep: ',' | ' ' | '/';
  readonly bytes: string;
}

/** A boolean result (guards, logical fns). */
export interface BoolVal {
  readonly kind: 'bool';
  readonly value: boolean;
  readonly bytes: string;
}

/** An empty / absent value. */
export interface NilVal {
  readonly kind: 'nil';
  readonly bytes: string;
}

export type ValueObj = Numeric | ColorVal | Quoted | Keyword | ListVal | BoolVal | NilVal;

/** Every materialized value carries its emit bytes; a literal leaf does too. */
export type Value = ValueObj | ValueLiteral;

export const emitValue = (v: Value): string => v.bytes;

export const isLiteral = (v: Value): v is ValueLiteral => (v as ValueLiteral).lit === true;

/* --------------------------------------------------------------- modes */

/**
 * The three configured modes value evaluation honors, injected at the seam (NOT
 * the whole legacy `Context`). `mathMode` governs `shouldOperate`; `unitMode`
 * governs the unit-clash → `calc()` fallback; `functionMode` governs whether an
 * unknown function is evaluated or emitted verbatim.
 */
export interface EvalModes {
  readonly mathMode: 'always' | 'parens-division' | 'parens';
  readonly unitMode: 'preserve' | 'canonicalize' | 'strict';
  readonly functionMode: 'preserve' | 'evaluate';
}

export const DEFAULT_MODES: EvalModes = {
  mathMode: 'parens-division',
  unitMode: 'preserve',
  functionMode: 'preserve',
};

/* --------------------------------------------------------------- seam */

/**
 * The synchronous, typed value evaluator (replaces `ValueService`). Operands and
 * results are TYPED `ValueObj`s, not bytes — pattern-match-by-typed-value,
 * type-fns, and calc/escaping become possible because types survive the seam.
 */
export interface ValueEvaluator {
  /** Classify / parse a value-literal leaf into a typed value, on demand. */
  materialize(leaf: ValueLiteral): ValueObj;
  /** Binary operation on two materialized operands (native / delegated math). */
  operate(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj;
  /** Named-function call on a materialized arg list. Sync unless a genuinely
   * async built-in forces a thenable (scoped to the forcing leaf). */
  call(name: string, args: ListVal, modes: EvalModes): MaybePromise<ValueObj>;
  /** Guard comparison leaf (`@a > 0`) on typed operands -> boolean. */
  guardCmp(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): boolean;
  /** Guard type-function leaf (`iscolor(@a)`) on typed args -> boolean. */
  guardCall(name: string, args: ListVal, modes: EvalModes): boolean;
}
