/**
 * Clean-room tree2 concrete node types + programmatic constructors.
 *
 * Written from scratch to reproduce the exact output BYTES the legacy renderer
 * emits for each shape — NOT to mirror the legacy serialization *method*.
 *
 * Every node is a PLAIN-DATA object with a PascalCase `type` discriminant. There
 * is no base class and no `new`. Grammar reductions construct exact object
 * literals; the free-function helpers below are optional programmatic
 * conveniences, not a construction boundary. Narrow a node with
 * `node.type === '…'` (or `isNode`).
 *
 * Selector model: a selector is a `SelectorList` of `ComplexSelector`
 * selectors; a `ComplexSelector` is a head `CompoundSelector` plus `(combinator, compound)`
 * tail segments; a `CompoundSelector` is a run of `SimpleSelector` tokens concatenated with no
 * separator (`.a` + `.b` => `.a.b`). The `&` parent-reference is just a
 * `SimpleSelector` whose text is `'&'`. Canonical selector text is computed once and
 * cached (in an optional memo field) via the free `compoundCanonical` /
 * `complexCanonical` helpers — composition (nesting) then works on these cached
 * strings, with NO per-placement node cloning / `inherit` analog.
 *
 * Trivia (comments) is carried STRUCTURALLY as a body child, so byte-identity
 * holds with zero source-position tracking.
 */

import { Combinator, renderCombinator } from './node.js';
import type { GuardNode } from './guard.js'; // [guards]
import type { CallArg } from './mixin-dispatch.js'; // [guards]

/* ------------------------------------------------------------------ values */

/*
 * VALUE LITERAL LEAVES (task #44 — honest typed leaves).
 *
 * A value leaf now carries its value TYPE honestly in the `type` discriminant
 * (no side-car `tag`): the parser's leaf classification IS the node. Every leaf
 * carries its verbatim source spelling in `src` (distinct from the value-domain
 * objects' canonical emitted `bytes` — `1.0px` src vs `1px` canonical). Only the
 * opaque `Any` leaf sniffs its bytes, and only when it is forced onto the typed
 * (operated) path — its value type is honestly unknown. `true`/`false` are NOT a
 * node type: they emit as `Keyword`; guard-context booleanness is recovered by the
 * value-domain `Bool` via the materialize sniff (VALUE-NODE-MODEL-DESIGN §CORR-4).
 *
 * The literal `type` strings REUSE the value-domain names (`Keyword`/`Color`/
 * `Dimension`/`Quoted`); the collision with `ValueObj` is neutralized by the lane
 * invariant (a value object never enters the AST-build lane) plus the `src` vs
 * `bytes` structural split (`node.ts` `AST_NODE_TYPES` doc).
 */

/** An identifier / keyword leaf, e.g. `solid`, `auto`, `true`. */
export interface Keyword {
  readonly type: 'Keyword';
  readonly src: string;
}

/** A color literal leaf, hex or named, e.g. `#fff`, `red`, `transparent`.
 *  Hex vs named is `src[0] === '#'` (read only on the cold operated path). */
export interface Color {
  readonly type: 'Color';
  readonly src: string;
}

/** A quoted string literal leaf, e.g. `"x"`, `'y'`. Pre-split fields ride so a
 *  forced literal materializes by reading them, never re-scanning `src`. */
export interface Quoted {
  readonly type: 'Quoted';
  readonly src: string;
  readonly value: string;
  readonly quote: string;
  readonly escaped: boolean;
}

/** Arbitrary / opaque value bytes (raw prelude fragment, computed/joined
 *  fragment, `url(...)`, list piece, mixin-arg bytes). The ONLY leaf that sniffs
 *  its `src` to a typed value, and only when forced (operated). */
export interface Any {
  readonly type: 'Any';
  readonly src: string;
}

/**
 * A CSS `url(…)` value. The wrapper is syntax, while the content remains an
 * ordinary structured value: a quoted literal, an interpolation template, or
 * an opaque unquoted URL token. This avoids a dialect-specific path model.
 */
export interface Url {
  readonly type: 'Url';
  readonly value: ValueNode;
}

/**
 * A Less selector-list CAPTURE value `*[…]` — a STRUCTURED list of selector
 * branches captured for interpolation into a selector position. The parser owns
 * the branch split (grammar `SelectorList`); `branches` holds the canonical text
 * of each captured complex selector, so the serializer never re-scans bytes for
 * top-level commas. Interpolated into a selector, the branches expand structurally:
 * a WHOLE-selector position emits them as comma-separated header branches, a
 * COMPOUND position compacts them into a single `:is(…)` group. As a plain value
 * (never the intended use) it emits its verbatim `src`.
 */
export interface SelectorCapture {
  readonly type: 'SelectorCapture';
  readonly branches: readonly string[];
  readonly src: string;
}

/** A numeric dimension leaf, e.g. `0px`, `10px`, `1.0px`, `50%`. Carries the
 *  parser's `number`+`unit` split plus the verbatim `src` spelling. */
export interface Dimension {
  readonly type: 'Dimension';
  readonly number: number;
  readonly unit: string;
  readonly src: string;
}

