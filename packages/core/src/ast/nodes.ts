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
 * Selector model: a selector is a `SelectorList` of selector branches. A branch
 * with no combinator is a direct `SelectorTerm`; a `ComplexSelector.value` is a
 * flat sequence of selector term, combinator string, selector term, ...; a
 * `RelativeSelector.value` is the same sequence with a leading combinator
 * string; a `CompoundSelector.value` is a run of `SimpleSelector` tokens
 * concatenated with no separator (`.a` + `.b` => `.a.b`). The `&` parent-reference is just a
 * `SimpleSelector` whose text is `'&'`. Canonical selector text is computed once and
 * cached (in an optional memo field) via the free `compoundCanonical` /
 * `complexCanonical` helpers — composition (nesting) then works on these cached
 * strings, with NO per-placement node cloning / `inherit` analog.
 *
 * Trivia (comments) is carried STRUCTURALLY as a rules child, so byte-identity
 * holds with zero source-position tracking.
 */

import { Combinator, renderCombinator } from './node.js';
import type { GuardNode } from './guard.js'; // [guards]
import type { CallArg } from './mixin-dispatch.js'; // [guards]
import { NO_SPAN, type BodySpanSlots, type SpanSlots, type TriviaSlot } from './provenance.js';

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
 * `Dimension`/`Quoted`); the collision with `Value` is neutralized by the lane
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
export interface Any extends SpanSlots {
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
 * An internal structured space value, e.g. `1px solid black`. Ordinary
 * declaration/value adjacency is a raw recursive `ValueSlot[]`, not this
 * wrapper. `separators` is retained only when this non-value/prelude shape
 * needs authored boundary runs—including comments, line breaks, or
 * continuation indentation—to survive serialization.
 */
export interface SpacedValue {
  readonly type: 'SpacedValue';
  readonly parts: ValueNode[];
  readonly separators?: readonly string[];
}

/**
 * An explicit separator-aware value list, e.g. `Arial, sans-serif` or `1 / 2`.
 * The parser owns the boundaries and stores the typed entries directly in
 * `value`; a consumer never re-splits joined source bytes. `sep` is the one
 * canonical separator fact. Delimiters are represented by the separate `Block`
 * wrapper, not by a second list flag.
 */
export interface List {
  readonly type: 'List';
  readonly value: ValueSlot[];
  readonly sep: ',' | '/';
}

/** The binding store a variable operation addresses. */
export type VariableLookup = 'live' | 'scoped';

/** A reference to a mixin parameter / bound variable. */
export interface VariableReference extends SpanSlots {
  readonly type: 'VariableReference';
  readonly name: string;

  /** `$name` reads `live`; `$^name` and Less `@name` read `scoped`. */
  readonly lookup: VariableLookup;
}

/**
 * A reference to the current declaration-entry surface. Dot steps on this base
 * resolve a member name against both CSS property declarations and variable
 * declarations; a same-name hit in both namespaces is ambiguous.
 */
export interface DeclarationReference extends SpanSlots {
  readonly type: 'DeclarationReference';
  readonly raw: string;
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
export interface PropertyReference extends SpanSlots {
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
 * importance is a FLAG on the value, NOT part of the emitted bytes: `value`
 * evaluates without any inline `!important`, and the importance propagates to the
 * enclosing declaration (Less `importantScope`) so the declaration prints exactly
 * ONE trailing `!important`. A variable whose value ends in `!important` binds an
 * `Important` wrapper, so referencing it (`same: @v` / `multi: @v @v`) resolves the
 * inner value and hoists importance once — never doubling or emitting it inline.
 */
export interface Important {
  readonly type: 'Important';
  readonly value: ValueSlot;
}

/**
 * A binary value operation, e.g. `#aaa * 3` or `@a + @b`. tree2 owns the
 * STRUCTURE (operator + operand value nodes); the MATH is delegated to the
 * injected value service. Operands are themselves value nodes so nested
 * operations / variable refs fold bottom-up (each sub-operation is computed to
 * bytes before the outer one runs — precedence is carried by the tree shape).
 */
export interface Operation extends SpanSlots {
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
export interface FunctionCall extends SpanSlots {
  readonly type: 'FunctionCall';
  readonly name: string;
  readonly args: ValueSlot[];
  readonly modern: boolean;
}

/** A delimiter-bearing value, e.g. `(#aaa * 3)` or `[a, b]`. */
export interface Block extends SpanSlots {
  readonly type: 'Block';
  readonly value: ValueSlot;
  readonly delimiter: 'paren' | 'square';

  /** Less `~(...)` emits without the authored delimiters. */
  readonly escaped?: boolean;

