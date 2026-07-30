/**
 * The VALUE domain + the synchronous VALUE-EVALUATOR seam.
 *
 * Two things live here, both boundary-clean (imports only pure types):
 *
 *  1. The runtime value nodes (`Value`) — the typed *results* an evaluation
 *     produces and hands to functions/visitors (`Dimension`/`Color`/`Quoted`/
 *     `Keyword`/`Any`/`List`/`Bool`/`Nil`), distinct from the value AST
 *     (`Operation`/`FunctionCall`/…) that describes HOW to compute. A value
 *     `Color` has semantic fields such as `rgb` and `alpha`; a value
 *     `Dimension` has `number` and `unit`.
 *
 *  2. The `ValueEvaluator` seam — an injected interface whose currency is TYPED
 *     value objects rather than serialized bytes, so pattern-match-by-type,
 *     type-fns, and calc/escaping survive it. Implementation: `evaluator.ts`.
 *
 * REPRESENTATION: the internal emit lane may carry inert literal bytes as a BARE
 * `string` until a typed consumer needs a value node. That is an implementation
 * detail, not the function/visitor contract: any operation, comparison, typed
 * function parameter, plugin value lookup, or visitor value hook receives typed
 * value nodes with semantic payload fields. Adjacent value terms are the raw
 * recursive array shape, not a space-separator List.
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

/** A color result. `format`/`modernSyntax`/`src` preserve output spelling. */
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
  readonly src?: string;

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
 * Opaque evaluated bytes produced by explicit unquote APIs such as Less `e()`.
 * Value-domain `Any.bytes` is distinct from parsed AST `Any.src`: both carry
 * opaque CSS bytes, but this shape is already evaluated and must emit as-is.
 */
export interface Any {
  readonly type: 'Any';
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
  readonly value: ValueGroup;
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

/**
 * One key/value pair of a {@link Collection}, in AUTHORED order.
 *
 * `key` is a full {@link ValueGroup}, not a string: a Sass map key is a VALUE
 * (`(1: a)` keys on the number `1`, `(red: a)` on the colour), and equality is
 * value equality, never byte equality. It is a `ValueGroup` rather than a
 * scalar `Value` so parsers can hand over sequence keys without a breaking
 * narrowing here.
 *
 * `variable` / `important` are BYTE facts carried from the authoring dialect so
 * the canonical spelling survives a round trip (`{ @a: 1 }`, `{ a: 1 !important }`).
 * Both are omitted on the ordinary entry, keeping the common shape monomorphic.
 */
export interface CollectionEntry {
  readonly key: ValueGroup;
  readonly value: ValueGroup;

  /** Authored as a VARIABLE declaration (`{ @a: 1 }`) — emits the `@` sigil. */
  readonly variable?: boolean;
  readonly important?: boolean;
}

/**
 * A MAP result — the value-domain projection of the AST `Collection` node in
 * `nodes.ts`, module-qualified against it exactly as the value {@link Dimension}
 * is against the AST `Dimension`.
 *
 * This is the DATA half of the Collection two-role model: a `Collection` reaching
 * a value/arg position is data (this type), while a `Collection` at a property
 * root is structure (expanded to hyphenated declarations by the serializer's body
 * walk, which never reaches here).
 *
 * Entries are ORDERED and key-equality-sensitive, matching Sass map semantics.
 * A Collection is also a LIST of pairs: `groupItems` yields each entry as a
 * two-item `[key, value]` group, so `length((a: 1, b: 2))` is 2 and
 * `nth((a: 1, b: 2), 1)` is `a 1` with no map-specific code in the list fns.
 *
 * `bytes` is the canonical Jess collection spelling `{ a: 1; b: 2 }` (`{}` when
 * empty) — deliberately NOT the Sass paren-map syntax, which is INPUT syntax the
 * parser lowers away.
 */
export interface Collection {
  readonly type: 'Collection';
  readonly entries: readonly CollectionEntry[];

