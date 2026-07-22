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
 * nothing else (no wrapper, no stored tag, no allocation). Adjacent value terms
 * are the raw recursive array shape, not a space-separator List. The seam is
 * `Value = ValueGroup | string`; a literal's type is DERIVED on demand only when
 * something forces object behaviour (`materialize`).
 *
 * Sync by default: `operate`/`compare`/`typeCheck`/`materialize` are synchronous;
 * only `call` returns `MaybePromise` (a genuinely async built-in — `data-uri`, or
 * an async color-format fn — forces the enclosing declaration's emit onto the
 * async branch, scoped to that leaf).
 */

import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { EqualityMode, FunctionMode, MathMode, UnitMode } from '../types/modes.js';
import type { Fn, FnCtx, FnIo } from './functions/types.js';

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
   * CompoundSelector-unit multiset carried across chained arithmetic (less.js `Unit`).
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

/**
 * The separator fact carried by a materialized list value.
 *
 * A List is only an explicit comma or slash boundary. Adjacent terms are the
 * raw recursive {@link ValueGroup} array and emit with spaces by default;
 * semicolon groups lower to comma at the grammar boundary.
 */
export type ListSeparator = ',' | '/';

/** A list result with an explicit separator fact. Delimiters are `Block` values. */
export interface List {
  readonly type: 'List';
  /** The one semantic payload of a List. */
  readonly value: readonly ValueGroup[];
  readonly sep: ListSeparator;
  readonly bytes: string;
}

/**
 * A delimiter-preserving value wrapper. Square `Block`s are Sass bracketed
 * lists around any structural value group; paren `Block`s preserve ordinary grouping.
 * Delimiters are intentionally not folded into List, so a list can be reused
 * with or without brackets by a universal list function.
 */
