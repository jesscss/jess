/**
 * The VALUE domain + the synchronous VALUE-EVALUATOR seam.
 *
 * Two things live here, both boundary-clean (imports only pure types):
 *
 *  1. The runtime value nodes (`Value`) — the typed *results* an evaluation
 *     produces and hands to functions/visitors (`Dimension`/`Color`/`Quoted`/
 *     `Keyword`/`Any`/`UrlValue`/`List`/`Bool`/`Null`), distinct from the value AST
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
 * Sync by default: `operate`/`compare`/`typeCheck` are synchronous;
 * only `call` returns `MaybePromise` (a genuinely async built-in — `data-uri`, or
 * an async color-format fn — forces the enclosing declaration's emit onto the
 * async branch, scoped to that leaf).
 */

import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { FunctionMode, MathMode, UnitMode } from '../types/modes.js';
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

  /**
   * §4.7 — the AUTHORED expression this value was computed from, WITHOUT a
   * `calc()` wrapper (`1.4em * 14px`), in authored operand order.
   *
   * Present only under `unitMode: 'preserve'` and only while the composed unit
   * multiset has no CSS spelling. It is a SPELLING, never the value: `number`
   * and `numerator`/`denominator` remain the computed truth, so `unit()` reads a
   * real magnitude and a later operation still cancels the multiset
   * (`1px * 1px / 1px` → `1px`, at which point the unit is expressible again and
   * this field is simply not carried forward).
   *
   * This is why `preserve` is not "decline to compute". Every rung of the ladder
   * computes; they differ only in what an unexpressible RESULT is allowed to look
   * like — `loose` fabricates a unit from `backupUnit`, `preserve` says the
   * expression back, `strict` refuses at the consuming boundary.
   *
   * The same spelling is carried, in every unit mode, by a `calc()` written as a
   * paren group around one value (`calc((10px))` is `10px` spelled `(10px)`):
   * a paren authored inside a math function around a value nothing computes is
   * kept (owner 2026-10-06), and a typed consumer still reads the magnitude.
   */
  readonly preserved?: string;

  /** Canonical emitted bytes (byte-faithful; produced by the free serializer). */
  readonly bytes: string;
}

/** A color result. `format`/`modernSyntax`/`src` preserve output spelling. */
export interface Color {
  readonly type: 'Color';

  /** RAW (unrounded, unclamped) channels; derived from `hsl` when that is present. */
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

  /**
   * PROVENANCE, not a second value: the quote an escaped string (`~"…"`,
   * `~'…'`, `e()`) was written with, `''` for any other opaque text. Nothing in
   * the value domain computes with it; it is what lets a legacy plugin receive
   * the escaped `tree.Quoted` Less 4.x hands it, and what keeps a URL rewrite
   * out of an escaped `url()` body. Non-optional and factory-defaulted, so
   * every `Any` realizes one hidden class.
   */
  readonly escapedQuote: string;
}

/**
 * The separator fact carried by a materialized list value.
 *
 * A List is an explicit comma, slash or semicolon boundary. Adjacent terms are
 * the raw recursive {@link ValueGroup} array and emit with spaces by default.
 * Less semicolon argument groups lower to comma at the grammar boundary; a `;`
 * List only comes from a CSS function body (`if(style(--x: y): a; else: b)`).
 */
export type ListSeparator = ',' | '/' | ';';

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
 * lists around any structural value group; paren `Block`s preserve ordinary
 * grouping; curly `Block`s are css-values-5 §3.1.1 `{}`-wrapped arguments.
 * Delimiters are intentionally not folded into List, so a list can be reused
 * with or without brackets by a universal list function.
 */
export interface Block {
  readonly type: 'Block';
  readonly value: ValueGroup;
  readonly delimiter: 'paren' | 'square' | 'curly';
  readonly escaped?: boolean;
  readonly bytes: string;
}

/** A boolean result (guards, logical fns). */
export interface Bool {
  readonly type: 'Bool';
  readonly value: boolean;
  readonly bytes: string;
}

