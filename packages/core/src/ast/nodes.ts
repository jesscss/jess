/**
 * Clean-room tree2 concrete node types + programmatic constructors.
 *
 * Written from scratch to reproduce the exact output BYTES the legacy renderer
 * emits for each shape — NOT to mirror the legacy serialization *method*.
 *
 * Every node is a PLAIN-DATA object with a PascalCase `type` discriminant. There
 * is no base class and no `new`: the free-function factories below are the only
 * construction path. Narrow a node with `node.type === '…'` (or `isNode`).
 *
 * Selector model: a selector is a `SelectorList` of `Complex`
 * selectors; a `Complex` is a head `Compound` plus `(combinator, compound)`
 * tail segments; a `Compound` is a run of `Simple` tokens concatenated with no
 * separator (`.a` + `.b` => `.a.b`). The `&` parent-reference is just a
 * `Simple` whose text is `'&'`. Canonical selector text is computed once and
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

/** A numeric dimension leaf, e.g. `0px`, `10px`, `1.0px`, `50%`. Carries the
 *  parser's `number`+`unit` split plus the verbatim `src` spelling. */
export interface Dimension {
  readonly type: 'Dimension';
  readonly number: number;
  readonly unit: string;
  readonly src: string;
}

/** A space-separated list of value parts, e.g. `1px solid black`. */
export interface SpacedValue {
  readonly type: 'SpacedValue';
  readonly parts: ValueNode[];
}

/**
 * A COMMA-separated value list, e.g. `Arial, sans-serif` or `@a, @b, @c`. The
 * parser owns the top-level comma boundaries (grammar `valueList`), so the
 * segments are kept STRUCTURED as lightweight lazy `items` instead of being
 * re-concatenated into one opaque `Any` (which the value layer would then have to
 * re-split for top-level commas — the byte re-derivation the keystone forbids).
 * Each item is an ordinary value leaf carrying its own bytes: a static segment is
 * a cheap `Any`, a referenced one a `VarRef` / space-run `SpacedValue`, all
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

/** A reference to a mixin parameter / bound variable, e.g. `@c`. */
export interface VarRef {
  readonly type: 'VarRef';
  readonly name: string;
}

/**
 * A property accessor `$name` (Less "property accessors"): reads the CURRENT value
 * of the CSS property `name` from the enclosing declaration scope — last-wins, and
 * cascading up the ruleset chain (`$color` inside a nested rule reads the parent
 * ruleset's final `color`). The resolved value carries the source declaration's
 * `!important` flag (`$color` of `color: red !important` → `red !important`).
 * `bytes` is the verbatim source (`$name`) emitted as a literal fallback when the
 * property is not resolvable in the current ast/ scope (e.g. it would only exist
 * after a not-yet-modelled expansion), so an unresolved accessor never regresses
 * below its prior verbatim output.
 */
export interface PropRef {
  readonly type: 'PropRef';
  readonly name: string;
  readonly bytes: string;
}

/**
 * A value template: literal text and `@var` references concatenated with NO
 * separator (the literal parts already carry their own spacing). This is how a
 * static value that embeds variable references is represented — e.g.
 * `1px solid @c` => Sequence[Any('1px solid '), VarRef('c')]. Reference
 * substitution only (this rung): no arithmetic, no function evaluation.
 */
