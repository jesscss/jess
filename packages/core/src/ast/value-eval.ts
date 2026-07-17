/**
 * The VALUE domain + the synchronous VALUE-EVALUATOR seam.
 *
 * Two things live here, both boundary-clean (imports only pure types):
 *
 *  1. The runtime VALUE DOMAIN (`ValueObj`) — the typed *results* an evaluation
 *     produces and operates on (`Dimension`/`Color`/`Quoted`/`Keyword`/`List`/
 *     `Bool`/`Nil`), distinct from the value AST (`Operation`/`FunctionCall`/…)
 *     that describes HOW to compute. The value `Dimension` is module-qualified
 *     against the AST `Dimension` node in `nodes.ts` — the split is perf-justified
 *     (a static `3px` is a bare literal string, never a value `Dimension`).
 *
 *  2. The `ValueEvaluator` seam — an injected interface whose currency is TYPED
 *     value objects rather than serialized bytes, so pattern-match-by-type,
 *     type-fns, and calc/escaping survive it. Implementation: `evaluator.ts`.
 *
 * REPRESENTATION: an UN-MATERIALIZED value literal is a BARE `string` — its bytes,
 * nothing else (no wrapper, no stored tag, no allocation). The seam is
 * `Value = ValueObj | string`; a literal's type is DERIVED on demand only when
 * something forces object behaviour (`materialize`).
 *
 * Sync by default: `operate`/`compare`/`typeCheck`/`materialize` are synchronous;
 * only `call` returns `MaybePromise` (a genuinely async built-in — `data-uri`, or
 * an async color-format fn — forces the enclosing declaration's emit onto the
 * async branch, scoped to that leaf).
 */

import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { UnitMode } from '../types/modes.js';
import type { LiteralTag, LitFields } from './literal-tag.js';

/* --------------------------------------------------------- value domain */

/**
 * A number + unit result, e.g. `3px`, `50%`, `5`. The value-domain `Dimension`
 * (module-qualified against the AST `Dimension` node in `nodes.ts`).
 */
export interface Dimension {
  readonly type: 'Dimension';
  readonly number: number;
  /**
   * The DISPLAY unit (what {@link serializeDimension} emits), e.g. `px`, `%`, ``.
   * For an arithmetic result it is derived from {@link numerator}/{@link denominator}
   * per less.js `Unit.genCSS` (single numerator → that unit; else the {@link backupUnit};
   * else the first denominator; else empty).
   */
  readonly unit: string;
  /**
   * Compound-unit multiset carried across chained arithmetic (less.js `Unit`).
   * Present only on an operation RESULT whose units don't collapse to a single
   * `unit` (e.g. `cats*dogs`, `px/s`); absent on a plain authored dimension, where
   * the unit multiset is simply `[unit]` (numerator) / `[]` (denominator).
   */
  readonly numerator?: readonly string[];
  readonly denominator?: readonly string[];
  /** less.js `Unit.backupUnit`: the authored unit, shown when the numerator isn't singular. */
  readonly backupUnit?: string;
  /** Canonical emitted bytes (byte-faithful; produced by the free serializer). */
  readonly bytes: string;
}

/** A color result. `format`/`modernSyntax`/`node` preserve output spelling. */
export interface Color {
  readonly type: 'Color';
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
  /**
   * OPTIONAL / LAZY HSL source of truth (perf-neutral, converged-shape addition).
   * Present ONLY when the color was authored or derived in HSL (`hsl(...)`, or an
   * hsl op like `lighten`/`desaturate`); ABSENT for static hex/rgb literals so
   * they never allocate it. When present, it is the exact hsl carried across
   * chained hsl ops (no rgb round-trip → no hue drift), mirroring the legacy
   * `Color._hslChannels`. Unclamped: `[h(deg), s(0-1), l(0-1)]`. Read it through
   * `colorHsl(c)` (which derives from rgb when absent).
   */
  readonly hsl?: readonly [number, number, number];
  /** Output-format tag (a small opaque enum value; see `color.ts` HEX/RGB/HSL). */
  readonly format: number;
  readonly modernSyntax?: boolean;
  /** Original literal source (e.g. `#aaa`, `blue`) preserved for verbatim emit. */
  readonly node?: string;
  /**
   * SOURCE-FORMAT preservation for an un-operated color CONSTRUCTOR (the verbatim
   * rule applied to `rgb`/`hsl` literals — `rgb(50%,0,0)` stays `rgb(50%, 0, 0)`,
   * `hsl(0deg,…)` keeps `deg`, an alpha `50%` stays `50%`). Mirrors what the legacy
   * `Color` reproduces from its channel/alpha source tuples. All ABSENT for hex/
   * named literals and for OPERATED results (a new color drops them → canonical
   * channels), so the common path allocates nothing.
   *
   * `rgbPct[i]` = the authored percent (raw number) when RGB channel `i` was written
   * as `%`, else `undefined`; the field is present only when some channel used `%`.
   */
  readonly rgbPct?: readonly (number | undefined)[];
  /** Authored alpha percent (raw number) when alpha was written as `%`; else absent (alpha emits as a decimal). */
  readonly alphaPct?: number;
  /** Authored hue unit (`deg`/`turn`/`rad`/`grad`/…) for an HSL constructor; absent → unitless/derived (non-modern drops it, modern defaults to `deg`). */
  readonly hueUnit?: string;
  readonly bytes: string;
}