/**
 * A space-separated list of value parts, e.g. `1px solid black`. `separators`
 * is present only when authored line-break layout must survive serialization;
 * ordinary inline whitespace stays canonical as a single space.
 */
export interface SpacedValue {
  readonly type: 'SpacedValue';
  readonly parts: ValueNode[];
  readonly separators?: readonly string[];
}

/**
 * A COMMA-separated value list, e.g. `Arial, sans-serif` or `@a, @b, @c`. The
 * parser owns the top-level comma boundaries (grammar `valueList`), so the
 * segments are kept STRUCTURED as lightweight lazy `items` instead of being
 * re-concatenated into one opaque `Any` (which the value layer would then have to
 * re-split for top-level commas — the byte re-derivation the keystone forbids).
 * Each item is an ordinary value leaf carrying its own bytes: a static segment is
 * a cheap `Any`, a referenced one a `VariableReference` / space-run `SpacedValue`, all
 * materialized LAZILY (only when the list is indexed / operated). `separators`
 * carries the verbatim source bytes BETWEEN items (`,` + the authored whitespace —
 * e.g. `, ` or a multi-line `,\n    `), one per gap. Serialization NORMALIZES each
 * separator per the v5 convention (`normalizeListSep`): an inline comma collapses
 * to `, ` regardless of authored spacing, while a separator carrying a NEWLINE keeps
 * the authored multi-line layout (so a wrapped `box-shadow` stays wrapped). The raw
 * bytes are retained because that newline + indentation must survive; only the
 * inline spacing is canonicalized. Materializes to the value-domain `List` so `extract` /
 * `length` / list-equality index the structure directly (never a byte re-parse).
 */
export interface List {
  readonly type: 'List';
  readonly items: ValueNode[];
  readonly sep: ',';
  /** Verbatim source between items (`items.length - 1` entries). */
  readonly separators: readonly string[];
}

/** The binding store a variable operation addresses. */
export type VariableLookup = 'live' | 'scoped';

/** A reference to a mixin parameter / bound variable. */
export interface VariableReference {
  readonly type: 'VariableReference';
  readonly name: string;
  /** `$name` reads `live`; `$$name` and Less `@name` read `scoped`. */
  readonly lookup: VariableLookup;
}

/**
 * A property accessor `$name` (Less "property accessors"): reads the CURRENT value
 * of the CSS property `name` from the enclosing declaration scope — last-wins, and
 * cascading up the ruleset chain (`$color` inside a nested rule reads the parent
 * ruleset's final `color`). The resolved value carries the source declaration's
 * `!important` flag (`$color` of `color: red !important` → `red !important`).
 * `raw` is the verbatim source (`$name`) emitted as a literal fallback when the
 * property is not resolvable in the current ast/ scope (e.g. it would only exist
 * after a not-yet-modelled expansion), so an unresolved accessor never regresses
 * below its prior verbatim output.
 */
export interface PropertyReference {
  readonly type: 'PropertyReference';
  readonly name: string;
  readonly raw: string;
}

/**
 * A value template: literal text and `@var` references concatenated with NO
 * separator (the literal parts already carry their own spacing). This is how a
 * static value that embeds variable references is represented — e.g.
 * `1px solid @c` => Sequence[Any('1px solid '), VariableReference('c')]. Reference
 * substitution only (this rung): no arithmetic, no function evaluation.
 */
export interface Sequence {
  readonly type: 'Sequence';
  readonly parts: ValueNode[];
}

/**
 * A value carrying Less `!important` importance (`@v: @c !important`). The
 * importance is a FLAG on the value, NOT part of the emitted bytes: `inner`
 * evaluates without any inline `!important`, and the importance propagates to the
 * enclosing declaration (Less `importantScope`) so the declaration prints exactly
 * ONE trailing `!important`. A variable whose value ends in `!important` binds an
 * `Important` wrapper, so referencing it (`same: @v` / `multi: @v @v`) resolves the
 * inner value and hoists importance once — never doubling or emitting it inline.
 */
export interface Important {
  readonly type: 'Important';
  readonly inner: ValueNode;
}

/**
 * A binary value operation, e.g. `#aaa * 3` or `@a + @b`. tree2 owns the
 * STRUCTURE (operator + operand value nodes); the MATH is delegated to the
 * injected value service. Operands are themselves value nodes so nested
 * operations / variable refs fold bottom-up (each sub-operation is computed to
 * bytes before the outer one runs — precedence is carried by the tree shape).
 */
export interface Operation {
  readonly type: 'Operation';
  readonly operator: string;
  readonly left: ValueNode;
  readonly right: ValueNode;
}

/**
 * A function call value, e.g. `lighten(blue, 10%)`. tree2 owns the STRUCTURE
 * (name + a MODELED argument list) so the evaluator can bind TYPED params. Each
 * arg is an independent value node (folded bottom-up to a typed value). `modern`
 * marks CSS Color-4 modern syntax (`rgb(0 128 255 / 50%)`) — space/slash
 * separators — vs the legacy comma form, so the evaluator preserves the output
 * spelling.
 */