  /** The carrier's own value in the SCSS nested property `font: 20px { … }`;
   * omitted when the block has no own value. */
  readonly base?: ValueGroup;
  readonly bytes: string;
}

export type Value = Dimension | Color | Quoted | Keyword | Any | List | Block | Bool | Nil | Collection;

/**
 * The canonical structural value carrier. A raw array is a default
 * space-separated sequence; explicit comma/slash boundaries use {@link List}.
 * Arrays may nest only as syntax already permits nested value groups (for
 * example, rows inside a comma List); no wrapper node is introduced.
 */
export type ValueGroup = Value | readonly ValueGroup[];

/** Narrow a structural value group to its raw default-spaced array form. */
export const isValueGroupArray = (value: ValueGroup): value is readonly ValueGroup[] => Array.isArray(value);

/** Guard untrusted direct-call input without creating a compatibility wrapper. */
export const isValueGroup = (value: unknown): value is ValueGroup =>
  Array.isArray(value)
    ? value.every(isValueGroup)
    : typeof value === 'object' && value !== null && 'type' in value;

/**
 * A value in the internal evaluation lane: either a typed value node/group, or
 * inert literal bytes that have not yet crossed a typed boundary.
 */
export type EvalValue = ValueGroup | string;

/** Emit a value's bytes. A bare-string literal is its own bytes. */
export const emitValue = (v: EvalValue): string =>
  typeof v === 'string' ? v : isValueGroupArray(v) ? v.map(emitValue).join(' ') : v.bytes;

/** The whitespace glue joining a list's items for its separator (`,`→`, `, `/`→` / `). */
export const sepGlue = (sep: ListSeparator): string => {
  switch (sep) {
    case ',': return ', ';
    case '/': return ' / ';
  }
};

/** Whether a value is an internal bare-byte literal leaf. */
export const isLiteral = (v: EvalValue): v is string => typeof v === 'string';

/**
 * Construct an internal bare-byte literal leaf. Typed boundaries materialize it
 * before function/plugin/visitor code observes the value.
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
 * results are typed value nodes, not bytes — pattern-match-by-typed-value,
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
export type PluginRawArgument = Value | PluginDetachedRuleset | readonly ValueGroup[];

/**
 * One `!important`-flagged binding fact, alongside the value itself. Less's
 * `importantScope` lets a variable's importance ride out to the declaration
 * that read it; a legacy plugin reads the pair, so the shim carries both.
 */
export interface PluginVariableHit {
  readonly value: PluginRawArgument;
  readonly important: boolean;
}

/**
 * The live-frame capabilities a LEGACY plugin function body needs but the
 * value-domain `Fn` contract deliberately does not expose: reading a variable
 * from the call-site scope, calling a built-in by name, the source position the
 * call was written at, and a sink for `less.logger` output. Supplied only on the
 * `invokeRawFunction` seam — the ordinary function contract stays
 * value-domain-only.
 */
export interface PluginCallCtx extends FnCtx {
  /** Resolve `@name` against the LIVE call-site frame chain. */
  readonly lookupVariable: (name: string) => PluginVariableHit | null;

  /** Evaluate a built-in function by name on already-typed arguments. */
  readonly callFunction: (name: string, args: readonly ValueGroup[]) => ValueGroup | undefined;

  /** The file the call was written in, and the entry file of the render. */
  readonly currentFileInfo: { readonly filename: string; readonly entryPath: string };

  /** Records one `less.logger` record emitted while the plugin ran. */
  readonly log: (record: { level: string; message: string }) => void;

  /** Hoists `!important` onto the declaration whose value this call folds into. */
  readonly markImportant: () => void;
}

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
   * Legacy-plugin invocation seam. A function selected from this host receives
   * its arguments in raw form (detached rulesets survive as declaration maps)
   * plus the live-frame {@link PluginCallCtx}, because a Less 4 plugin body
   * reads scope and built-ins directly. The ordinary `Fn` contract stays
   * value-domain-only; this method is never consulted for a built-in call.
   * `undefined` declines the call and leaves normal function dispatch intact.
   */
  invokeRawFunction?(
    fn: Fn,
    args: readonly PluginRawArgument[],
    ctx: PluginCallCtx
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
  materialize(bytes: string): Value;

  /** Binary operation on two materialized operands (direct / delegated math). */
  operate(op: string, left: Value, right: Value, modes: EvalModes): Value;

  /** Named-function call on a materialized arg list. Sync unless a genuinely
   * async built-in forces a thenable (scoped to the forcing leaf). `scope`, when
   * supplied non-null, is consulted FIRST (scoped `@plugin`/`@use` fns shadow
   * built-ins); omitted/`null` is the idle path — flat global registry only.
   * `io`, when supplied, is the per-render file-read capability an IO built-in
   * (`data-uri`/`image-*`) reaches through {@link FnCtx.io}; absent on renders
   * with no IO host wired. `scopedFn`, when supplied, is an already-resolved
   * lexical function. It avoids repeating the caller's scope lookup; `scope`
   * remains for direct consumers that need the legacy lazy lookup seam. */
  call(
    name: string,
    args: ValueGroup,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,
    /** A caller-resolved scoped function; takes precedence over `scope`. */
    scopedFn?: Fn,
  ): MaybePromise<ValueGroup>;

  /** Guard comparison leaf (`@a > 0`) on typed operands -> boolean. */
  compare(op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean;

  /** Guard type-function leaf (`iscolor(@a)`) on typed args -> boolean. */
  typeCheck(name: string, args: ValueGroup, modes: EvalModes): boolean;
}