/**
 * An empty / absent value — the `null` literal (§4.3). It emits nothing AND
 * drops the separator that would follow it, which is Sass's list elision
 * (ledger M5, built for merge).
 *
 * `explicit` is PROVENANCE, not a second value: an author-written `null` and an
 * absent/unbound value are the same VALUE but not the same FACT, and core
 * already mints the implicit one (M5's unbound optional self-ref). A flag keeps
 * ONE value type rather than growing a second node — and it is NON-optional and
 * factory-defaulted so every `Null` realizes one hidden class (§9's
 * `inMathFunction` rule, NOT `Block.boundary`'s optional shape).
 */
export interface Null {
  readonly type: 'Null';

  /** The author WROTE `null`, rather than core minting an absent value. */
  readonly explicit: boolean;
  readonly bytes: string;
}

/**
 * One effective key/value pair of a {@link Collection}. Entries retain the
 * first matching slot's order after later-wins overlay folding.
 *
 * `key` is a full {@link ValueGroup}, not a string: a Sass map key is a VALUE
 * (`(1: a)` keys on the number `1`, `(#c6538c: a)` on a colour), and equality is
 * value equality, never byte equality. It is a `ValueGroup` rather than a
 * scalar `Value` so parsers can hand over sequence keys without a breaking
 * narrowing here.
 *
 * `important` is a BYTE fact carried from the authoring dialect so the canonical
 * spelling survives a round trip (`{ a: 1 !important }`). It is omitted on the
 * ordinary entry, keeping the common shape monomorphic.
 */
export interface CollectionEntry {
  readonly key: ValueGroup;
  readonly value: ValueGroup;

  readonly important?: boolean;
}

/**
 * A MAP result — the value-domain projection of the AST `Collection` node in
 * `nodes.ts`, module-qualified against it exactly as the value {@link Dimension}
 * is against the AST `Dimension`.
 *
 * An AST `Collection` is always data. SCSS nested-property structure uses the
 * distinct AST `NestedPropertyBlock` and is expanded before this value boundary.
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
  readonly bytes: string;
}

/**
 * A `url(...)` consumed through the typed value boundary. The parser-owned AST
 * wrapper is projected here without exposing its inner syntax to functions;
 * `bytes` already includes the wrapper and any configured URL transform.
 */
export interface UrlValue {
  readonly type: 'Url';
  readonly bytes: string;
}

export type Value = Dimension | Color | Quoted | Keyword | Any | UrlValue | List | Block | Bool | Null | Collection;

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
/**
 * Whether a value ELIDES from the group holding it. `null` emits nothing AND
 * drops the separator that would follow it (§4.3, ledger M5) — measured on
 * dart-sass 1.101.0: `b: 1px null 2px` is `b: 1px 2px`, not `b: 1px  2px`.
 *
 * A nested group elides only when it is NON-EMPTY and every member elides, so an
 * authored empty group keeps its present (empty-bytes) behavior.
 */
export const isElided = (v: ValueGroup): boolean =>
  isValueGroupArray(v) ? v.length > 0 && v.every(isElided) : v.type === 'Null';

/**
 * Join a group's members with `glue`, DROPPING each elided member along with the
 * separator it would have carried. Written as a loop rather than
 * `filter().map().join()` so the common (no-`null`) path allocates nothing.
 * `authored` holds the run written before each member, replayed by
 * {@link itemBoundary} (a call written out as-is, ledger F11).
 */
export const joinGroup = (
  v: readonly ValueGroup[],
  glue: string,
  emit: (item: ValueGroup) => string,
  authored?: readonly (string | undefined)[],
  compress = false
): string => {
  let out = '';
  let empty = true;
  for (let i = 0; i < v.length; i++) {
    const item = v[i]!;
    if (isElided(item)) {
      continue;
    }
    const bytes = emit(item);
    out = empty ? bytes : out + itemBoundary(authored?.[i - 1], glue, compress, bytes) + bytes;
    empty = false;
  }
  return out;
};

export const emitValue = (v: EvalValue): string =>
  typeof v === 'string' ? v : isValueGroupArray(v) ? joinGroup(v, ' ', emitValue) : v.bytes;