export interface FunctionCall {
  readonly type: 'FunctionCall';
  readonly name: string;
  readonly args: ValueNode[];
  readonly modern: boolean;
}

/** A parenthesized value, e.g. `(#aaa * 3)`. `escaped` records Less `~(...)`,
 * whose inner typed value deliberately emits without its authored delimiters. */
export interface Paren {
  readonly type: 'Paren';
  readonly inner: ValueNode;
  readonly escaped?: boolean;
}

/**
 * A structured boolean CONDITION reaching a value position — the argument of the
 * logical fns `if()` / `boolean()` / `not()` / `and()` / `or()`. It carries the
 * SAME `GuardNode` tree a `when (…)` guard builds (comparison / `and` / `or` /
 * `not` / parens / type-predicate call), so the value engine evaluates it through
 * the one guard evaluator — a `foo(@a > 0)` arg is byte-identical to the guard
 * `@a > 0`. `src` is the verbatim spelling, emitted when no evaluator is injected.
 */
export interface Condition {
  readonly type: 'Condition';
  readonly guard: GuardNode;
  readonly src: string;
}

/* -------------------------------------------------------------- value */

/**
 * One part of an interpolation template. A `lit` is verbatim bytes
 * (including any surrounding literal quote chars); a `ref` is a resolved value
 * node spliced in — `unquote:true` strips ONE layer of surrounding matching
 * quotes from the resolved bytes (Less "unquote-on-interpolation", used in
 * value/string context), `unquote:false` splices the value's CSS bytes verbatim
 * (selector / property-name context).
 */
export type InterpPart = { lit: string } | { ref: ValueNode; unquote: boolean };

/**
 * An interpolation template `@{var}` / `~"…@{x}…"` that resolves to bytes:
 * literal chunks and embedded references spliced in order. Distinct from
 * `Sequence` because a `ref` may be unquoted (`@{c}` strips quotes; `@c` does not)
 * and the literals carry their own (possibly quote) bytes.
 */
export interface Interpolation {
  readonly type: 'Interpolation';
  readonly parts: InterpPart[];
}

/**
 * CSS conditional general-enclosed syntax. Its content intentionally remains a
 * grammar-owned interpolation template: it is never interpreted as a CSS
 * function call or a parenthesized value expression.
 */
export interface GeneralEnclosed {
  readonly type: 'GeneralEnclosed';
  readonly form: 'function' | 'paren';
  /** The glued function name, or null for the parenthesized form. */
  readonly name: string | null;
  readonly content: Interpolation;
}

/**
 * Indirect variable `@@name`: a variable whose NAME is the resolved bytes
 * of another value node (`@name: var; x: @@name` → the value of `@var`). Two-step
 * `VariableReference` — no braces, no quote-strip.
 */
export interface VarIndirect {
  readonly type: 'VarIndirect';
  readonly nameRef: ValueNode;
  /** Lookup mode for the variable named by `nameRef`. */
  readonly lookup: VariableLookup;
}

/**
 * A detached ruleset value `@rs: { … }`: a block of statements bound to a
 * value, callable (`@rs()`) to splice its body at the call site. `body` is the
 * CANONICAL block, stored once (never cloned). Its lexical closure belongs to
 * the render activation that binds it, never to this reusable source node.
 */
export interface DetachedRuleset {
  readonly type: 'DetachedRuleset';
  readonly body: Statement[];
}

/** One typed step in a left-associated {@link Reference} chain. */
export type ReferenceStep = DotLookup | BracketLookup | ReferenceCall;

/** A named member lookup following a reference. */
export interface DotLookup {
  readonly type: 'DotLookup';
  readonly name: string;
}

/** A bracket lookup. `keyKind` carries the dialect's lookup namespace. */
export interface BracketLookup {
  readonly type: 'BracketLookup';
  readonly key: ValueNode | number;
  readonly keyKind: 'var' | 'prop' | 'index' | 'member';
  /** Explicit dialect indexing convention; omitted preserves the historical 1-based map index. */
  readonly indexBase?: 0 | 1;
}

/** A call following a prior reference or lookup result. */
export interface ReferenceCall {
  readonly type: 'Call';
  readonly args: CallArg[];
}

/**
 * A generic, left-associated lookup/call chain. Its base can be a value lookup
 * or a namespaced mixin fact; every later dot lookup, bracket lookup, or call is
 * represented as an ordered typed step. `raw` is the authored fallback when a
 * dialect-specific dynamic chain cannot yet resolve at evaluation time.
 */
export interface Reference {
  readonly type: 'Reference';
  /**
   * A reference starts from either an ordinary value lookup or a typed namespace
   * / mixin fact.  Keeping the latter typed is what lets a later bracket or call
   * step continue the same chain without falling back to selector text.
   */
  readonly base: ValueNode | MixinCall;
  readonly steps: readonly ReferenceStep[];
  readonly raw: string;
}

/** A Jess `$for` range keeps its bounds and inclusion flags typed. It is an
 * iteration-only value: the serializer expands it directly rather than
 * recovering a list from authored bytes. */