/** A quoted string result (`~"..."` escaping tracked). */
export interface Quoted {
  readonly type: 'Quoted';
  readonly value: string;
  readonly quote: string;
  readonly escaped: boolean;
  readonly bytes: string;
}

/** A non-operable identifier (`solid`, `red` before color-ification). */
export interface Keyword {
  readonly type: 'Keyword';
  readonly text: string;
  readonly bytes: string;
}

/** A list result (comma / space / slash separated). */
export interface List {
  readonly type: 'List';
  readonly items: readonly ValueObj[];
  readonly sep: ',' | ' ' | '/';
  readonly bytes: string;
}

/** A boolean result (guards, logical fns). */
export interface Bool {
  readonly type: 'Bool';
  readonly value: boolean;
  readonly bytes: string;
}

/** An empty / absent value. */
export interface Nil {
  readonly type: 'Nil';
  readonly bytes: string;
}

export type ValueObj = Dimension | Color | Quoted | Keyword | List | Bool | Nil;

/**
 * A `Value` in the evaluation lane: either a materialized typed object, or a BARE
 * `string` — the un-materialized literal leaf carrying just its bytes (rep "B").
 */
export type Value = ValueObj | string;

/** Emit a value's bytes. A bare-string literal is its own bytes. */
export const emitValue = (v: Value): string => (typeof v === 'string' ? v : v.bytes);

/** The whitespace glue joining a list's items for its separator (`,`→`, `, `/`→` / `). */
export const sepGlue = (sep: ',' | ' ' | '/'): string => (sep === ',' ? ', ' : sep === '/' ? ' / ' : ' ');

/** Whether a value is an un-materialized (bare-string) literal leaf. */
export const isLiteral = (v: Value): v is string => typeof v === 'string';

/**
 * Construct an un-materialized literal leaf. In rep "B" this is the identity on
 * the bytes — kept as a named helper so fold call-sites read intentionally and a
 * future representation change has one seam.
 */
export const literal = (bytes: string): string => bytes;

/* --------------------------------------------------------------- modes */

/**
 * The configured mode value evaluation honors, injected at the seam. `unitMode`
 * (the canonical {@link UnitMode}) governs the unit-clash → `calc()` fallback.
 */
export interface EvalModes {
  readonly unitMode: UnitMode;
}

export const DEFAULT_MODES: EvalModes = {
  unitMode: 'preserve',
};

/* --------------------------------------------------------------- seam */

/**
 * The synchronous, typed value evaluator (replaces `ValueService`). Operands and
 * results are TYPED `ValueObj`s, not bytes — pattern-match-by-typed-value,
 * type-fns, and calc/escaping become possible because types survive the seam.
 */
export interface ValueEvaluator {
  /**
   * Materialize a literal (its verbatim bytes) into a typed value. When `tag` is
   * supplied (the parser's `LIT_*` classification, sourced from the packed node),
   * materialization is a `switch` on the tag — no byte re-classification. When
   * absent (a synthetic / computed string with no parse tag), the evaluator falls
   * back to a sniff. Only OPERATED literals are materialized; the ~98% inert
   * literals emit their verbatim bytes and never reach here.
   */
  materialize(bytes: string, tag?: LiteralTag, lit?: LitFields): ValueObj;
  /** Binary operation on two materialized operands (direct / delegated math). */
  operate(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj;
  /** Named-function call on a materialized arg list. Sync unless a genuinely
   * async built-in forces a thenable (scoped to the forcing leaf). */
  call(name: string, args: List, modes: EvalModes): MaybePromise<ValueObj>;
  /** Guard comparison leaf (`@a > 0`) on typed operands -> boolean. */
  compare(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): boolean;
  /** Guard type-function leaf (`iscolor(@a)`) on typed args -> boolean. */
  typeCheck(name: string, args: List, modes: EvalModes): boolean;
}