export interface Block {
  readonly type: 'Block';
  readonly inner: ValueGroup;
  readonly delimiter: 'paren' | 'square';
  readonly escaped?: boolean;
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

export type ValueObj = Dimension | Color | Quoted | Keyword | List | Block | Bool | Nil;

/**
 * The canonical structural value carrier. A raw array is a default
 * space-separated sequence; explicit comma/slash boundaries use {@link List}.
 * Arrays may nest only as syntax already permits nested value groups (for
 * example, rows inside a comma List); no wrapper node is introduced.
 */
export type ValueGroup = ValueObj | readonly ValueGroup[];

/** Narrow a structural value group to its raw default-spaced array form. */
export const isValueGroupArray = (value: ValueGroup): value is readonly ValueGroup[] => Array.isArray(value);

/** Guard untrusted direct-call input without creating a compatibility wrapper. */
export const isValueGroup = (value: unknown): value is ValueGroup =>
  Array.isArray(value)
    ? value.every(isValueGroup)
    : typeof value === 'object' && value !== null && 'type' in value;

/**
 * A `Value` in the evaluation lane: either a materialized typed object, or a BARE
 * `string` — the un-materialized literal leaf carrying just its bytes (rep "B").
 */
export type Value = ValueGroup | string;

/** Emit a value's bytes. A bare-string literal is its own bytes. */
export const emitValue = (v: Value): string =>
  typeof v === 'string' ? v : isValueGroupArray(v) ? v.map(emitValue).join(' ') : v.bytes;

/** The whitespace glue joining a list's items for its separator (`,`→`, `, `/`→` / `). */
export const sepGlue = (sep: ListSeparator): string => {
  switch (sep) {
    case ',': return ', ';
    case '/': return ' / ';
  }
};

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
 * `inCalc` is set while folding the argument of a `calc(…)`: inside calc only
 * safe-unit dimension math computes (`10px * 2` → `20px`), while a cross-unit
 * `+`/`-` (`100% - 30px`) is PRESERVED as a `calc(…)` sub-expression instead of
 * collapsing on raw magnitudes.
 */
export interface EvalModes {
  readonly unitMode: UnitMode;
  /** Less arithmetic policy; parentheses are tracked by the AST walker. */
  readonly mathMode?: MathMode;
  /** Registered-function failure policy supplied by the active compile Context. */
  readonly functionMode?: FunctionMode;
  /** Guard-comparison compatibility rule supplied by the active compile Context. */
  readonly equalityMode?: EqualityMode;
  readonly inCalc?: boolean;
}

export const DEFAULT_MODES: EvalModes = {
  unitMode: 'preserve',
  mathMode: 'parens-division'
};

/* --------------------------------------------------------------- seam */

/**
 * The synchronous, typed value evaluator (replaces `ValueService`). Operands and
 * results are TYPED `ValueObj`s, not bytes — pattern-match-by-typed-value,
 * type-fns, and calc/escaping become possible because types survive the seam.
 */
/**
 * [plugin/P1] A scope-frame function view passed alongside a named call: walks the
 * `Frame.fns` chain nearest-first and returns a native {@link Fn} when the name is
 * registered by a `@plugin`/`@use` (or scoped `.jess`) directive in scope. `null`
 * (and an omitted `scope` arg) mean "no scoped functions anywhere" — the idle path,
 * where the evaluator consults only the flat global registry, exactly as before.
 */
export interface FnScope {
  lookup(name: string): Fn | undefined;
}

/**
 * [plugin/P2] The driver-injected plugin runtime — core's ONLY coupling to the
 * Less/`@use` plugin world. Core knows the AST shape of a `@plugin` directive and
 * the `Fn` contract; it knows NOTHING about module resolution, the `less`/`tree`
 * shim, or CJS sandboxing — those live entirely in the consumer package
 * (`@jesscss/plugin-less`), which builds this host and passes it in. Core scans a
 * block's statements for `@plugin` directives, extracts each specifier, and asks
 * the host to turn it into native `Fn`s for the block's frame (Lane 1). Absent
 * (the idle path: no plugins) means no scoped functions anywhere — byte- and
 * cost-identical to a plain render.
 */
/** Evaluated grammar facts handed to the Context-injected Plugin capability. */
export interface PluginRequest {
  readonly specifier: string;
  readonly options: string | null;
}

/**
 * A declaration map projected only for an optional legacy-plugin invocation.
 * This is a transport fact, not a value-domain node: a detached ruleset remains
 * an AST statement/binding everywhere else.
 */
export interface PluginDetachedRuleset {
  readonly type: 'DetachedRuleset';
  readonly rules: readonly PluginDetachedDeclaration[];
}

export interface PluginDetachedDeclaration {
  readonly name: string;
  readonly value: ValueGroup;
}

/** A raw recursive value-sequence is the legacy `tree.Expression` source. */
export type PluginRawArgument = ValueObj | PluginDetachedRuleset | readonly ValueGroup[];

export interface PluginHost {
  /**
   * GLOBAL functions contributed by config-injected `install`-style Less plugins
   * (not `@plugin` directives) — registered into the ROOT frame so they are
   * visible document-wide. Empty/absent on renders with no configured plugins.
   */
  globalFns?: readonly Fn[];
  /**
   * Resolve and execute one grammar-owned Plugin fact. The caller supplies
   * already-evaluated target/options; this capability never recovers syntax
   * from source bytes. Context and its plugins own path/module dispatch, while
   * the dialect adapter converts any legacy plugin ABI to native Fns here.
   */
  loadPlugin?(request: PluginRequest): MaybePromise<readonly Fn[]>;
  /**
   * Optional legacy-plugin escape hatch for a function selected from this host
   * whose argument list contains a detached ruleset. The ordinary `Fn` contract
   * stays value-domain-only; this method is never consulted for normal calls.
   * `undefined` declines the call and leaves normal function dispatch intact.
   */
  invokeRawFunction?(
    fn: Fn,
    args: readonly PluginRawArgument[],
    ctx: FnCtx
  ): MaybePromise<ValueGroup | undefined>;
}

export interface ValueEvaluator {
  /**
   * Materialize a SYNTHETIC / COMPUTED string (a joined `Sequence`/`Interpolation` result,
   * or an opaque fragment) into a typed value by sniffing its bytes. A PARSED typed
   * literal never reaches here — the serializer builds its value from the node's own
   * fields (`evalTyped`). Only OPERATED literals are materialized at all; the inert
   * majority emit their verbatim bytes and never touch this seam.
   */
  materialize(bytes: string): ValueObj;
  /** Binary operation on two materialized operands (direct / delegated math). */
  operate(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj;
  /** Named-function call on a materialized arg list. Sync unless a genuinely
   * async built-in forces a thenable (scoped to the forcing leaf). `scope`, when
   * supplied non-null, is consulted FIRST (scoped `@plugin`/`@use` fns shadow
   * built-ins); omitted/`null` is the idle path — flat global registry only.
   * `io`, when supplied, is the per-render file-read capability an IO built-in
   * (`data-uri`/`image-*`) reaches through {@link FnCtx.io}; absent on renders
   * with no IO host wired. */
  call(
    name: string,
    args: ValueGroup,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,
    /** Called only when a registered function is preserved after it rejects. */
    onUnresolved?: (error: unknown) => void,
  ): MaybePromise<ValueGroup>;
  /** Guard comparison leaf (`@a > 0`) on typed operands -> boolean. */
  compare(op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean;
  /** Guard type-function leaf (`iscolor(@a)`) on typed args -> boolean. */
  typeCheck(name: string, args: ValueGroup, modes: EvalModes): boolean;
}
