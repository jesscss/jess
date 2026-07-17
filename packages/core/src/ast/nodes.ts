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
import type { LiteralTag, LitFields } from './literal-tag.js'; // [value-literal-tag]

/* ------------------------------------------------------------------ values */

/**
 * A bare literal leaf, e.g. `red`, `solid`, `10px`, `#fff`.
 *
 * [value-literal-tag] `tag` carries the PRODUCER's `LIT_*` classification of the
 * literal (VALUE-LITERAL-TAG-SPEC §5). When a leaf is forced onto the typed path
 * (operated / compared / typed param) `materialize` reads this stamped FIELD
 * instead of re-classifying the bytes. It is `undefined` only for a genuinely
 * synthetic / untagged Word (e.g. a joined computed fragment), where the typed
 * path falls back to a byte sniff. The bridge stamps it today; the future
 * tree2-emitting parser-host stamps it at parse (same principle, no reshape).
 *
 * [value-literal-tag] `lit` is the parser's pre-split classification of the
 * literal (numeric `number`+`unit`, or quoted `value`+`quote`+`escaped`). When
 * present, `materialize` reads it instead of re-splitting `text` with a regex;
 * absent only for a synthetic / untagged Word.
 */
export interface Word {
  readonly type: 'Word';
  readonly text: string;
  readonly tag?: LiteralTag;
  readonly lit?: LitFields;
}

/** A numeric dimension leaf, e.g. `0px`, `10px`. */
export interface Dimension {
  readonly type: 'Dimension';
  readonly value: number;
  readonly unit: string;
}

/** A space-separated list of value parts, e.g. `1px solid black`. */
export interface SpacedValue {
  readonly type: 'SpacedValue';
  readonly parts: ValueNode[];
}

/** A reference to a mixin parameter / bound variable, e.g. `@c`. */
export interface VarRef {
  readonly type: 'VarRef';
  readonly name: string;
}

/**
 * A value template: literal text and `@var` references concatenated with NO
 * separator (the literal parts already carry their own spacing). This is how a
 * static value that embeds variable references is represented — e.g.
 * `1px solid @c` => Sequence[Word('1px solid '), VarRef('c')]. Reference
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
 */
export interface MapAccessor {
  readonly type: 'MapAccessor';
  readonly base: ValueNode;
  readonly key: ValueNode | number;
  readonly keyIsProp: boolean;
}

export type ValueNode =
  | Word
  | Dimension
  | SpacedValue
  | VarRef
  | Sequence
  | Operation
  | FunctionCall
  | Paren
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
}

/** A `@name: value;` variable declaration. Emits nothing; lives in scope. */
export interface VarDeclaration {
  readonly type: 'VarDeclaration';
  readonly name: string;
  readonly value: ValueNode;
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
 */
export interface RawInline {
  readonly type: 'RawInline';
  readonly text: string;
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
  | RawInline;

/* ------------------------------------------------------------ constructors */

export const word = (text: string, tag?: LiteralTag, lit?: LitFields): Word => ({
  type: 'Word',
  text,
  ...(tag !== undefined ? { tag } : {}),
  ...(lit !== undefined ? { lit } : {}),
});
export const dim = (value: number, unit = ''): Dimension => ({ type: 'Dimension', value, unit });
export const spaced = (parts: ValueNode[]): SpacedValue => ({ type: 'SpacedValue', parts });

export const simple = (text: string): Simple => ({ type: 'Simple', text, interp: null });
/** An interpolated simple token, e.g. `.icon-@{type}`. */
export const simpleInterp = (interp: Interp): Simple => ({ type: 'Simple', text: null, interp });
export const interp = (parts: InterpPart[]): Interp => ({ type: 'Interp', parts });
export const varIndirect = (nameRef: ValueNode): VarIndirect => ({ type: 'VarIndirect', nameRef });
export const detachedRuleset = (body: Statement[]): DetachedRuleset => ({ type: 'DetachedRuleset', body, defFrame: null });
export const detachedCall = (varName: string): DetachedCall => ({ type: 'DetachedCall', varName });
export const mapAccessor = (
  base: ValueNode,
  key: ValueNode | number,
  keyIsProp: boolean,
): MapAccessor => ({ type: 'MapAccessor', base, key, keyIsProp });
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
): Declaration => ({ type: 'Declaration', name, value, merge, important });
export const comment = (text: string): Comment => ({ type: 'Comment', text });
/** [import:inline] A verbatim raw-bytes statement (`@import (inline)` splice). */
export const rawInline = (text: string): RawInline => ({ type: 'RawInline', text });
export const varRef = (name: string): VarRef => ({ type: 'VarRef', name });
export const sequence = (parts: ValueNode[]): Sequence => ({ type: 'Sequence', parts });
/** @deprecated Renamed to {@link sequence}; kept one cycle for straddling callers. */
export const concat = sequence;
export const operation = (operator: string, left: ValueNode, right: ValueNode): Operation =>
  ({ type: 'Operation', operator, left, right });
export const funcCall = (name: string, args: ValueNode[], modern = false): FunctionCall =>
  ({ type: 'FunctionCall', name, args, modern });
export const paren = (inner: ValueNode): Paren => ({ type: 'Paren', inner });
export const varDecl = (name: string, value: ValueNode): VarDeclaration =>
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
): Rule => {
  const list =
    typeof selector === 'string'
      ? selist(sel(selector))
      : selector.type === 'SelectorList'
        ? selector
        : selist(selector);
  return { type: 'Rule', selector: list, body, ...(extendInstructions !== undefined ? { extendInstructions } : {}) };
};
export const root = (children: Statement[]): Root => ({ type: 'Root', children });