  /**
   * The delimiters belong to an enclosing form's SYNTAX, not to the value —
   * jess's `$( … )`, whose parens are consumed by the `$(`/`)` spelling itself.
   * Such a block opens the same math context an authored group does (so
   * `$(4px / 2)` divides) but never emits delimiters, whatever its inner
   * evaluates to. This is NOT {@link escaped}, which drops the delimiters AND
   * the math context.
   */
  readonly boundary?: boolean;
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
export interface Interpolation extends SpanSlots {
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
export interface VarIndirect extends SpanSlots {
  readonly type: 'VarIndirect';
  readonly nameRef: ValueNode;

  /** Lookup mode for the variable named by `nameRef`. */
  readonly lookup: VariableLookup;
}

/**
 * An anonymous mixin value `@rs: { … }` / `$x: { … }`: an executable block bound
 * to a value, callable (`@rs()`) to splice its rules at the call site. Unlike a
 * {@link Collection} (a data map), its rules CAN contain rulesets, at-rules, and
 * mixin calls — it is the safe, more-capable classification for any value-position
 * `{ … }` block that cannot be clearly inferred to be a map. `rules` is the
 * CANONICAL block, stored once (never cloned). Its lexical closure belongs to the
 * render activation that binds it, never to this reusable source node.
 *
 * Like a {@link MixinDefinition}, it may carry a `params` list (same {@link Param} shape):
 * a value-position lambda `@($n) > { result: … }` — the lowered form of an SCSS
 * user `@function f($n) { @return … }`. The field is OMITTED for the plain,
 * parameterless block so that shape stays monomorphic. A call binds args→params
 * (positional/named/default) and yields the value of the rules' `result:` entry.
 */
export interface AnonymousMixin {
  readonly type: 'AnonymousMixin';
  readonly rules: Statement[];
  readonly params?: Param[];
}

/**
 * One authored data/map entry in a {@link Collection}. Collection entries are
 * not declarations: a collection is data, and the key may be any value shape the
 * dialect admits. The value may itself be an {@link AnonymousMixin}.
 */
export interface CollectionEntry {
  readonly type: 'CollectionEntry';
  readonly key: ValueSlot;
  readonly value: ValueSlot;
  readonly merge: null | ',' | ' ';
  readonly important: boolean;
  readonly valueOnNewLine?: boolean;
}

/**
 * A data/map block value `{ key: value; … }`. Its ROOT-LEVEL children are
 * key/value ENTRIES only — never declarations, variable declarations, at-rules,
 * mixin calls, or rulesets. An entry's VALUE may be any value node (including an
 * {@link AnonymousMixin}).
 *
 * Used for SCSS nested properties (`font: 20px { family: serif }`): the carrier
 * Declaration's `value` is a Collection whose entries keep LEAF-ONLY names, plus
 * an optional `base` holding the carrier's own declaration value (`20px`). The
 * hyphenated flattening happens at serialize time, never at parse. Also used for
 * Jess collection literals and Less value-position `{ … }` blocks that are
 * clearly data maps.
 */
export interface Collection {
  readonly type: 'Collection';
  readonly entries: CollectionEntry[];

  /** The carrier's own declaration value, e.g. `20px` in `font: 20px { … }`;
   * omitted when the nested property has no own value. */
  readonly base?: ValueSlot;
}

/** A value-position executable `{ … }` block. Collections are value nodes too,
 * but they are data-entry bodies, not statement bodies. */
export type ValueBlock = AnonymousMixin;

/** Narrow a value node to a value-position executable block. */
export const isValueBlock = (n: { type: string }): n is ValueBlock =>
  n.type === 'AnonymousMixin';

/** The statement rules of a value-position executable block. */
export const valueBlockBody = (n: ValueBlock): Statement[] =>
  n.rules;

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
export interface Reference extends SpanSlots {
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
  | DeclarationReference
  | PropertyReference
  | Sequence
  | Important
  | Operation
  | FunctionCall
  | Block
  | Condition
  | Interpolation
  | GeneralEnclosed
  | VarIndirect
  | AnonymousMixin
  | Collection
  | Reference
  | Range;

/** A scalar value or an authored adjacent value array (space-separated by default). */
/** A scalar value or an authored adjacent-value array. Arrays are recursive so
 * separator-bearing List items can retain a nested space group, e.g. the left
 * side of modern `rgb(15 23 42 / .22)`. */
export type ValueSlot = ValueNode | readonly ValueSlot[];

/* ---------------------------------------------------------------- selectors */

/**
 * A single simple-selector token, e.g. `.a`, `:hover`, `&`. A token that
 * contains `@{…}` carries an `interp` template and `text: null`; the concrete
 * text is resolved at ruleset-enter in the entering frame. A static token keeps
 * `text` and `interp: null` (the cached `compoundCanonical` fast path).
 */
export interface SimpleSelector extends SpanSlots {
  readonly type: 'SimpleSelector';
  readonly text: string | null;
  readonly interp: Interpolation | null;
}

/**
 * A structured selector-function pseudo, e.g. `:is(.a, .b)`, `:not(.x)`. `text`
 * and `interp` are the FIRST TWO fields at the SAME offsets as `SimpleSelector`
 * so the degree-2 IC over `sim.text`/`sim.interp` in `compoundCanonical` reads a
 * shared-prefix offset. For a STRUCTURED pseudo the STRUCTURE lives in `args`
 * (the parsed inner `SelectorList`) and `text` is `null`: the parser produces
 * pieces + trivia, never a joined spelling — SERIALIZATION owns the inline
 * `:is(a, b)` rule (see `pseudoCanonical` / `serialize.ts`), never a grammar.
 * `text` is only non-null for the degrade-to-opaque case (`args: null`), where
 * the token behaves like a plain `SimpleSelector`. `crossable` is true iff the
 * name is a boundary a selector may cross for extend (`:is`/`:matches`); every
 * other name (`:not`/`:where`/`:has`/…) is sealed.
 */
export interface PseudoSelector extends SpanSlots {
  readonly type: 'PseudoSelector';
  readonly text: string | null;
  readonly interp: Interpolation | null;
  readonly name: string;
  readonly args: SelectorList | null;
  readonly crossable: boolean;
}

/** A single token inside a compound — a plain simple or a structured pseudo. */
export type SimpleToken = SimpleSelector | PseudoSelector;

/** A run of simple tokens with no separator, e.g. `.a.b`, `&:hover`. */
export interface CompoundSelector extends SpanSlots {
  readonly type: 'CompoundSelector';
  readonly value: SimpleToken[];