/**
 * The glue joining a list's items for its separator (`,`→`, `, `/`→` / `).
 * Compressed output tightens the comma (`,`); `/` stays spaced in both.
 */
export const sepGlue = (sep: ListSeparator, compress = false): string => {
  switch (sep) {
    case ',': return compress ? ',' : ', ';
    case '/': return ' / ';
    case ';': return compress ? ';' : '; ';
  }
};

/**
 * The emitted opener of a `Block` delimiter. A curly block is padded inside its
 * braces (`{ a, b }`), the spelling css-values-5 §3.1.1 and css-mixins-1 write
 * it in.
 */
export const delimiterOpen = (delimiter: Block['delimiter']): string =>
  delimiter === 'paren' ? '(' : delimiter === 'square' ? '[' : '{ ';

/** The emitted closer of a `Block` delimiter; see {@link delimiterOpen}. */
export const delimiterClose = (delimiter: Block['delimiter']): string =>
  delimiter === 'paren' ? ')' : delimiter === 'square' ? ']' : ' }';

/**
 * The bytes between two items of a list or call: the canonical `glue`, except
 * that pretty output replays an authored run carrying a line break (with its
 * indentation) or a block comment ({@link replayedRun}). Compressed output
 * always takes the glue. A `;` group the author left empty
 * (`if(media(print): 1px;)`) keeps its delimiter but not the space that would
 * only precede a value, so `next` (the following item's bytes) is consulted
 * when the caller has it. Between the members of a space-separated group, a run
 * with no whitespace in it (a glued `/`, SCSS `local(Foo/Bar)`) is the value's
 * own spelling, not layout, so it is written as authored in every mode, as
 * {@link authoredSpace} writes it in a declaration.
 */
export const itemBoundary = (authored: string | undefined, glue: string, compress: boolean, next?: string): string =>
  authored !== undefined && glue === ' ' && !/\s/u.test(authored)
    ? authored
    : !compress && authored !== undefined && runReplays(authored) ? replayedRun(authored, glue) : next === '' && glue === '; ' ? ';' : glue;

/** Whether pretty output replays an authored run between two items: it carries a line break or a block comment. */
export const runReplays = (authored: string): boolean => /[\r\n]|\/\*/u.test(authored);

/**
 * The authored run between two members of a space-separated group, as CSS
 * output replays it ({@link replayedRun}); one space when nothing was recorded.
 * A glued (`''`) or single-character run cannot hold a comment.
 */
export const authoredSpace = (authored: string | undefined): string =>
  authored === undefined ? ' ' : authored.length > 1 ? replayedRun(authored, ' ') : authored;

/**
 * An authored run as CSS output replays it: its block comments and line breaks
 * stay, a `//` line comment (Less, SCSS and .jess source only) is dropped with
 * the blanks before it, and a Less `;` argument separator is spelled as the
 * list's own `,`. A block comment is copied whole, so a `//` or `;` inside it
 * is text. A run without either character is returned as it is.
 */
function replayedRun(run: string, glue: string): string {
  if (!run.includes('//') && !run.includes(';')) {
    return run;
  }
  const comma = glue.trim() === ',';
  let out = '';
  let inComment = false;
  for (let index = 0; index < run.length; index++) {
    const char = run[index]!;
    if (inComment) {
      out += char;
      if (char === '*' && run[index + 1] === '/') {
        out += '/';
        index++;
        inComment = false;
      }
    } else if (char === '/' && run[index + 1] === '*') {
      out += '/*';
      index++;
      inComment = true;
    } else if (char === '/' && run[index + 1] === '/') {
      out = out.replace(/[ \t]+$/u, '');
      while (index + 1 < run.length && run[index + 1] !== '\n' && run[index + 1] !== '\r') {
        index++;
      }
    } else {
      out += char === ';' && comma ? ',' : char;
    }
  }
  return out;
}

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
 * No mode says where an operation is READ: one written inside a math function is
 * kept as written by its own `inMathFunction` fact and never operates, and every
 * other operation answers `unitMode` the same wherever its value lands.
 */
export interface EvalModes {
  readonly unitMode: UnitMode;