export interface Sequence {
  readonly type: 'Sequence';
  readonly parts: ValueNode[];
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

/** A parenthesized value, e.g. `(#aaa * 3)`. Transparent to computed bytes. */
export interface Paren {
  readonly type: 'Paren';
  readonly inner: ValueNode;
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
export interface Interp {
  readonly type: 'Interp';
  readonly parts: InterpPart[];
}

/**
 * Indirect variable `@@name`: a variable whose NAME is the resolved bytes
 * of another value node (`@name: var; x: @@name` → the value of `@var`). Two-step
 * `VarRef` — no braces, no quote-strip.
 */
export interface VarIndirect {
  readonly type: 'VarIndirect';
  readonly nameRef: ValueNode;
}

/**
 * A detached ruleset value `@rs: { … }`: a block of statements bound to a
 * value, callable (`@rs()`) to splice its body at the call site. `body` is the
 * CANONICAL block, stored once (never cloned). `defFrame` is the lexical closure
 * captured at definition-evaluation time (mutable: filled when the binding is
 * first resolved, `null` until then).
 */
export interface DetachedRuleset {
  readonly type: 'DetachedRuleset';
  readonly body: Statement[];
  defFrame: object | null;
}

/**
 * A map / namespace accessor value `@p[text]` / `#ns[$@prop]` / `@list[1]`.
 * `base` resolves to a ruleset-like scope; `key` is a property-name value (may be
 * an `Interp`) when `keyIsProp`, else a numeric index (negative counts from end).
 * `bytes` is the verbatim source of the whole accessor, emitted as a literal
 * fallback when the base does not resolve to a map/ruleset in the current ast/
 * scope (e.g. the base is bound by a not-yet-modelled mixin-call / `each` result),
 * so an unresolved accessor never regresses below its prior verbatim output.
 */
export interface MapAccessor {
  readonly type: 'MapAccessor';
  readonly base: ValueNode;
  readonly key: ValueNode | number;
  readonly keyIsProp: boolean;
  readonly bytes: string;
}

export type ValueNode =
  | Keyword
  | Color
  | Quoted
  | Any
  | Dimension
  | SpacedValue
  | List
  | VarRef
  | PropRef
  | Sequence
  | Operation
  | FunctionCall
  | Paren
  | Condition
  | Interp
  | VarIndirect
  | DetachedRuleset
  | MapAccessor;

/* ---------------------------------------------------------------- selectors */

/**
 * A single simple-selector token, e.g. `.a`, `:hover`, `&`. A token that
 * contains `@{…}` carries an `interp` template and `text: null`; the concrete
 * text is resolved at ruleset-enter in the entering frame. A static token keeps
 * `text` and `interp: null` (the cached `compoundCanonical` fast path).
 */
export interface Simple {
  readonly type: 'Simple';
  readonly text: string | null;
  readonly interp: Interp | null;
}

/** A run of simple tokens with no separator, e.g. `.a.b`, `&:hover`. */
export interface Compound {
  readonly type: 'Compound';
  readonly simples: Simple[];
  /** Serializer-owned memo of the canonical join (lazy). */
  _canon?: string;
  /** Serializer-owned memo of the has-interp flag (lazy). */
  _hasInterp?: boolean;
}

/** Canonical concatenated text of a compound (`.a.b`), memoised. */
export const compoundCanonical = (c: Compound): string => {
  if (c._canon === undefined) {
    let s = '';
    for (const sim of c.simples) s += sim.text ?? '';
    c._canon = s;
  }
  return c._canon;
};

/** True iff any token needs frame-dependent interpolation resolution. */
export const compoundHasInterp = (c: Compound): boolean => {
  if (c._hasInterp === undefined) {
    let has = false;
    for (const sim of c.simples) if (sim.interp !== null) { has = true; break; }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

/** True iff any token carries a `&` (bare or fused into an appended token). */
export const compoundHasAmpersand = (c: Compound): boolean => {
  for (const sim of c.simples) if (sim.text !== null && sim.text.includes('&')) return true;
  return false;
};

export interface ComplexSegment {
  comb: Combinator;
  compound: Compound;
}

/**
 * A head compound plus combinator-joined tail compounds. `leadingComb` is an
 * optional leading combinator so an authored child selector like `> .b` (in
 * `.a { > .b {} }`) keeps its leading `>` verbatim in both flatten and nested
 * emit — the combinator prefixes the head compound (`> .b`).
 */
export interface Complex {
  readonly type: 'Complex';
  readonly head: Compound;
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
export const complexCanonical = (c: Complex): string => {
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

export const complexHasAmpersand = (c: Complex): boolean => {
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
export const complexHasInterp = (c: Complex): boolean => {
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
  readonly selectors: Complex[];
}

/* -------------------------------------------------------------- statements */

/**
 * A `name: value;` declaration. `name` may be an `Interp` template
 * (`@{prefix}width`). `merge` is `','` for `+`, `' '` for `+_`, else `null`.
 * `important` is the structured `!important` flag (parsed off the value bytes at
 * bridge time), promoted so merge can OR it across members and emit it once.
 */
export interface Declaration {
  readonly type: 'Declaration';
  readonly name: string | Interp;
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
export interface VarDeclaration {
  readonly type: 'VarDeclaration';
  readonly name: string;
  readonly value: ValueNode | MixinCall;
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
 * [import] An UNRESOLVED `@import` statement on the direct build host — the
 * structural head the parser delivered, carried until the import-resolution pass
 * (`resolveDirectImports`) replaces it with the imported file's spliced
 * statements. The pass reads the STRUCTURE the parser already separated (the
 * option keywords, the built path node, the media postlude) — never re-scanning
 * bytes — mirroring the bridge's `StyleImport` handling but on the tree2 host.
 *
 * `spec` is the resolved specifier string (a plain-string / `url(...)` path), or
 * `null` when the path is variable-interpolated (`@import "@{theme}.less"`) — a
 * shape the direct host defers to verbatim emit rather than mis-resolving.
 * `raw` is the verbatim `@import …;` source, emitted as-is if the pass leaves the
 * node in place (a CSS-passthrough import, or an unresolved deferral).
 */
export interface StyleImport {
  readonly type: 'StyleImport';
  /** Verbatim `@import …;` source bytes (the fallback / passthrough emit). */
  readonly raw: string;
  /** Resolved specifier string, or `null` for an interpolated / opaque path. */
  readonly spec: string | null;
  /**
   * [import:specifier] The path's interpolation template (`@import "@{theme}.less"`)
   * when `spec` is `null` because the specifier is variable-interpolated. The
   * resolution pass fills it from the file's literal-variable scope; a plain /
   * opaque (`url(@{x})`) path leaves this undefined and stays a verbatim defer.
   */
  readonly interp?: Interp;
  /** `(reference)` — resolve + scope, suppress own output. */
  readonly reference: boolean;
  /** `(optional)` — a missing target is swallowed, not an error. */
  readonly optional: boolean;
  /** `(multiple)` / the non-default re-import-at-every-position mode. */
  readonly multiple: boolean;
  /** `(inline)` — splice the target's RAW bytes unparsed. */
  readonly inline: boolean;
  /** `(css)` explicit, or a `.css` / remote target — emit the `@import` verbatim. */
  readonly css: boolean;
  /** `(less)` explicit — force Less parsing/inlining even for a `.css` target. */
  readonly less: boolean;
  /** An escaped `~"…"` path (deferred; emitted verbatim). */
  readonly escaped: boolean;
  /** Media-query postlude bytes (`@import (inline) "x" (min-width:…)`), else `null`. */
  readonly media: string | null;
  /**
   * [import:hoist] Set by the resolution pass when this is a plain-CSS `@import`
   * (`(css)` / `.css` / remote) — NOT inlined. Less keeps it as a literal
   * `@import` and hoists it to the top of the output document; the serializer's
   * hoist pass emits it there (in source-encounter order) and skips it in place.
   */
  readonly hoist?: boolean;
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
}

/**
 * A `selector { ...body }` rule; body may nest further rules.
 * `extendInstructions` carries the `:extend()` instructions the bridge extracted
 * from the body (the `Extend` body statements are removed and hoisted here);
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
 * A call of a detached-ruleset-valued variable: `@ruleset();`. Resolves the
 * variable to a `DetachedRuleset` value and splices its body through an overlay
 * frame (caller-first, definition-fallback scope).
 */
export interface DetachedCall {
  readonly type: 'DetachedCall';
  readonly varName: string;
}

/**
 * A Less `each(<iterable>, <callback>)` loop — the grammar lowers `each(...)` to
 * this control-flow node (never a `FunctionCall`). At serialize it EMITS the
 * callback `rules` once per iterable item, binding the loop variables in each
 * iteration's scope (Less `each` semantics):
 *   - `valueName` ← the item value (`@value` by default),
 *   - `keyName`   ← the map key, or the 1-based index for a plain list (`@key`),
 *   - `indexName` ← the 1-based index (`@index`).
 * A `null` name means that binding is not introduced (an anonymous-mixin callback
 * `.(@v)` / `.(@v, @k)` omits the trailing names). The iterable is a value node:
 * a map (`DetachedRuleset` / a var bound to one / a `@map[k]` accessor) iterates
 * its declarations; a `MixinCall` (`each(.mixin(), …)`) iterates the call's OUTPUT
 * declarations; anything else evaluates to a list (a `range(…)` call, a `@list`
 * var, or a literal `1 2 3` / `a, b` byte-list) and iterates its items.
 */
export interface For {
  readonly type: 'For';
  readonly iterable: ValueNode | MixinCall;
  readonly rules: Statement[];
  readonly valueName: string | null;
  readonly keyName: string | null;
  readonly indexName: string | null;
}

/** The document root: an ordered list of top-level statements. */
export interface Root {
  readonly type: 'Root';
  readonly children: Statement[];
}

// [atrule] at-rule nodes are valid body/root statements; type-only import keeps
// nodes.ts free of a runtime dependency on the sibling at-rule module.
import type { AtRuleBlock, AtRuleStatement } from './at-rule.js';

export type Statement =
  | Rule
  | Declaration
  | Comment
  | MixinDef
  | MixinCall
  | VarDeclaration
  | AtRuleBlock
  | AtRuleStatement
  | DetachedCall
  | For
  | RawInline
  | StyleImport
  // A bare value-position call in statement position (`e('/* … */');`): Less
  // evaluates it and emits its result bytes as a standalone line (unquote/escape
  // at document scope), so it is a legitimate statement, not just a value node.
  | FunctionCall;

/* ------------------------------------------------------------ constructors */

export const keyword = (src: string): Keyword => ({ type: 'Keyword', src });
export const any = (src: string): Any => ({ type: 'Any', src });
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

export const spaced = (parts: ValueNode[]): SpacedValue => ({ type: 'SpacedValue', parts });
export const list = (items: ValueNode[], separators: readonly string[]): List =>
  ({ type: 'List', items, sep: ',', separators });

export const simple = (text: string): Simple => ({ type: 'Simple', text, interp: null });
/** An interpolated simple token, e.g. `.icon-@{type}`. */
export const simpleInterp = (interp: Interp): Simple => ({ type: 'Simple', text: null, interp });
export const interp = (parts: InterpPart[]): Interp => ({ type: 'Interp', parts });
export const varIndirect = (nameRef: ValueNode): VarIndirect => ({ type: 'VarIndirect', nameRef });
export const detachedRuleset = (body: Statement[]): DetachedRuleset => ({ type: 'DetachedRuleset', body, defFrame: null });
export const detachedCall = (varName: string): DetachedCall => ({ type: 'DetachedCall', varName });
export const forNode = (
  iterable: ValueNode | MixinCall,
  rules: Statement[],
  valueName: string | null,
  keyName: string | null,
  indexName: string | null,
): For => ({ type: 'For', iterable, rules, valueName, keyName, indexName });
export const mapAccessor = (
  base: ValueNode,
  key: ValueNode | number,
  keyIsProp: boolean,
  bytes: string,
): MapAccessor => ({ type: 'MapAccessor', base, key, keyIsProp, bytes });
export const propRef = (name: string, bytes: string = `$${name}`): PropRef => ({ type: 'PropRef', name, bytes });
/** A compound from an already-built list of simple tokens. */
export const compoundOf = (simples: Simple[]): Compound => ({ type: 'Compound', simples });
/** `compound('.a', '.b')` => `.a.b`. */
export const compound = (...texts: string[]): Compound => compoundOf(texts.map(simple));
/** `complex([{ compound: compound('.a') }, { comb: '>', compound: compound('.b') }])` => `.a > .b`. */
export const complex = (
  segments: Array<{ comb?: Combinator; compound: Compound }>,
  leadingComb?: Combinator,
): Complex => {
  const [head, ...tail] = segments;
  if (!head) throw new Error('complex() needs at least one segment');
  return {
    type: 'Complex',
    head: head.compound,
    tail: tail.map((s) => ({ comb: s.comb ?? ' ', compound: s.compound })),
    ...(leadingComb !== undefined ? { leadingComb } : {}),
  };
};
export const selist = (...selectors: Complex[]): SelectorList => ({ type: 'SelectorList', selectors });

export const decl = (
  name: string | Interp,
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
/** [import] An unresolved `@import` head (see {@link StyleImport}). */
export const styleImport = (fields: Omit<StyleImport, 'type'>): StyleImport =>
  ({ type: 'StyleImport', ...fields });
export const varRef = (name: string): VarRef => ({ type: 'VarRef', name });
export const sequence = (parts: ValueNode[]): Sequence => ({ type: 'Sequence', parts });
/** @deprecated Renamed to {@link sequence}; kept one cycle for straddling callers. */
export const concat = sequence;
export const operation = (operator: string, left: ValueNode, right: ValueNode): Operation =>
  ({ type: 'Operation', operator, left, right });
export const funcCall = (name: string, args: ValueNode[], modern = false): FunctionCall =>
  ({ type: 'FunctionCall', name, args, modern });
export const paren = (inner: ValueNode): Paren => ({ type: 'Paren', inner });
export const condition = (guard: GuardNode, src: string): Condition => ({ type: 'Condition', guard, src });
export const varDecl = (name: string, value: ValueNode | MixinCall): VarDeclaration =>
  ({ type: 'VarDeclaration', name, value });
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

/** A single simple-string complex selector, e.g. `sel('.test')`. */
export const sel = (text: string): Complex => complex([{ compound: compound(text) }]);

/** `rule('.test', [...])`, `rule(sel('.a > .b'), ...)`, or `rule(selist(...), ...)`.
 *  `extendInstructions` (optional) carries hoisted `:extend()` instructions. */
export const rule = (
  selector: string | Complex | SelectorList,
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
export const root = (children: Statement[]): Root => ({ type: 'Root', children });