  /** Serializer-owned memo of the canonical join (lazy). */
  _canon?: string;

  /** Serializer-owned memo of the has-interp flag (lazy). */
  _hasInterp?: boolean;
}

/** Canonical concatenated text of a compoundSelector (`.a.b`), memoised. */
export const compoundCanonical = (c: CompoundSelector): string => {
  if (c._canon === undefined) {
    let s = '';
    for (const sim of c.value) {
      s += simpleTokenText(sim);
    }
    c._canon = s;
  }
  return c._canon;
};

/** True iff any token needs frame-dependent interpolation resolution. */
export const compoundHasInterp = (c: CompoundSelector): boolean => {
  if (c._hasInterp === undefined) {
    let has = false;
    for (const sim of c.value) {
      if (sim.interp !== null) {
        has = true;
        break;
      }
    }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

/** True iff any token carries a literal `&` (bare, fused, or in an interpolation template). */
export const compoundHasAmpersand = (c: CompoundSelector): boolean => {
  for (const sim of c.value) {
    if (sim.type === 'PseudoSelector') {
      if (pseudoCanonical(sim).includes('&')) {
        return true;
      }
      continue;
    }
    if (sim.text?.includes('&') === true) {
      return true;
    }
    if (sim.interp !== null) {
      for (const part of sim.interp.parts) {
        if ('lit' in part && part.lit.includes('&')) {
          return true;
        }
      }
    }
  }
  return false;
};

export type SelectorTerm = SimpleToken | CompoundSelector;

/**
 * A flat selector-term / combinator sequence. A `ComplexSelector` is only for
 * selector branches with at least one authored combinator; a no-combinator
 * branch is a `SelectorTerm` directly.
 */
export interface ComplexSelector extends SpanSlots {
  readonly type: 'ComplexSelector';
  readonly value: [SelectorTerm, ...(SelectorTerm | Combinator)[]];

  /** Serializer-owned memo of the canonical join (lazy). */
  _canon?: string;

  /** Serializer-owned memo of the has-ampersand flag (lazy). */
  _hasAmp?: boolean;

  /** Serializer-owned memo of the has-interp flag (lazy). */
  _hasInterp?: boolean;
}

/**
 * A combinator-leading relative selector branch. These are admitted only in
 * grammar contexts that allow relative selectors.
 */
export interface RelativeSelector extends SpanSlots {
  readonly type: 'RelativeSelector';
  readonly value: [Combinator, SelectorTerm, ...(SelectorTerm | Combinator)[]];

  /** Serializer-owned memo of the canonical join (lazy). */
  _canon?: string;

  /** Serializer-owned memo of the has-ampersand flag (lazy). */
  _hasAmp?: boolean;

  /** Serializer-owned memo of the has-interp flag (lazy). */
  _hasInterp?: boolean;
}

export type SelectorBranch = SelectorTerm | ComplexSelector | RelativeSelector;

/** Canonical text of a complex selector, memoised. */
export const complexCanonical = (c: ComplexSelector): string => {
  if (c._canon === undefined) {
    let s = selectorTermCanonical(c.value[0]);
    for (let index = 1; index < c.value.length; index += 2) {
      const comb = c.value[index];
      const term = c.value[index + 1];
      if (typeof comb === 'string' && term !== undefined && typeof term !== 'string') {
        s += renderCombinator(comb) + selectorTermCanonical(term);
      }
    }
    c._canon = s;
  }
  return c._canon;
};

/** Canonical text of a relative selector, memoised. */
export const relativeCanonical = (c: RelativeSelector): string => {
  if (c._canon === undefined) {
    let s = renderCombinator(c.value[0]).trimStart() + selectorTermCanonical(c.value[1]);
    for (let index = 2; index < c.value.length; index += 2) {
      const comb = c.value[index];
      const term = c.value[index + 1];
      if (typeof comb === 'string' && term !== undefined && typeof term !== 'string') {
        s += renderCombinator(comb) + selectorTermCanonical(term);
      }
    }
    c._canon = s;
  }
  return c._canon;
};

export const selectorBranchCanonical = (branch: SelectorBranch): string =>
  branch.type === 'ComplexSelector'
    ? complexCanonical(branch)
    : branch.type === 'RelativeSelector'
      ? relativeCanonical(branch)
      : selectorTermCanonical(branch);

/**
 * The inline canonical spelling of a structured pseudo, e.g. `:is(.a, .b)`. This
 * is the SINGLE core serialization site for the pseudo-arg join: branches join
 * with `, ` (normalized WS, one line) via the core-owned branch canonicalizer. The
 * grammar NEVER computes this — it only supplies `args` (structure) + trivia. The
 * degrade-to-opaque case (`args: null`) falls back to the retained `text`.
 */
export const pseudoCanonical = (p: PseudoSelector): string =>
  p.args !== null
    ? `${p.name}(${p.args.selectors.map(selectorBranchCanonical).join(', ')})`
    : p.text ?? '';

/** The canonical contributed text of one simple token: a structured pseudo emits
 *  its inline `:is(a, b)` form, a plain simple emits its literal (`''` when the
 *  token is interp-only and carries no static text). */
export const simpleTokenText = (sim: SimpleToken): string =>
  sim.type === 'PseudoSelector' ? pseudoCanonical(sim) : (sim.text ?? '');

export const selectorTermCanonical = (term: SelectorTerm): string =>
  term.type === 'CompoundSelector' ? compoundCanonical(term) : simpleTokenText(term);

export const selectorTermHasAmpersand = (term: SelectorTerm): boolean =>
  term.type === 'CompoundSelector'
    ? compoundHasAmpersand(term)
    : term.type === 'PseudoSelector'
      ? pseudoCanonical(term).includes('&')
      : term.text?.includes('&') === true
        || term.interp?.parts.some(part => 'lit' in part && part.lit.includes('&')) === true;

export const selectorTermHasInterp = (term: SelectorTerm): boolean =>
  term.type === 'CompoundSelector' ? compoundHasInterp(term) : term.interp !== null;

export const complexHasAmpersand = (c: ComplexSelector): boolean => {
  if (c._hasAmp === undefined) {
    let has = false;
    for (const part of c.value) {
      if (typeof part !== 'string' && selectorTermHasAmpersand(part)) {
        has = true;
        break;
      }
    }
    c._hasAmp = has;
  }
  return c._hasAmp;
};

/** True iff any compound carries an interpolated token (fast-path gate). */
export const complexHasInterp = (c: ComplexSelector): boolean => {
  if (c._hasInterp === undefined) {
    let has = false;
    for (const part of c.value) {
      if (typeof part !== 'string' && selectorTermHasInterp(part)) {
        has = true;
        break;
      }
    }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

export const relativeHasAmpersand = (c: RelativeSelector): boolean => {
  if (c._hasAmp === undefined) {
    let has = false;
    for (let index = 1; index < c.value.length; index += 1) {
      const part = c.value[index]!;
      if (typeof part !== 'string' && selectorTermHasAmpersand(part)) {
        has = true;
        break;
      }
    }
    c._hasAmp = has;
  }
  return c._hasAmp;
};

export const relativeHasInterp = (c: RelativeSelector): boolean => {
  if (c._hasInterp === undefined) {
    let has = false;
    for (let index = 1; index < c.value.length; index += 1) {
      const part = c.value[index]!;
      if (typeof part !== 'string' && selectorTermHasInterp(part)) {
        has = true;
        break;
      }
    }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

export const selectorBranchHasAmpersand = (branch: SelectorBranch): boolean =>
  branch.type === 'ComplexSelector'
    ? complexHasAmpersand(branch)
    : branch.type === 'RelativeSelector'
      ? relativeHasAmpersand(branch)
      : selectorTermHasAmpersand(branch);

export const selectorBranchHasInterp = (branch: SelectorBranch): boolean =>
  branch.type === 'ComplexSelector'
    ? complexHasInterp(branch)
    : branch.type === 'RelativeSelector'
      ? relativeHasInterp(branch)
      : selectorTermHasInterp(branch);

/** A comma-separated list of selector branches, e.g. `.a, .b`. */
export interface SelectorList extends SpanSlots {
  readonly type: 'SelectorList';
  readonly selectors: SelectorBranch[];
}

/* -------------------------------------------------------------- statements */

/**
 * A `name: value;` declaration. `name` may be an `Interpolation` template
 * (`@{prefix}width`). `merge` is `','` for `+`, `' '` for `+_`, else `null`.
 * `important` is the structured `!important` flag parsed directly with the value,
 * promoted so merge can OR it across members and emit it once.
 */
export interface Declaration extends SpanSlots {
  readonly type: 'Declaration';
  readonly name: string | Interpolation;
  readonly value: ValueSlot;
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
 * the binding is read, so `value` is `ValueSlot | MixinCall`.
 */
export type VariableWrite =
  | { readonly mode: 'declare' }
  | { readonly mode: 'if-absent' | 'reassign'; readonly lookup: VariableLookup };

export interface VariableDeclaration extends SpanSlots {
  readonly type: 'VariableDeclaration';
  readonly name: string;
  readonly value: ValueSlot | MixinCall;

  /**
   * An ordinary declaration writes both stores and therefore has no lookup
   * selector. Conditional and reassignment forms carry the lookup they use.
   */
  readonly write: VariableWrite;
}

/** A comment carried structurally in source order (block or line text as-is). */
export interface Comment extends SpanSlots {
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
 * carrying Ruleset's own selector list; `target` is the FIND selector list;
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
 * A `selector { ...rules }` ruleset; rules may nest further rules.
 * `extendInstructions` carries the `:extend()` instructions parsed from the rules
 * (the `Extend` statements are removed and hoisted here);
 * absent for the common no-extend rule so the serializer's zero-cost gate holds.
 */
export interface Ruleset extends SpanSlots, BodySpanSlots {
  readonly type: 'Ruleset';
  readonly selector: SelectorList;
  readonly rules: Statement[];
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
  default?: ValueSlot;
  pattern?: ValueSlot; // [guards] literal-value pattern-match param
  rest?: boolean; // [guards] variadic `...`
}

/**
 * A mixin definition. Its `rules` are the CANONICAL rules, stored ONCE — every
 * call reads it through an overlay (bindings + parent-selector context) and
 * NEVER clones it. [guards] `guard` is an optional `when (...)` condition.
 */
export interface MixinDefinition extends SpanSlots, BodySpanSlots {
  readonly type: 'MixinDefinition';
  readonly name: string;
  readonly params: Param[];
  readonly rules: Statement[];
  readonly guard?: GuardNode; // [guards]
  /*
   * [dedup] set only on a def SYNTHESIZED from a paren-less ruleset callable as a
   * zero-arg mixin (`.foo {…}` dispatched via `.foo()`). A real parametric
   * `MixinDefinition` leaves it undefined. Duplicate-declaration dedup keeps overloaded
   * PARAMETRIC output verbatim (Less restricts its ambient lookup) but collapses
   * identical ruleset-mixin output, so the serializer must tell them apart.
   */
  readonly ruleMixin?: boolean;
}

/**
 * One segment of a namespaced-call path: a combinator (`' '` descendant or
 * `'>'` child) and a selector string (`#namespace`, `.borders`).
 */
export interface MixinPathSegment {
  combinator: Combinator;
  selector: string;
}

/**
 * A mixin call. Args bind to the def's params (positional or named). [guards]
 * `path` is the namespace descent prefix for `#ns .a .b()` (empty for a
 * plain flat `.mixin()` call — byte-unchanged flat dispatch). `.m() !important`
 * promotes every declaration the body emits.
 */
export interface MixinCall extends SpanSlots {
  readonly type: 'MixinCall';
  readonly name: string;
  readonly args: CallArg[];
  readonly path: MixinPathSegment[];
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
  readonly selectors: readonly SelectorTerm[];
}

/**
 * A Jess `$for (... of ...)` loop. The binding retains the authored single,
 * comma, bracket, or tuple form; entries are source-dependent. Less `each()` lowers
 * at its parser boundary into a compatible Jess binding.
 * a map (a `Collection` or `AnonymousMixin` / a var bound to one / a `@map[k]` accessor) iterates
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
  readonly iterable: ValueSlot | MixinCall;
  readonly rules: Statement[];
  readonly binding: ForBinding;
}

/** One ordered arm of a Jess `$if` chain. A null guard is the final `$else`. */
export interface IfBranch {
  readonly guard: GuardNode | null;
  readonly rules: Statement[];
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
export interface Stylesheet extends SpanSlots, TriviaSlot {
  readonly type: 'Stylesheet';
  readonly rules: Statement[];
}

/*
 * [atrule] at-rule nodes are valid body/stylesheet statements; type-only import keeps
 * nodes.ts free of a runtime dependency on the sibling at-rule module.
 */
import type { AtRuleBlock, AtRuleStatement, ImportAtRule, OpaqueAtRuleBlock, Plugin } from './at-rule.js';

export type Statement =
  | Ruleset
  | Declaration
  | Comment
  | MixinDefinition
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

  /*
   * A bare value-position call in statement position (`e('/* … *\/');`): Less
   * evaluates it and emits its result bytes as a standalone line (unquote/escape
   * at document scope), so it is a legitimate statement, not just a value node.
   */
  | FunctionCall;

/* ------------------------------------------------------------ constructors */

export const keyword = (src: string): Keyword => ({ type: 'Keyword', src });
export const any = (src: string): Any => ({ type: 'Any', src, _s: NO_SPAN, _e: NO_SPAN });
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
export const list = (
  value: ValueSlot[],
  sep: List['sep'] = ','
): List => ({ type: 'List', value, sep });

export const simpleSelector = (text: string): SimpleSelector => ({ type: 'SimpleSelector', text, interp: null, _s: NO_SPAN, _e: NO_SPAN });

/** An interpolated simple token, e.g. `.icon-@{type}`. */
export const interpolatedSimpleSelector = (interp: Interpolation): SimpleSelector => ({ type: 'SimpleSelector', text: null, interp, _s: NO_SPAN, _e: NO_SPAN });

/**
 * Selector-function pseudos a selector may CROSS during extend (the arg list is a
 * boundary extend forks through). Gated on the NAME whitelist, never on colon
 * count — `::slotted()` takes selector args but stays sealed (not listed). Compare
 * lowercased. `:where`/`:not`/`:has`/`:global`/`:local` are sealed (crossable:false).
 */
const CROSSABLE_PSEUDOS = new Set([':is', ':matches']);
export const crossable = (name: string): boolean => CROSSABLE_PSEUDOS.has(name.toLowerCase());

/** A structured selector-function pseudo. When `args` is present the structure
 *  lives there and `text` is forced `null` (serialization joins via
 *  `pseudoCanonical`, the parser never does); `text` is only retained for the
 *  degrade-to-opaque `args: null` case. `crossable` is computed from `name`. */
export const pseudoSelector = (
  name: string,
  args: SelectorList | null,
  text: string | null = null,
  interp: Interpolation | null = null
): PseudoSelector => ({ type: 'PseudoSelector', text: args !== null ? null : text, interp, name, args, crossable: crossable(name), _s: NO_SPAN, _e: NO_SPAN });
export const interpolation = (parts: InterpPart[]): Interpolation => ({ type: 'Interpolation', parts, _s: NO_SPAN, _e: NO_SPAN });
export const generalEnclosed = (
  form: GeneralEnclosed['form'],
  name: string | null,
  content: Interpolation
): GeneralEnclosed => ({ type: 'GeneralEnclosed', form, name, content });
export const varIndirect = (nameRef: ValueNode, lookup: VariableLookup): VarIndirect => ({ type: 'VarIndirect', nameRef, lookup, _s: NO_SPAN, _e: NO_SPAN });
export const anonymousMixin = (rules: Statement[], params?: Param[]): AnonymousMixin =>
  params === undefined ? { type: 'AnonymousMixin', rules } : { type: 'AnonymousMixin', rules, params };

/**
 * Classify a Less-style detached `{ … }` block by its direct statement shape.
 * Jess collections parse through their own entry grammar and never reach this
 * helper; Less keeps its legacy heuristic where variable-only blocks are data
 * maps and every other statement body is an executable anonymous mixin.
 */
type CollectionVariableDeclaration = VariableDeclaration & { readonly value: ValueSlot };

const isCollectionVariableDeclaration = (statement: Statement): statement is CollectionVariableDeclaration =>
  statement.type === 'VariableDeclaration'
  && (!('type' in statement.value) || statement.value.type !== 'MixinCall');

export const classifyValueBlock = (rules: Statement[]): AnonymousMixin | Collection => {
  if (rules.length === 0 || !rules.every(isCollectionVariableDeclaration)) {
    return anonymousMixin(rules);
  }
  return collection(rules.map(entry =>
    collectionEntry(keyword(entry.name), entry.value)
  ));
};
export const forNode = (
  iterable: ValueSlot | MixinCall,
  rules: Statement[],
  binding: ForBinding
): For => ({ type: 'For', iterable, rules, binding });
export const ifNode = (branches: readonly [IfBranch, ...IfBranch[]]): If => ({ type: 'If', branches });
export const range = (
  start: ValueNode,
  end: ValueNode,
  step: ValueNode | null = null,
  includeStart = true,
  includeEnd = true
): Range => ({ type: 'Range', start, end, step, includeStart, includeEnd });
export const reference = (
  base: ValueNode | MixinCall,
  steps: readonly ReferenceStep[],
  raw: string
): Reference => ({ type: 'Reference', base, steps, raw, _s: NO_SPAN, _e: NO_SPAN });
export const propertyReference = (name: string, raw: string = `$${name}`): PropertyReference => ({ type: 'PropertyReference', name, raw, _s: NO_SPAN, _e: NO_SPAN });

/** A compound from an already-built list of simple tokens. */
export const compoundSelectorOf = (value: [SimpleToken, SimpleToken, ...SimpleToken[]]): CompoundSelector => ({ type: 'CompoundSelector', value, _s: NO_SPAN, _e: NO_SPAN });

/** A selector term: a lone simple token stays direct; adjacent tokens form a compound. */
export const selectorTermOf = (value: readonly [SimpleToken, ...SimpleToken[]]): SelectorTerm => {
  const [first, second, ...rest] = value;
  return second === undefined ? first : compoundSelectorOf([first, second, ...rest]);
};

/** `compoundSelector('.a', '.b')` => `.a.b`. */
export const compoundSelector = (first: string, second: string, ...rest: string[]): CompoundSelector =>
  compoundSelectorOf([simpleSelector(first), simpleSelector(second), ...rest.map(simpleSelector)]);

type SelectorPartInput = { combinator?: Combinator; term: SelectorTerm };

/** `complexSelector([{ term: simpleSelector('.a') }, { combinator: '>', term: simpleSelector('.b') }])` => `.a > .b`. */
export const complexSelector = (
  segments: [SelectorPartInput, SelectorPartInput, ...SelectorPartInput[]]
): ComplexSelector => {
  const [head, ...tail] = segments;
  const value: ComplexSelector['value'] = [
    head.term,
    ...tail.flatMap(s => [s.combinator ?? ' ', s.term] as const)
  ];
  return {
    type: 'ComplexSelector',
    value,
    _s: NO_SPAN,
    _e: NO_SPAN
  };
};
export const relativeSelector = (
  combinator: Combinator,
  segments: [SelectorPartInput, ...SelectorPartInput[]]
): RelativeSelector => {
  const [head, ...tail] = segments;
  const value: RelativeSelector['value'] = [
    combinator,
    head.term,
    ...tail.flatMap(s => [s.combinator ?? ' ', s.term] as const)
  ];
  return {
    type: 'RelativeSelector',
    value,
    _s: NO_SPAN,
    _e: NO_SPAN
  };
};
export const selectorBranchOf = (segments: readonly [SelectorPartInput, ...SelectorPartInput[]]): SelectorBranch => {
  const [first, second, ...rest] = segments;
  return second === undefined ? first.term : complexSelector([first, second, ...rest]);
};
export const selist = (...selectors: SelectorBranch[]): SelectorList => ({ type: 'SelectorList', selectors, _s: NO_SPAN, _e: NO_SPAN });

export const decl = (
  name: string | Interpolation,
  value: ValueSlot,
  merge: null | ',' | ' ' = null,
  important = false,
  valueOnNewLine = false
): Declaration =>
  valueOnNewLine
    ? { type: 'Declaration', name, value, merge, important, valueOnNewLine: true, _s: NO_SPAN, _e: NO_SPAN }
    : { type: 'Declaration', name, value, merge, important, _s: NO_SPAN, _e: NO_SPAN };

export const collectionEntry = (
  key: ValueSlot,
  value: ValueSlot,
  merge: null | ',' | ' ' = null,
  important = false,
  valueOnNewLine = false
): CollectionEntry =>
  valueOnNewLine
    ? { type: 'CollectionEntry', key, value, merge, important, valueOnNewLine: true }
    : { type: 'CollectionEntry', key, value, merge, important };

/** A data/map block value: leaf-named `entries`, plus an optional `base` carrier
 * value (`20px` in `font: 20px { … }`). See {@link Collection}. */
export const collection = (entries: CollectionEntry[], base?: ValueSlot): Collection =>
  base === undefined ? { type: 'Collection', entries } : { type: 'Collection', entries, base };
export const comment = (text: string): Comment => ({ type: 'Comment', text, _s: NO_SPAN, _e: NO_SPAN });

/** [import:inline] A verbatim raw-bytes statement (`@import (inline)` splice).
 * `media` (optional) wraps the splice in an `@media <media> { … }` block. */
export const rawInline = (text: string, media?: string | null): RawInline =>
  media != null ? { type: 'RawInline', text, media } : { type: 'RawInline', text };
export const variableReference = (name: string, lookup: VariableLookup): VariableReference =>
  ({ type: 'VariableReference', name, lookup, _s: NO_SPAN, _e: NO_SPAN });
export const declarationReference = (raw: string = '$'): DeclarationReference => ({ type: 'DeclarationReference', raw, _s: NO_SPAN, _e: NO_SPAN });
export const sequence = (parts: ValueNode[]): Sequence => ({ type: 'Sequence', parts });
export const important = (value: ValueSlot): Important => ({ type: 'Important', value });

/** @deprecated Renamed to {@link sequence}; kept one cycle for straddling callers. */
export const concat = sequence;
export const operation = (operator: string, left: ValueNode, right: ValueNode): Operation =>
  ({ type: 'Operation', operator, left, right, _s: NO_SPAN, _e: NO_SPAN });
export const funcCall = (name: string, args: ValueSlot[], modern = false): FunctionCall =>
  ({ type: 'FunctionCall', name, args, modern, _s: NO_SPAN, _e: NO_SPAN });
export const block = (value: ValueSlot, delimiter: Block['delimiter'] = 'paren', escaped = false): Block =>
  escaped ? { type: 'Block', value, delimiter, escaped: true, _s: NO_SPAN, _e: NO_SPAN } : { type: 'Block', value, delimiter, _s: NO_SPAN, _e: NO_SPAN };

/** The `$( … )` math boundary — see {@link Block.boundary}. */
export const boundaryBlock = (value: ValueSlot): Block =>
  ({ type: 'Block', value, delimiter: 'paren', boundary: true, _s: NO_SPAN, _e: NO_SPAN });
export const condition = (guard: GuardNode, src: string): Condition => ({ type: 'Condition', guard, src });
export const variableDeclaration = (
  name: string,
  value: ValueSlot | MixinCall,
  write: VariableWrite
): VariableDeclaration =>
  ({ type: 'VariableDeclaration', name, value, write, _s: NO_SPAN, _e: NO_SPAN });
export const mixinDef = (
  name: string,
  params: Param[],
  rules: Statement[],
  guard?: GuardNode // [guards]
): MixinDefinition => ({ type: 'MixinDefinition', name, params, rules, ...(guard !== undefined ? { guard } : {}), _s: NO_SPAN, _e: NO_SPAN, _bs: NO_SPAN, _be: NO_SPAN });

/** [guards] Args may be bare value nodes (positional) or `{ value, name? }`. */
export const mixinCall = (name: string, args: readonly (ValueNode | CallArg)[] = []): MixinCall => ({
  type: 'MixinCall',
  name,
  args: args.map(a => ('type' in a ? { value: a } : a)),
  path: [],
  important: false,
  _s: NO_SPAN, _e: NO_SPAN
});
export const apply = (selectors: readonly SelectorTerm[]): Apply => ({ type: 'Apply', selectors });

/** A single simple-string selector branch, e.g. `sel('.test')`. */
export const sel = (text: string): SelectorBranch => simpleSelector(text);

/** `rule('.test', [...])`, `rule(sel('.a > .b'), ...)`, or `rule(selist(...), ...)`.
 *  `extendInstructions` (optional) carries hoisted `:extend()` instructions. */
export const rule = (
  selector: string | SelectorBranch | SelectorList,
  rules: Statement[],
  extendInstructions?: ExtendInstruction[],
  guard?: GuardNode
): Ruleset => {
  const list =
    typeof selector === 'string'
      ? selist(sel(selector))
      : selector.type === 'SelectorList'
        ? selector
        : selist(selector);
  return {
    type: 'Ruleset',
    selector: list,
    rules,
    ...(extendInstructions !== undefined ? { extendInstructions } : {}),
    ...(guard !== undefined ? { guard } : {}),
    _s: NO_SPAN,
    _e: NO_SPAN,
    _bs: NO_SPAN,
    _be: NO_SPAN
  };
};
export const styleImport = (
  path: Quoted,
  mode: StyleImport['mode'] = 'compose',
  namespace: string | null = null,
  forward = false
): StyleImport => ({ type: 'StyleImport', path, mode, namespace, forward });
export const moduleImport = (
  path: Quoted,
  mode: ModuleImport['mode'],
  namespace: string | null = null,
  imports: readonly ModuleImportSpecifier[] = [],
  defaultImport: string | null = null
): ModuleImport => ({ type: 'ModuleImport', path, mode, defaultImport, namespace, imports });
export const stylesheet = (rules: Statement[]): Stylesheet => ({ type: 'Stylesheet', rules, _s: NO_SPAN, _e: NO_SPAN, _trivia: undefined });