export interface Range {
  readonly type: 'Range';
  readonly start: ValueNode;
  readonly end: ValueNode;
  readonly step: ValueNode | null;
  readonly includeStart: boolean;
  readonly includeEnd: boolean;
}

export type ValueNode =
  | Keyword
  | Color
  | Quoted
  | Any
  | Comment
  | Url
  | SelectorCapture
  | Dimension
  | SpacedValue
  | List
  | VariableReference
  | PropertyReference
  | Sequence
  | Important
  | Operation
  | FunctionCall
  | Paren
  | Condition
  | Interpolation
  | GeneralEnclosed
  | VarIndirect
  | DetachedRuleset
  | Reference
  | Range;

/* ---------------------------------------------------------------- selectors */

/**
 * A single simple-selector token, e.g. `.a`, `:hover`, `&`. A token that
 * contains `@{…}` carries an `interp` template and `text: null`; the concrete
 * text is resolved at ruleset-enter in the entering frame. A static token keeps
 * `text` and `interp: null` (the cached `compoundCanonical` fast path).
 */
export interface SimpleSelector {
  readonly type: 'SimpleSelector';
  readonly text: string | null;
  readonly interp: Interpolation | null;
}

/** A run of simple tokens with no separator, e.g. `.a.b`, `&:hover`. */
export interface CompoundSelector {
  readonly type: 'CompoundSelector';
  readonly simples: SimpleSelector[];
  /** Serializer-owned memo of the canonical join (lazy). */
  _canon?: string;
  /** Serializer-owned memo of the has-interp flag (lazy). */
  _hasInterp?: boolean;
}

/** Canonical concatenated text of a compoundSelector (`.a.b`), memoised. */
export const compoundCanonical = (c: CompoundSelector): string => {
  if (c._canon === undefined) {
    let s = '';
    for (const sim of c.simples) s += sim.text ?? '';
    c._canon = s;
  }
  return c._canon;
};