  /** Less arithmetic policy; parentheses are tracked by the AST walker. */
  readonly mathMode?: MathMode;

  /** Registered-function failure policy supplied by the active compile Context. */
  readonly functionMode?: FunctionMode;

  /**
   * [R16] Legacy Less dynamic caller-read. Carried here so a context-free
   * serialize consumer can opt into it via `modes` on the same path the Context
   * supplies it (its resolved options already carry the field). Absent = hermetic.
   */
  readonly allowCallerScope?: boolean;

  /**
   * [compress] Minified output. Carried here so the evaluator's verbatim
   * unknown-fn fallback can tighten the comma list-divider (`a(1, 2)`→`a(1,2)`)
   * on the same `modes` path the Context supplies; absent = pretty.
   */
  readonly compress?: boolean;
}

export const DEFAULT_MODES: EvalModes = {
  unitMode: 'preserve',
  mathMode: 'parens-division'
};

/**
 * A computed division whose divisor is zero. Deliberately NOT a `TypeError`: the
 * `preserve` rung catches `TypeError`s to spell an unexpressible result as
 * `calc(…)`, and a division by zero has no result to spell (DESIGN-DECISIONS
 * P35) — it is an error in every `unitMode`.
 */
export class DivisionByZeroError extends Error {
  constructor(readonly expr: string) {
    super(`${expr} divides by zero`);
    this.name = 'DivisionByZeroError';
  }
}

/**
 * An operand pair whose units cannot reconcile, raised under `unitMode: 'strict'`.
 *
 * Lives in the value domain rather than in `value-operate.ts` because BOTH
 * arithmetic and comparison raise it: `1px + 3em` and `2px > 1em` are the same
 * defect, and `serialize.ts` re-raises either with its source location by
 * matching this one class. `value-guards.ts` declares a hard module boundary
 * that admits the value domain, so a shared home here is what lets comparison
 * throw without importing the arithmetic module.
 */
export class UnitArithmeticError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'UnitArithmeticError';
  }
}

/**
 * A dimension's unit as a diagnostic names it: the whole multiset (`em*px`,
 * `px/em`), less.js `Unit.toString`. `unit` is the CSS display spelling and
 * collapses a compound to one member, which would name the wrong unit in an
 * error about exactly that compound.
 */
export function unitName(d: Dimension): string {
  let name = (d.numerator ?? (d.unit ? [d.unit] : [])).join('*');
  for (const unit of d.denominator ?? []) {
    name += `/${unit}`;
  }
  return name;
}

/** `+`/`-` or a comparison over two dimensions whose units do not reconcile. */
export function incompatibleUnits(a: Dimension, b: Dimension): UnitArithmeticError {
  return new UnitArithmeticError(`Incompatible units. Change the units or use the unit function. Bad units: '${unitName(a)}' and '${unitName(b)}'.`);
}

/**
 * A RELATIONAL comparison whose operands share no common ground
 * (`RESOLVED-SEMANTICS-AND-NAMING.md` §4.1's last row — `1px > red`).
 *
 * Relational is trichotomous over every pair that HAS a ground (§4.2): `a > b`
 * and `b > a` must not both be false, and the only honest answer for a pair with
 * no ground is to refuse rather than to invent one. Equality is deliberately
 * different — it returns `false` on the same pair and never raises — so this is
 * a distinct outcome from "there is a ground and the pair is not ordered on it"
 * (`2px > 1em` outside `unitMode: 'strict'`), which stays a silent `false`.
 *
 * Lives beside {@link UnitArithmeticError} for the same reason: `value-guards.ts`
 * declares a hard module boundary that admits the value domain, and `serialize.ts`
 * re-raises either with its source location by matching the class.
 */
export class IncomparableOperandsError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'IncomparableOperandsError';
  }
}

/**
 * An arithmetic operand that is EMPTY: the result of a function that returns
 * nothing (a Less "null function", such as a legacy `@plugin` returning
 * `false`). There is nothing to operate on, and no spelling of the operation
 * that is not a hole (`calc( + 1px)`), so it raises in every unit mode — Less
 * 4.x rejects it too ("Operation on an invalid type"). Not a `TypeError`, so the
 * preserve-mode fallback in `operate` cannot swallow it.
 */
export class EmptyOperandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyOperandError';
  }
}

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

/**
 * An argument as the parser recorded it — the `name`/`sigil`/`value` of a
 * `CallArg`, which satisfies this shape structurally. `name` is `undefined` for
 * a positional argument. `value` is the authored argument, read only as the key
 * its recorded layout is stored under.
 */
export interface ArgumentKeyword {
  readonly name: string | undefined;
  readonly sigil: string | undefined;
  readonly value: object;
}

/**
 * A call's arguments in AUTHORED order, each paired with its keyword at the same
 * index: `keywords` is the call's own argument list, so building one allocates
 * nothing per argument.
 */
export interface WrittenArguments {
  readonly args: ValueGroup;
  readonly keywords: readonly ArgumentKeyword[];
}

/**
 * The ONE spelling of an argument in a call written out as-is (ledger P23): the
 * keyword exactly as authored, then the argument's bytes. Under compress the
 * keyword's colon tightens as every other separator does.
 */
export const writtenArgument = (keyword: ArgumentKeyword, bytes: string, compress: boolean | undefined): string =>
  keyword.name === undefined
    ? bytes
    : `${keyword.sigil ?? ''}${keyword.name}${compress === true ? ':' : ': '}${bytes}`;

export interface ValueEvaluator {
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
   * remains for direct consumers that need the legacy lazy lookup seam.
   * `ambient: false` says the calling document has no ambient built-in
   * namespace (ledger P36): the registry is not consulted, so a name that is
   * not scoped takes the unknown-function path, exactly as in a document whose
   * registry is empty (ledger P17). */
  call(
    name: string,
    args: ValueGroup,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,

    /** A caller-resolved scoped function; takes precedence over `scope`. */
    scopedFn?: Fn,

    /** Whether the registry's built-ins are in scope; default `true`. */
    ambient?: boolean,

    /**
     * The arguments as written, for a call that names any of them. A call that
     * is written out as-is — an unknown name, or a function that could not
     * produce a value — is written from these, so `darken(@color: red)` keeps
     * its keyword. Omitted for a positional call, whose `args` are already as
     * written. Only read on that write-out; a call that produces a value never
     * touches it.
     */
    written?: WrittenArguments,

    /**
     * The call's own authored arguments. A call written out as-is keeps the
     * comments and line breaks the parser recorded between and inside them
     * (ledger F11), so `radial-gradient(#333 /*c*&#47;, #111)` keeps its
     * comment; they are looked up only on that write-out, in pretty output.
     */
    authored?: readonly ArgumentKeyword[],
  ): MaybePromise<ValueGroup>;

  /**
   * The callee's DECLARED parameter names, in positional order, or `undefined`
   * when `name` resolves to no known function.
   *
   * A KEYWORD argument (`color.adjust($c, $lightness: -10%)`,
   * `fade(@c, @amount: 50%)`) binds against these — the same names the function
   * was DEFINED with, which is the only place the mapping exists. An entry is
   * `undefined` for a parameter its definition left unnamed, so a keyword can
   * never bind to a position that declared no name. `ambient` is as in
   * {@link ValueEvaluator.call}.
   */
  paramNames(name: string, scopedFn?: Fn, ambient?: boolean): readonly (string | undefined)[] | undefined;

  /**
   * Whether the registry defines a built-in named `name`. A call with no scoped
   * function and no built-in is written out as-is, so its arguments are values,
   * not inputs to a callable (ledger F11).
   */
  has(name: string): boolean;

  /** Comparison leaf in VALUE position (`if(@a > 0, …)`) on typed operands -> boolean. */
  compare(op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean;

  /** Comparison leaf in GUARD position (`when (@a > 0)`) -> boolean; groundless is a
   *  non-match rather than a raise (§4.2a). */
  compareMatch(op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean;

  /** Guard type-function leaf (`iscolor(@a)`) on typed args -> boolean. */
  typeCheck(name: string, args: ValueGroup, modes: EvalModes): boolean;
}