/** True iff any token needs frame-dependent interpolation resolution. */
export const compoundHasInterp = (c: CompoundSelector): boolean => {
  if (c._hasInterp === undefined) {
    let has = false;
    for (const sim of c.simples) if (sim.interp !== null) { has = true; break; }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

/** True iff any token carries a literal `&` (bare, fused, or in an interpolation template). */
export const compoundHasAmpersand = (c: CompoundSelector): boolean => {
  for (const sim of c.simples) {
    if (sim.text !== null && sim.text.includes('&')) return true;
    if (sim.interp !== null) {
      for (const part of sim.interp.parts) if ('lit' in part && part.lit.includes('&')) return true;
    }
  }
  return false;
};

export interface ComplexSegment {
  comb: Combinator;
  compound: CompoundSelector;
}

/**
 * A head compound plus combinator-joined tail compounds. `leadingComb` is an
 * optional leading combinator so an authored child selector like `> .b` (in
 * `.a { > .b {} }`) keeps its leading `>` verbatim in both flatten and nested
 * emit — the combinator prefixes the head compoundSelector (`> .b`).
 */
export interface ComplexSelector {
  readonly type: 'ComplexSelector';
  readonly head: CompoundSelector;
  readonly tail: ComplexSegment[];
  readonly leadingComb?: Combinator;
  /** Serializer-owned memo of the canonical join (lazy). */
  _canon?: string;
  /** Serializer-owned memo of the has-ampersand flag (lazy). */
  _hasAmp?: boolean;
  /** Serializer-owned memo of the has-interp flag (lazy). */
  _hasInterp?: boolean;
}

/** Canonical text of a complex selector (head + tail, leading combinator), memoised. */
export const complexCanonical = (c: ComplexSelector): string => {
  if (c._canon === undefined) {
    let s = compoundCanonical(c.head);
    // A leading combinator (e.g. `> .b`) is rendered surrounded on the right
    // only: `renderCombinator` yields ` > `; the head has no left context, so
    // trim the leading space to emit `> .b`.
    if (c.leadingComb !== undefined && c.leadingComb !== ' ') {
      s = renderCombinator(c.leadingComb).trimStart() + s;
    }
    for (const seg of c.tail) {
      s += renderCombinator(seg.comb) + compoundCanonical(seg.compound);
    }
    c._canon = s;
  }
  return c._canon;
};

export const complexHasAmpersand = (c: ComplexSelector): boolean => {
  if (c._hasAmp === undefined) {
    let has = compoundHasAmpersand(c.head);
    if (!has) {
      for (const seg of c.tail) {
        if (compoundHasAmpersand(seg.compound)) {
          has = true;
          break;
        }
      }
    }
    c._hasAmp = has;
  }
  return c._hasAmp;
};

/** True iff any compound carries an interpolated token (fast-path gate). */
export const complexHasInterp = (c: ComplexSelector): boolean => {
  if (c._hasInterp === undefined) {
    let has = compoundHasInterp(c.head);
    if (!has) {
      for (const seg of c.tail) {
        if (compoundHasInterp(seg.compound)) { has = true; break; }
      }
    }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

/** A comma-separated list of complex selectors, e.g. `.a, .b`. */
export interface SelectorList {
  readonly type: 'SelectorList';
  readonly selectors: ComplexSelector[];
}

/* -------------------------------------------------------------- statements */

/**
 * A `name: value;` declaration. `name` may be an `Interpolation` template
 * (`@{prefix}width`). `merge` is `','` for `+`, `' '` for `+_`, else `null`.
 * `important` is the structured `!important` flag parsed directly with the value,
 * promoted so merge can OR it across members and emit it once.
 */
export interface Declaration {
  readonly type: 'Declaration';
  readonly name: string | Interpolation;
  readonly value: ValueNode;
  readonly merge: null | ',' | ' ';
  readonly important: boolean;
  /** The authored gap after the `:` contained a NEWLINE (a value written on its
   * own line, e.g. a multi-line `grid-template-areas`). v5 preserves that layout:
   * the value emits starting on the next indented line instead of after `: `. */
  readonly valueOnNewLine?: boolean;
}

/**
 * A `@name: value;` variable declaration. Emits nothing; lives in scope.
 *
 * The value is usually a {@link ValueNode}, but a variable can also be bound to a
 * mixin CALL (`@p: .mk-map();`) whose OUTPUT is what the binding names — a callable
 * / accessible map (`@p[text]`, `@p()`). That shape carries a {@link MixinCall}
 * (mirroring how {@link For.iterable} admits a `MixinCall`), dispatched lazily when
 * the binding is read, so `value` is `ValueNode | MixinCall`.
 */
export type VariableWrite =
  | { readonly mode: 'declare' }
  | { readonly mode: 'if-absent' | 'reassign'; readonly lookup: VariableLookup };

export interface VariableDeclaration {
  readonly type: 'VariableDeclaration';
  readonly name: string;
  readonly value: ValueNode | MixinCall;
  /**
   * An ordinary declaration writes both stores and therefore has no lookup
   * selector. Conditional and reassignment forms carry the lookup they use.
   */
  readonly write: VariableWrite;
}

/** A comment carried structurally in source order (block or line text as-is). */
export interface Comment {
  readonly type: 'Comment';
  readonly text: string;
}

/**
 * [import:inline] Verbatim raw bytes produced by `@import (inline)`. The target
 * file's bytes are spliced UNPARSED at the import site; the serializer emits
 * `text` exactly (a single trailing newline separates it from the next
 * statement, matching Less's inline splice). Carries no scope and no structure.
 *
 * [import:inline-media] When the import carried a media-query postlude
 * (`@import (inline) "x" (min-width:…)`), `media` holds that prelude and the
 * serializer wraps the raw bytes in an `@media <media> { … }` block (matching
 * Less, which wraps the inline `Anonymous` in a media ruleset). `null`/absent =
 * a bare inline splice.
 */
export interface RawInline {
  readonly type: 'RawInline';
  readonly text: string;
  readonly media?: string | null;
}

/**
 * One `:extend()` instruction extracted from a ruleset body (or an attached
 * `.a:extend(...)`). The SUBJECT (the thing appended / substituted-in) is the
 * carrying Rule's own selector list; `target` is the FIND selector list;
 * `partial` is `true` for `all` (the parser's flag=0) and `false` for an exact
 * extend (flag=1). A multi-target `:extend(.aa, .bb)` fans into one instruction
 * per target branch, all sharing this `partial`.
 */
export interface ExtendInstruction {
  target: SelectorList;
  partial: boolean;
  /**
   * The EXTENDER subject: the specific selector this extend contributes. An INLINE
   * extend (`.a:extend(.b), .c { … }`) attaches to a single complexSelector (`.a`), so its
   * subject is that one complex — NOT the whole rule selector list (`.c` must not be
   * folded into `.b`). A BODY-form extend (`&:extend(.b);`) has no subject here and
   * applies to the whole carrying rule's selector list. Absent ⇒ whole-rule subject.
   */
  subject?: SelectorList;
}

/**
 * A `selector { ...body }` rule; body may nest further rules.
 * `extendInstructions` carries the `:extend()` instructions parsed from the body
 * (the `Extend` body statements are removed and hoisted here);
 * absent for the common no-extend rule so the serializer's zero-cost gate holds.
 */
export interface Rule {
  readonly type: 'Rule';
  readonly selector: SelectorList;
  readonly body: Statement[];
  readonly extendInstructions?: ExtendInstruction[];
  /**
   * [guards] An optional `when (...)` guard authored on the selector
   * (`.sel when (cond) { … }`). The rule's block emits only when the guard
   * evaluates true in the scope where the rule is defined; absent for the
   * common unguarded rule (the serializer's zero-cost gate holds).
   */
  readonly guard?: GuardNode;
  /**
   * [import:reference] This rule came from an `@import (reference)` file, so it is
   * HIDDEN: it emits nothing on its OWN (the serializer drops a rule whose visible
   * branches are empty), but it stays in the tree — indexed for mixin dispatch and
   * available for `:extend` to fold a VISIBLE extender branch into. When an extend
   * pulls it into visibility, only the visible extender branch survives (see the
   * extend engine's per-branch `hidden` provenance + the serializer's drop filter).
   */
  readonly reference?: boolean;
}

/**
 * A mixin parameter. [guards] A param is one of:
 *   - a binding: `{ name }` (optionally `{ name, default }`),
 *   - a literal PATTERN: `{ pattern }` (no name — the arg must equal it),
 *   - a variadic rest: `{ rest: true, name? }` (`...` / `@rest...`).
 */
export interface Param {
  name?: string;
  default?: ValueNode;
  pattern?: ValueNode; // [guards] literal-value pattern-match param
  rest?: boolean; // [guards] variadic `...`
}

/**
 * A mixin definition. Its `body` is the CANONICAL body, stored ONCE — every
 * call reads it through an overlay (bindings + parent-selector context) and
 * NEVER clones it. [guards] `guard` is an optional `when (...)` condition.
 */
export interface MixinDef {
  readonly type: 'MixinDef';
  readonly name: string;
  readonly params: Param[];
  readonly body: Statement[];
  readonly guard?: GuardNode; // [guards]
  // [dedup] set only on a def SYNTHESIZED from a paren-less ruleset callable as a
  // zero-arg mixin (`.foo {…}` dispatched via `.foo()`). A real parametric
  // `MixinDef` leaves it undefined. Duplicate-declaration dedup keeps overloaded
  // PARAMETRIC output verbatim (Less restricts its ambient lookup) but collapses
  // identical ruleset-mixin output, so the serializer must tell them apart.
  readonly ruleMixin?: boolean;
}

/**
 * One segment of a namespaced-call path: a combinator (`' '` descendant or
 * `'>'` child) and a selector string (`#namespace`, `.borders`).
 */
export interface PathSeg {
  comb: Combinator;
  sel: string;
}

/**
 * A mixin call. Args bind to the def's params (positional or named). [guards]
 * `path` is the namespace descent prefix for `#ns .a .b()` (empty for a
 * plain flat `.mixin()` call — byte-unchanged flat dispatch). `.m() !important`
 * promotes every declaration the body emits.
 */
export interface MixinCall {
  readonly type: 'MixinCall';
  readonly name: string;
  readonly args: CallArg[];
  readonly path: PathSeg[];
  readonly important: boolean;
}

/**
 * Jess `$apply <selector-list>`: apply every matching plain ruleset body at the
 * statement position. This is deliberately distinct from `MixinCall`: it has
 * ruleset-only, whole-selector, merge-all semantics and carries no call args or
 * overload dispatch.
 */
export interface Apply {
  readonly type: 'Apply';
  readonly selectors: readonly CompoundSelector[];
}

/**
 * A Jess `$for (... of ...)` loop. The binding retains the authored single,
 * comma, bracket, or tuple form; entries are source-dependent. Less `each()` lowers
 * at its parser boundary into a compatible Jess binding.
 * a map (`DetachedRuleset` / a var bound to one / a `@map[k]` accessor) iterates
 * its declarations; a `MixinCall` (`each(.mixin(), …)`) iterates the call's OUTPUT
 * declarations; anything else evaluates to a list (a `range(…)` call, a `@list`
 * var, or a literal `1 2 3` / `a, b` byte-list) and iterates its items.
 */
export type ForBinding =
  | { readonly kind: 'single'; readonly name: string }
  | { readonly kind: 'comma'; readonly names: readonly [string, string?, string?] }
  | { readonly kind: 'bracket'; readonly names: readonly [string, string] }
  | { readonly kind: 'tuple'; readonly names: readonly [string, string, ...string[]] };

export interface For {
  readonly type: 'For';
  readonly iterable: ValueNode | MixinCall;
  readonly rules: Statement[];
  readonly binding: ForBinding;
}

/** One ordered arm of a Jess `$if` chain. A null guard is the final `$else`. */
export interface IfBranch {
  readonly guard: GuardNode | null;
  readonly body: Statement[];
}

/**
 * Jess `$if` / `$else if` / `$else` control flow. Branches are ordered exactly
 * as authored; rendering evaluates guards left-to-right and walks only the
 * selected body in its containing frame. A control block is not a scope.
 */
export interface If {
  readonly type: 'If';
  readonly branches: readonly [IfBranch, ...IfBranch[]];
}

/** A compile-time stylesheet dependency; plugins resolve its authored path. */
export interface StyleImport {
  readonly type: 'StyleImport';
  readonly path: Quoted;
  readonly mode: 'compose' | 'import';
  readonly namespace: string | null;
  readonly forward: boolean;
}

/** A selected ESM binding in a Jess `@-from` statement. */
export interface ModuleImportSpecifier {
  readonly name: string;
  readonly alias: string | null;
}

/** A compile-time JavaScript/TypeScript module dependency; plugins resolve it. */
export interface ModuleImport {
  readonly type: 'ModuleImport';
  readonly path: Quoted;
  readonly mode: 'use' | 'from';
  /** Default ESM binding in `@-from "…" import name`. */
  readonly defaultImport: string | null;
  readonly namespace: string | null;
  readonly imports: readonly ModuleImportSpecifier[];
}

/** The document stylesheet: an ordered list of top-level statements. */
export interface Stylesheet {
  readonly type: 'Stylesheet';
  readonly children: Statement[];
}

// [atrule] at-rule nodes are valid body/stylesheet statements; type-only import keeps
// nodes.ts free of a runtime dependency on the sibling at-rule module.
import type { AtRuleBlock, AtRuleStatement, ImportAtRule, OpaqueAtRuleBlock, Plugin } from './at-rule.js';

export type Statement =
  | Rule
  | Declaration
  | Comment
  | MixinDef
  | MixinCall
  | Apply
  | VariableDeclaration
  | AtRuleBlock
  | AtRuleStatement
  | ImportAtRule
  | Plugin
  | OpaqueAtRuleBlock
  | Reference
  | For
  | If
  | StyleImport
  | ModuleImport
  | RawInline
  // A bare value-position call in statement position (`e('/* … */');`): Less
  // evaluates it and emits its result bytes as a standalone line (unquote/escape
  // at document scope), so it is a legitimate statement, not just a value node.
  | FunctionCall;

/* ------------------------------------------------------------ constructors */

export const keyword = (src: string): Keyword => ({ type: 'Keyword', src });
export const any = (src: string): Any => ({ type: 'Any', src });
export const url = (value: ValueNode): Url => ({ type: 'Url', value });
export const selectorCapture = (branches: readonly string[], src: string): SelectorCapture =>
  ({ type: 'SelectorCapture', branches, src });
export const color = (src: string): Color => ({ type: 'Color', src });
export const quoted = (src: string, value: string, quote: string, escaped: boolean): Quoted =>
  ({ type: 'Quoted', src, value, quote, escaped });
export const dimension = (number: number, unit = '', src = `${number}${unit}`): Dimension =>
  ({ type: 'Dimension', number, unit, src });

/** A value literal that emits its `src` verbatim when inert (all five literal
 *  types). Narrows a `ValueNode` to the leaf union. */
export const isLiteralNode = (n: ValueNode): n is Keyword | Color | Dimension | Quoted | Any =>
  n.type === 'Keyword' || n.type === 'Color' || n.type === 'Dimension'
  || n.type === 'Quoted' || n.type === 'Any';

/** A literal whose VALUE TYPE the parser knows (every literal except opaque `Any`).
 *  Such a literal binds BY REFERENCE across a mixin boundary (its type survives). */
export const isTypedLiteral = (n: ValueNode): boolean => isLiteralNode(n) && n.type !== 'Any';

export const spaced = (parts: ValueNode[], separators?: readonly string[]): SpacedValue => {
  const retained = separators?.some(separator => /[\n\r]/u.test(separator)) ? separators : undefined;
  return retained === undefined ? { type: 'SpacedValue', parts } : { type: 'SpacedValue', parts, separators: retained };
};
export const list = (items: ValueNode[], separators: readonly string[]): List =>
  ({ type: 'List', items, sep: ',', separators });

export const simpleSelector = (text: string): SimpleSelector => ({ type: 'SimpleSelector', text, interp: null });
/** An interpolated simple token, e.g. `.icon-@{type}`. */
export const interpolatedSimpleSelector = (interp: Interpolation): SimpleSelector => ({ type: 'SimpleSelector', text: null, interp });
export const interpolation = (parts: InterpPart[]): Interpolation => ({ type: 'Interpolation', parts });
export const generalEnclosed = (
  form: GeneralEnclosed['form'],
  name: string | null,
  content: Interpolation,
): GeneralEnclosed => ({ type: 'GeneralEnclosed', form, name, content });
export const varIndirect = (nameRef: ValueNode, lookup: VariableLookup): VarIndirect => ({ type: 'VarIndirect', nameRef, lookup });
export const detachedRuleset = (body: Statement[]): DetachedRuleset => ({ type: 'DetachedRuleset', body });
export const forNode = (
  iterable: ValueNode | MixinCall,
  rules: Statement[],
  binding: ForBinding,
): For => ({ type: 'For', iterable, rules, binding });
export const ifNode = (branches: readonly [IfBranch, ...IfBranch[]]): If => ({ type: 'If', branches });
export const range = (
  start: ValueNode,
  end: ValueNode,
  step: ValueNode | null = null,
  includeStart = true,
  includeEnd = true,
): Range => ({ type: 'Range', start, end, step, includeStart, includeEnd });
export const reference = (
  base: ValueNode | MixinCall,
  steps: readonly ReferenceStep[],
  raw: string,
): Reference => ({ type: 'Reference', base, steps, raw });
export const propertyReference = (name: string, raw: string = `$${name}`): PropertyReference => ({ type: 'PropertyReference', name, raw });
/** A compound from an already-built list of simple tokens. */
export const compoundSelectorOf = (simples: SimpleSelector[]): CompoundSelector => ({ type: 'CompoundSelector', simples });
/** `compoundSelector('.a', '.b')` => `.a.b`. */
export const compoundSelector = (...texts: string[]): CompoundSelector => compoundSelectorOf(texts.map(simpleSelector));
/** `complexSelector([{ compound: compoundSelector('.a') }, { comb: '>', compound: compoundSelector('.b') }])` => `.a > .b`. */
export const complexSelector = (
  segments: Array<{ comb?: Combinator; compound: CompoundSelector }>,
  leadingComb?: Combinator,
): ComplexSelector => {
  const [head, ...tail] = segments;
  if (!head) throw new Error('complexSelector() needs at least one segment');
  return {
    type: 'ComplexSelector',
    head: head.compound,
    tail: tail.map((s) => ({ comb: s.comb ?? ' ', compound: s.compound })),
    ...(leadingComb !== undefined ? { leadingComb } : {}),
  };
};
export const selist = (...selectors: ComplexSelector[]): SelectorList => ({ type: 'SelectorList', selectors });

export const decl = (
  name: string | Interpolation,
  value: ValueNode,
  merge: null | ',' | ' ' = null,
  important = false,
  valueOnNewLine = false,
): Declaration =>
  valueOnNewLine
    ? { type: 'Declaration', name, value, merge, important, valueOnNewLine: true }
    : { type: 'Declaration', name, value, merge, important };
export const comment = (text: string): Comment => ({ type: 'Comment', text });
/** [import:inline] A verbatim raw-bytes statement (`@import (inline)` splice).
 * `media` (optional) wraps the splice in an `@media <media> { … }` block. */
export const rawInline = (text: string, media?: string | null): RawInline =>
  media != null ? { type: 'RawInline', text, media } : { type: 'RawInline', text };
export const variableReference = (name: string, lookup: VariableLookup): VariableReference =>
  ({ type: 'VariableReference', name, lookup });
export const sequence = (parts: ValueNode[]): Sequence => ({ type: 'Sequence', parts });
export const important = (inner: ValueNode): Important => ({ type: 'Important', inner });
/** @deprecated Renamed to {@link sequence}; kept one cycle for straddling callers. */
export const concat = sequence;
export const operation = (operator: string, left: ValueNode, right: ValueNode): Operation =>
  ({ type: 'Operation', operator, left, right });
export const funcCall = (name: string, args: ValueNode[], modern = false): FunctionCall =>
  ({ type: 'FunctionCall', name, args, modern });
export const paren = (inner: ValueNode, escaped = false): Paren =>
  escaped ? { type: 'Paren', inner, escaped: true } : { type: 'Paren', inner };
export const condition = (guard: GuardNode, src: string): Condition => ({ type: 'Condition', guard, src });
export const variableDeclaration = (
  name: string,
  value: ValueNode | MixinCall,
  write: VariableWrite,
): VariableDeclaration =>
  ({ type: 'VariableDeclaration', name, value, write });
export const mixinDef = (
  name: string,
  params: Param[],
  body: Statement[],
  guard?: GuardNode, // [guards]
): MixinDef => ({ type: 'MixinDef', name, params, body, ...(guard !== undefined ? { guard } : {}) });
/** [guards] Args may be bare value nodes (positional) or `{ value, name? }`. */
export const mixinCall = (name: string, args: Array<ValueNode | CallArg> = []): MixinCall => ({
  type: 'MixinCall',
  name,
  args: args.map((a) => ('type' in a ? { value: a } : a)),
  path: [],
  important: false,
});
export const apply = (selectors: readonly CompoundSelector[]): Apply => ({ type: 'Apply', selectors });

/** A single simple-string complex selector, e.g. `sel('.test')`. */
export const sel = (text: string): ComplexSelector => complexSelector([{ compound: compoundSelector(text) }]);

/** `rule('.test', [...])`, `rule(sel('.a > .b'), ...)`, or `rule(selist(...), ...)`.
 *  `extendInstructions` (optional) carries hoisted `:extend()` instructions. */
export const rule = (
  selector: string | ComplexSelector | SelectorList,
  body: Statement[],
  extendInstructions?: ExtendInstruction[],
  guard?: GuardNode,
): Rule => {
  const list =
    typeof selector === 'string'
      ? selist(sel(selector))
      : selector.type === 'SelectorList'
        ? selector
        : selist(selector);
  return {
    type: 'Rule',
    selector: list,
    body,
    ...(extendInstructions !== undefined ? { extendInstructions } : {}),
    ...(guard !== undefined ? { guard } : {}),
  };
};
export const styleImport = (
  path: Quoted,
  mode: StyleImport['mode'] = 'compose',
  namespace: string | null = null,
  forward = false,
): StyleImport => ({ type: 'StyleImport', path, mode, namespace, forward });
export const moduleImport = (
  path: Quoted,
  mode: ModuleImport['mode'],
  namespace: string | null = null,
  imports: readonly ModuleImportSpecifier[] = [],
  defaultImport: string | null = null,
): ModuleImport => ({ type: 'ModuleImport', path, mode, defaultImport, namespace, imports });
export const stylesheet = (children: Statement[]): Stylesheet => ({ type: 'Stylesheet', children });
