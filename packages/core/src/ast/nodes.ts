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
import { NO_SPAN, valueLayoutOf, withValueLayout, type BodySpanSlots, type SpanSlots, type TriviaSlot } from './provenance.js';

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

/**
 * The `null` LITERAL (§4.3) — a leaf of its own, not a `Keyword` that happens to
 * spell one.
 *
 * It is a node rather than a byte sniff because `null` is a literal in `.jess`
 * (and Sass) and an ORDINARY IDENTIFIER everywhere else: `b: null` must elide in
 * `.jess` and pass through verbatim in `.css`/`.less`. Sniffing `src` at
 * materialize time — the route `true`/`false` take, where every dialect agrees —
 * cannot tell those apart, and re-deriving a dialect fact from bytes in core is
 * exactly what the parser-owns-structure invariant forbids. So the GRAMMAR that
 * admits the literal mints this node, and core never asks which dialect it came
 * from.
 *
 * `src` rides so the verbatim-field split holds (`'src' in v` is an AST literal,
 * `'bytes' in v` a value) and the authored spelling survives a round trip.
 */
export interface Null {
  readonly type: 'Null';
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
 * wrapper.
 *
 * The shape is `{ parts }` and nothing else: authored boundary runs (comments,
 * line breaks, continuation indentation) live in the `withValueLayout` side
 * table keyed by this node, exactly as they do for a raw `ValueSlot[]` and a
 * `List`. A value node never grows a `separators` array of its own.
 */
export interface Sequence {
  readonly type: 'Sequence';
  readonly parts: ValueNode[];
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

/**
 * WHAT a lookup looks for. Previously this fact was encoded four different ways
 * — a field on one node (`BracketLookup.keyKind`), the node TYPE on three
 * (`VariableReference`=var, `PropertyReference`=prop, `MixinCall`=mixin), and
 * ABSENT on `DotLookup`, which is why "what is being looked up" there looked
 * like a semantic problem instead of a missing slot.
 */
export type LookupKind = 'var' | 'prop' | 'mixin' | 'entry' | 'index' | 'member';

/**
 * A reference: WHERE you look (`scope`), WHAT kind of thing you look for
 * (`kind`), WHICH name (`name`), and the verbatim fallback spelling (`raw`).
 *
 * Carried as FLAT FIELDS rather than a nested object on purpose. A bare `$name`
 * is the hottest reference shape in any stylesheet, and routing every one
 * through a container — or through a descriptor sub-object — is an allocation
 * regression the perf invariants reject. Flat is fine; what is NOT fine is each
 * reference node inventing its own private spelling of `scope` and `kind`,
 * which is how eight kinds came to encode three facts twelve ways.
 *
 * `name` admits a NODE, not just a string. That is what retires `VarIndirect`
 * (`@@name`), which existed only because a name could not be a node.
 */
export interface Lookup extends SpanSlots {
  readonly type: 'Lookup';

  /** `$name` reads `live`; `$^name` and Less `@name` read `scoped`. */
  readonly scope: VariableLookup;

  /**
   * `var` — a mixin param / bound variable.
   * `prop` — a Less property accessor: the CURRENT value of the CSS property
   *   `name` in the enclosing declaration scope, last-wins and cascading up the
   *   ruleset chain, carrying the source declaration's `!important`.
   * `entry` — the current declaration-entry surface; `name` is empty, and dot
   *   steps on it resolve against both CSS property and variable declarations.
   */
  readonly kind: LookupKind;

  /** A literal name, or the node whose resolved bytes NAME the target (`@@x`). */
  readonly name: string | ValueNode;

  /**
   * The verbatim source, emitted as a literal fallback when the target does not
   * resolve in the current ast/ scope — so an unresolved accessor never
   * regresses below its prior verbatim output. One field, where
   * `PropertyReference`, `DeclarationReference` and `Reference` each carried
   * their own.
   */
  readonly raw: string;
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

  /**
   * Was this operation AUTHORED inside a css-values-4 §10 math function
   * (`calc`, `min`, `clamp`, `round`, …)? A parse-time POSITIONAL fact, not a
   * verdict: whether the operation then folds is decided by this fact TOGETHER
   * with {@link mathOutsideParens} and `unitMode`. A cross-unit pair still
   * answers to `unitMode` for whether it folds, preserves as `calc(…)`, or
   * raises.
   *
   * Non-optional and factory-defaulted, so every `Operation` realizes ONE
   * hidden class. `FunctionCall.modern` is the precedent; `Block.boundary` is
   * not — it is optional and realizes three.
   */
  readonly inMathFunction: boolean;

  /**
   * Does this operation compute WITHOUT an enclosing math context — no
   * parentheses, no `calc(…)`, no `$( … )`? A parse-time fact decided by the
   * dialect whose grammar built the node (§12.6b), the other half of the pair
   * v1 carried as `OperationOptions`.
   *
   * The CSS base answer, and the factory default, is `operator !== '/'`: every
   * operator but `/` is arithmetic wherever it appears, while `/` is also a CSS
   * SEPARATOR (`font: 12px/1.5`, `rgb(0 0 0 / 50%)`) and so needs a math
   * context to be read as division. Less spells that same answer
   * `math: parens-division`; `math: always` makes `/` compute bare too, and
   * `math: parens`/`strict` makes nothing compute bare.
   *
   * It is the DECISION, not the mode: the evaluator reads what the node says
   * and never consults ambient config, which is the rule that removed
   * `equalityMode` (§5.1) and now removes the eval-time `mathMode` read.
   *
   * Non-optional and factory-defaulted, for the same one-hidden-class reason as
   * {@link inMathFunction}.
   */
  readonly mathOutsideParens: boolean;
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

  /** {@link CallArg}, not a bare value, so a KEYWORD argument
   *  (`color.adjust($c, $lightness: -10%)`) is the same node a keyword mixin
   *  argument already is. */
  readonly args: Array<CallArg<ValueSlot>>;
  readonly modern: boolean;
}

/** A delimiter-bearing value, e.g. `(#aaa * 3)` or `[a, b]`. */
export interface Block extends SpanSlots {
  readonly type: 'Block';
  readonly value: ValueSlot;
  readonly delimiter: 'paren' | 'square';

  /** Less `~(...)` emits without the authored delimiters. */
  readonly escaped?: boolean;
}

/**
 * A COMPUTATION BOUNDARY — jess's `$( … )`. The `$(` and `)` are the marker that
 * says EVALUATE THIS: they are not delimiters around a value and they never
 * emit, whatever the inner evaluates to (`$(foo)` -> `foo`, while the authored
 * group `$((foo))` -> `(foo)`).
 *
 * Categorically NOT a {@link Block}, which is a DELIMITED VALUE whose parens are
 * part of the value's own authored syntax — `(1 + 2)` means something in CSS on
 * its own. An `Expression` opens the same math context an authored group does
 * (so `$(4px / 2)` divides), and it is the one position where a `.jess`
 * comparison legitimately lands in value position: `.jess` has no `boolean()`
 * (ledger P17), so `$( … )` is where a real comparison EVALUATES rather than
 * emitting its source text.
 */
export interface Expression extends SpanSlots {
  readonly type: 'Expression';
  readonly value: ValueSlot;
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

/** One ordered arm of a VALUE-position `$if` chain. A null guard is the final
 * `$else`. The arm carries a VALUE, never a declaration list — that is the whole
 * distinction between this and the statement {@link If} (§4.5.3b). */
export interface IfValueBranch {
  readonly guard: GuardNode | null;
  readonly value: ValueSlot;
}

/**
 * The VALUE form of jess `$if` — `foo: $if ($bar) { blah } $else { blarp };`
 * (§4.5.3b). Branch guards are evaluated left-to-right and only the TAKEN arm's
 * value is evaluated, so the form is branch-lazy by construction.
 *
 * This is the lowering target every dialect's value-position conditional lands
 * in: Less `if(<cond>, a, b)` and Sass `if(<cond>, a, b)` are SYNTAX, not
 * functions (§4.5.3a), and each grammar lowers its own truthiness rule (§4.4.2)
 * into `guard` before the node is built. Core therefore evaluates a condition
 * that is ALREADY dialect-specific and carries no dialect knowledge itself.
 */
export interface IfValue {
  readonly type: 'IfValue';
  readonly branches: readonly [IfValueBranch, ...IfValueBranch[]];
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
export type ReferenceStep = LookupStep | ReferenceCall;

/**
 * ONE lookup step following a reference — what `DotLookup` and `BracketLookup`
 * used to be. They were never two things: a dot step and a bracket step differ
 * only in the SPELLING the dialect gives the same three facts, and spelling is
 * the parser's business, not the AST's. Splitting them is what left `DotLookup`
 * with no `kind` field at all, so "what is being looked up" had nowhere to live
 * and read as a semantic problem instead of an absent slot.
 *
 * Carries the same `kind`/`name` descriptor as {@link Lookup}; only `scope`
 * differs, because a step's scope IS its base — the preceding link in the chain.
 */
export interface LookupStep {
  readonly type: 'LookupStep';

  /** The dialect's lookup namespace for this step. */
  readonly kind: LookupKind;

  /** A literal member name, a computed key node, or a numeric index. */
  readonly name: string | ValueNode | number;

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
  | Null
  | Color
  | Quoted
  | Any
  | Comment
  | Url
  | SelectorCapture
  | Dimension
  | Sequence
  | List
  | Lookup
  | Important
  | Operation
  | FunctionCall
  | Block
  | Expression
  | Condition
  | IfValue
  | Interpolation
  | AnonymousMixin
  | Collection
  | Reference
  | Range;

/** A scalar value or an authored adjacent value array (space-separated by default). */
/** A scalar value or an authored adjacent-value array. Arrays are recursive so
 * separator-bearing List items can retain a nested space group, e.g. the left
 * side of modern `rgb(15 23 42 / .22)`. */
export type ValueSlot = ValueNode | readonly ValueSlot[];

/** A call argument is normally a value, but Less also permits a deferred typed
 *  mixin invocation passed to another mixin. */
export type CallValue = ValueSlot | MixinCall;

/**
 * ONE call argument — the SAME node whether the callee is a mixin or a
 * function. `.less` `.m(@a: 1)` and `.scss` `color.adjust($c, $lightness: -10%)`
 * are the same construct in two spellings, so they are the same shape here and
 * {@link FunctionCall} and {@link MixinCall} both carry `CallArg[]`.
 *
 * UNIFORM BY CONSTRUCTION. Every field is non-optional and every argument is
 * built by {@link callArg}, so a call-argument array realizes exactly ONE hidden
 * class. The conditional-spread spelling this replaced (`...(name ? {name} : {})`)
 * realized three maps on the hottest value node in the tree; `FunctionCall.modern`
 * and `MixinCall.content` are the precedent for present-and-empty over absent.
 */
export interface CallArg<V extends CallValue = CallValue> {
  /**
   * The argument's payload. ONE interface, parameterized only so a
   * {@link FunctionCall} argument (always a value) types more precisely than a
   * {@link MixinCall} argument (which may be a deferred typed mixin call). The
   * RUNTIME shape is identical either way — this is not a second node.
   */
  readonly value: V;

  /**
   * The AUTHORED keyword, or `undefined` for a positional argument.
   *
   * A keyword is a dialect variable name, which is never empty, so `undefined`
   * (positional) stays distinguishable from every name a caller can write. The
   * slot is LOSSLESS: nothing derives a name for a positional argument, and
   * nothing collapses an authored name into a position.
   */
  readonly name: string | undefined;

  /** `[spread]` Less `@args...` — `value` is a list variable to SPLAT into
   *  positional args at the call site before binding. */
  readonly spread: boolean;
}

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
 * A placeholder selector's canonical spelling — the CSS escape for a literal
 * backslash, i.e. TWO backslash characters followed by the name.
 *
 * A placeholder needs no node kind and no flag: its spelling IS its identity,
 * and that spelling was chosen so the selector is inert by construction.
 * `\\name` is a well-formed identifier (css-syntax-3 §4.3.7) whose value is
 * `\name`, and no element type is named `\name` (selectors-4 §5.1), so it can
 * never match. Output suppression exists to match dart-sass, not to make it
 * safe. A single `\` would escape the first letter instead — `\name` is just
 * the type selector `name`, which matches real elements.
 *
 * Declared here so the grammar reducers, the extend-target policy and the
 * serializer's branch filter all read ONE definition.
 */
export const PLACEHOLDER_SIGIL = '\\\\';

/** True if a simple/pseudo token is a placeholder (`%name` in SCSS, `\\name` in `.jess`). */
export function simpleSelectorIsPlaceholder(simple: SimpleToken): boolean {
  return simple.type === 'SimpleSelector'
    && simple.interp === null
    && typeof simple.text === 'string'
    && simple.text.startsWith(PLACEHOLDER_SIGIL)
    && simple.text.length > PLACEHOLDER_SIGIL.length;
}

/**
 * True if a COMPOSED selector-branch text contains a placeholder as one of its
 * segments — `\\ph`, `\\ph .c`, `.o > \\ph`.
 *
 * Placeholder-ness is a property of the BRANCH, not of the rule: dart-sass emits
 * `.a { … }` for `%ph, .a { … }`, keeping the sibling branch. That is why
 * `Ruleset.reference` could not carry this — it is a whole-rule flag, and one
 * additionally confined to an import boundary, whereas any extend anywhere may
 * reach a placeholder.
 *
 * The sigil is matched only at a segment BOUNDARY so an authored escape inside
 * an identifier (`.foo\\bar`) is not mistaken for one. Deliberately NOT matched
 * after `(`: inside `:is(\\ph, .a)` the placeholder is one alternative of a
 * compacted list, and dropping the whole branch there would take the visible
 * `.a` with it — that case is handled by per-branch hiding BEFORE compaction.
 * `indexOf` fast-rejects the overwhelmingly common backslash-free selector.
 */
export function branchTextIsPlaceholder(text: string): boolean {
  for (let at = text.indexOf(PLACEHOLDER_SIGIL); at !== -1; at = text.indexOf(PLACEHOLDER_SIGIL, at + 2)) {
    if (at === 0) {
      return true;
    }
    const before = text.charCodeAt(at - 1);
    // space, `>`, `+`, `~`, `,`
    if (before === 32 || before === 62 || before === 43 || before === 126 || before === 44) {
      return true;
    }
  }
  return false;
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

  /** Serializer-owned memo of the args-carry-interpolation flag (lazy). */
  _hasInterp?: boolean;
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

/**
 * True iff a structured pseudo needs frame-dependent resolution — either the
 * token itself is interpolated, or ANY member of its retained `args` is. The
 * argument is a `SelectorList` like any other, so an interpolated member is an
 * ordinary interpolated simple nested one level down; a gate that only read
 * `p.interp` reported `:not(a#{$x})` as static and sent it down the static
 * `pseudoCanonical` join, which drops the interpolated member entirely.
 */
export const pseudoHasInterp = (p: PseudoSelector): boolean => {
  if (p._hasInterp === undefined) {
    let has = p.interp !== null;
    if (!has && p.args !== null) {
      for (const branch of p.args.selectors) {
        if (selectorBranchHasInterp(branch)) {
          has = true;
          break;
        }
      }
    }
    p._hasInterp = has;
  }
  return p._hasInterp;
};

/** True iff one simple token needs frame-dependent interpolation resolution. */
export const simpleTokenHasInterp = (sim: SimpleToken): boolean =>
  sim.type === 'PseudoSelector' ? pseudoHasInterp(sim) : sim.interp !== null;

/** True iff any token needs frame-dependent interpolation resolution. */
export const compoundHasInterp = (c: CompoundSelector): boolean => {
  if (c._hasInterp === undefined) {
    let has = false;
    for (const sim of c.value) {
      if (simpleTokenHasInterp(sim)) {
        has = true;
        break;
      }
    }
    c._hasInterp = has;
  }
  return c._hasInterp;
};

/** True iff a leaf token's retained text or interpolation template carries `&`. */
const leafHasAmpersand = (sim: SimpleToken): boolean => {
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
  return false;
};

/**
 * True iff a structured pseudo carries a literal `&`, decided by WALKING `args`
 * rather than substring-scanning `pseudoCanonical`. Equivalent for a static
 * argument — the join is exactly the concatenation of the leaf texts, and a
 * pseudo NAME can never contain `&` — and correct for an interpolated one,
 * where the join drops the member and the `&` inside it with it. This is the
 * pseudo half of SEMANTIC-INVARIANTS incident **S5**: a structural fact decided
 * by a byte scan over serialized text.
 */
export const pseudoHasAmpersand = (p: PseudoSelector): boolean => {
  if (p.args === null) {
    return leafHasAmpersand(p);
  }
  for (const branch of p.args.selectors) {
    if (selectorBranchHasAmpersand(branch)) {
      return true;
    }
  }
  return false;
};

/** True iff any token carries a literal `&` (bare, fused, or in an interpolation template). */
export const compoundHasAmpersand = (c: CompoundSelector): boolean => {
  for (const sim of c.value) {
    if (sim.type === 'PseudoSelector' ? pseudoHasAmpersand(sim) : leafHasAmpersand(sim)) {
      return true;
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
 *
 * STATIC ONLY: an interpolated member has `text: null` and contributes `''` here,
 * so this join is correct only when {@link pseudoHasInterp} is false. Every EMIT
 * path gates on that flag and resolves the argument per frame instead; the
 * remaining callers are frame-free ANALYSIS (mixin-index keys, the `&` probe),
 * where an unresolvable interpolation contributing nothing is the existing,
 * symmetric behaviour of every other interpolated token.
 */
/**
 * The ONE spelling of the structured-pseudo argument join, over already-rendered
 * branches. Both the static path ({@link pseudoCanonical}) and the per-frame
 * resolving path in `serialize.ts` go through here, so the `, ` glue has a
 * single owner and the two cannot drift — the failure mode SEMANTIC-INVARIANTS
 * incident S3 is named for.
 */
export const pseudoJoin = (name: string, branches: readonly string[]): string =>
  `${name}(${branches.join(', ')})`;

export const pseudoCanonical = (p: PseudoSelector): string =>
  p.args !== null
    ? pseudoJoin(p.name, p.args.selectors.map(selectorBranchCanonical))
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
      ? pseudoHasAmpersand(term)
      : leafHasAmpersand(term);

export const selectorTermHasInterp = (term: SelectorTerm): boolean =>
  term.type === 'CompoundSelector' ? compoundHasInterp(term) : simpleTokenHasInterp(term);

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
/*
 * `scope`, not `lookup`: §12.3a counts this as the FIFTH private copy of the
 * same fact, sitting outside the reference family proper. It spells it the way
 * {@link Lookup} does, so "which binding store" has one name repo-wide.
 */
export type VariableWrite =
  | { readonly mode: 'declare' }
  | { readonly mode: 'if-absent' | 'reassign'; readonly scope: VariableLookup };

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

  /**
   * [scss:!optional] The author wrote `@extend %x !optional`, waiving the
   * "target selector was not found" error. Recorded LOSSLESSLY at parse time;
   * the engine does not act on it yet.
   *
   * The gap this names is the UNMARKED form, not this one: a miss is currently
   * silent for both spellings (a group whose target never matches simply never
   * fires — there is no post-fixpoint never-fired check and no target index to
   * hang one on), so `!optional` already behaves correctly and plain `@extend`
   * is too permissive against dart-sass, which errors. Storing the authored
   * fact now means that diagnostic lands as an engine change alone.
   */
  optional?: boolean;
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
 *
 * `content` is the block ASSIGNED to the call — `.jess` `$ > m(): @{ … }`, the
 * lowering target of Sass `@include m { … }`. It is not an argument: it does not
 * bind to a param, it binds the callee-visible variable `content`, which is what
 * the documented built-in `$content()` reads (`$content()` is an ordinary
 * `Reference` on a live `content` lookup, exactly like calling any other
 * variable-bound {@link AnonymousMixin}). `null` when the call assigns no block —
 * always PRESENT so every MixinCall keeps one hidden class.
 */
export interface MixinCall extends SpanSlots {
  readonly type: 'MixinCall';
  readonly name: string;
  readonly args: CallArg[];
  readonly path: MixinPathSegment[];
  readonly important: boolean;
  readonly content: AnonymousMixin | null;
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

/**
 * Jess `$while (<condition>) { … }` — the third control statement, alongside
 * `$if` and `$for`, and shaped like both: `$if`'s `GuardNode` condition over
 * `$for`'s statement body. SCSS `@while` lowers to it.
 *
 * It is a distinct node because it is a distinct `.jess` spelling (§12.0): a
 * `$for` iterates a KNOWN iterable decided once, and no `$for` spelling
 * re-evaluates a condition between iterations. Like `$if` and `$for`, a control
 * block is not a scope — body declarations publish into the containing frame,
 * which is exactly what lets the condition observe the counter the body writes.
 */
export interface While {
  readonly type: 'While';
  readonly guard: GuardNode;
  readonly rules: Statement[];
}

/**
 * A compile-time stylesheet dependency; plugins resolve its authored target.
 *
 * There are exactly TWO import shapes and the parser picks between them: a plain
 * CSS `@import` is an ordinary `AtRuleStatement`, and every compile-time import —
 * Less `@import` with options, SCSS `@use` / `@forward`, jess `@-import` /
 * `@-compose` — is a `StyleImport`. Nothing defers that choice to eval: its four
 * inputs (the option words, the at-keyword, an `as` alias, and the target's
 * authored spelling) are all syntactic.
 *
 * The option surface is a GENERIC carrier, not one boolean per dialect quirk:
 * `(inline)`, `(reference)`, `with (…)` and `show`/`hide` all land in `options`.
 */
export interface StyleImport extends SpanSlots {
  readonly type: 'StyleImport';

  /** The lowered at-keyword this import prints as (`@import`, `@-compose`, …). */
  readonly name: string;

  /** A quoted path, `url(…)`, or interpolated quoted template. */
  readonly target: Quoted | Url | Interpolation;

  /** Grammar-owned comma list from the parenthesized/`with` option clause. */
  readonly options: List | null;

  /** Grammar-owned `as …` clause, if the dialect admits a value-shaped one. */
  readonly alias: ValueNode | null;

  /*
   * There is deliberately NO postlude field. A media/layer/supports tail belongs
   * to the plain CSS `@import` form, which is an `AtRuleStatement` and carries it
   * in the prelude. Once the parser has decided an import is compile-time, a
   * trailing query is rejected AT PARSE TIME, so no `StyleImport` can ever hold
   * one and nothing downstream may act on one. This diverges deliberately from
   * Less 4.x, which accepts `@import "a.less" screen` and wraps the loaded rules
   * in `@media screen`.
   */

  readonly mode: 'compose' | 'import';
  readonly namespace: string | null;
  readonly forward: boolean;
}

/** Optional `StyleImport` facts; every dialect fills only the ones it spells. */
export interface StyleImportFields {
  options?: List | null;
  alias?: ValueNode | null;
  mode?: StyleImport['mode'];
  namespace?: string | null;
  forward?: boolean;
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
import type { AtRuleBlock, AtRuleStatement, OpaqueAtRuleBlock, Plugin } from './at-rule.js';

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
  | Plugin
  | OpaqueAtRuleBlock
  | Reference
  | For
  | If
  | While
  | StyleImport
  | ModuleImport

  /*
   * A bare value-position call in statement position (`e('/* … *\/');`): Less
   * evaluates it and emits its result bytes as a standalone line (unquote/escape
   * at document scope), so it is a legitimate statement, not just a value node.
   */
  | FunctionCall;

/* ------------------------------------------------------------ constructors */

export const keyword = (src: string): Keyword => ({ type: 'Keyword', src });

/** The `null` literal node — ONE frozen instance; the literal carries no fact
 *  beyond its own identity, so it never allocates. */
export const NULL_NODE: Null = { type: 'Null', src: 'null' };
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

/**
 * A space-run {@link Sequence}. Authored boundary runs are retained ONLY when one
 * carries a line break — the emitter's default join is a single space, so any
 * other run is an implied fact — and they are retained OUT OF BAND, in the same
 * `withValueLayout` side table a raw `ValueSlot[]` and a `List` already use.
 */
export const spaced = (parts: ValueNode[], separators?: readonly string[]): Sequence => {
  const node: Sequence = { type: 'Sequence', parts };
  return separators?.some(separator => /[\n\r]/u.test(separator)) ? withValueLayout(node, separators) : node;
};
export const list = (
  value: ValueSlot[],
  sep: List['sep'] = ','
): List => ({ type: 'List', value, sep });

export const simpleSelector = (text: string): SimpleSelector => ({ type: 'SimpleSelector', text, interp: null, _s: NO_SPAN, _e: NO_SPAN });

/** An `<ident-token>` code point — the continue set, which is all that matters at a join. */
const identCode = (code: number): boolean =>
  code === 0x2d /* - */ || code === 0x5f /* _ */ || code === 0x5c /* \ */
  || (code >= 0x30 && code <= 0x39)
  || (code >= 0x41 && code <= 0x5a)
  || (code >= 0x61 && code <= 0x7a)
  || code > 0x7f;

/**
 * `[`, name, operator, value, flag, `]` joined into one attribute selector.
 *
 * The parts carry no authored whitespace, so two adjacent `<ident-token>`s
 * would FUSE: `[data-x=y i]` emitting as `[data-x=yi]` is still valid CSS and
 * still parses, so nothing rejects it — but selectors-4 §6.3 makes the unquoted
 * value and the case-sensitivity flag two separate `<ident-token>`s, and the
 * fused spelling matches a DISJOINT set of elements. One space is emitted at
 * exactly the boundaries where omitting it would fuse and at no other, so a
 * quoted value (`"y"i`) and every delimiter-adjacent boundary keep their bytes.
 */
export const attributeSelector = (parts: readonly string[]): SimpleSelector => {
  let text = '';
  for (const part of parts) {
    if (
      text.length !== 0 && part.length !== 0
      && identCode(text.charCodeAt(text.length - 1))
      && identCode(part.charCodeAt(0))
    ) {
      text += ' ';
    }
    text += part;
  }
  return simpleSelector(text);
};

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
export const whileNode = (guard: GuardNode, rules: Statement[]): While => ({ type: 'While', guard, rules });
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

/** A Less property accessor `$name` — {@link Lookup} of kind `prop`. */
export const propertyReference = (name: string, raw: string = `$${name}`): Lookup =>
  ({ type: 'Lookup', scope: 'scoped', kind: 'prop', name, raw, _s: NO_SPAN, _e: NO_SPAN });

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

/** A bound-variable reference — {@link Lookup} of kind `var`. `name` may be a
 *  NODE, which is how `@@indirect` is spelled now that it needs no own kind. */
export const variableReference = (name: string | ValueNode, lookup: VariableLookup, raw?: string): Lookup =>
  ({ type: 'Lookup', scope: lookup, kind: 'var', name, raw: raw ?? (typeof name === 'string' ? `@${name}` : ''), _s: NO_SPAN, _e: NO_SPAN });

/** The current declaration-entry surface — {@link Lookup} of kind `entry`. */
export const declarationReference = (raw: string = '$'): Lookup =>
  ({ type: 'Lookup', scope: 'scoped', kind: 'entry', name: '', raw, _s: NO_SPAN, _e: NO_SPAN });

/** One lookup step in a {@link Reference} chain (dot or bracket — one node). */
export const lookupStep = (kind: LookupKind, name: string | ValueNode | number, indexBase?: 0 | 1): LookupStep =>
  indexBase === undefined ? { type: 'LookupStep', kind, name } : { type: 'LookupStep', kind, name, indexBase };
export const important = (value: ValueSlot): Important => ({ type: 'Important', value });

/**
 * The CSS base answer to {@link Operation.mathOutsideParens}: every operator but
 * `/` is arithmetic wherever it appears, while `/` is also a CSS SEPARATOR
 * (`font: 12px/1.5`, `rgb(0 0 0 / 50%)`) and so needs a math context to be read
 * as division.
 *
 * This is the answer for `.css`, `.jess` and `.scss` — none of which has a
 * user-settable math policy — and it is measured, not assumed: dart-sass
 * 1.101.0 emits `(4px / 2)` as `2px` and `4px / 2` as `4px/2`.
 *
 * Only `.less` differs, because only Less has a `math:` option; its grammar
 * resolves that option per operation and does NOT call this (§12.6b, ledger P1).
 */
export const cssBaseMathOutsideParens = (operator: string): boolean => operator !== '/';

/**
 * The ONE construction site for an {@link Operation}.
 *
 * `mathOutsideParens` has NO default, deliberately. Any default would equal the
 * correct answer under the default math mode, so an omitted argument would be
 * invisible in testing and wrong under every other mode — the def-field
 * default-collapse trap. Every caller states its answer: `.css`/`.jess`/`.scss`
 * through {@link cssBaseMathOutsideParens}, `.less` through its own
 * mode-resolving helper.
 */
export const operation = (
  operator: string,
  left: ValueNode,
  right: ValueNode,
  inMathFunction: boolean,
  mathOutsideParens: boolean
): Operation =>
  ({ type: 'Operation', operator, left, right, inMathFunction, mathOutsideParens, _s: NO_SPAN, _e: NO_SPAN });

/**
 * The ONE construction site for a {@link CallArg}. Every field is written on
 * every argument, in the same order, so the whole tree's call arguments share a
 * single hidden class — a caller that "omits" a name passes `undefined`, it does
 * not omit the property.
 */
export const callArg = <V extends CallValue>(value: V, name?: string, spread = false): CallArg<V> =>
  ({ value, name, spread });

/** Normalize a mixed authored-argument array to {@link CallArg}s. A bare value
 *  slot (node OR nested array) is positional; an already-built `CallArg` passes
 *  through. Shared by {@link funcCall} and {@link mixinCall} so the two call
 *  families cannot drift into two shapes. */
const isCallArg = <V extends CallValue>(a: V | CallArg<V>): a is CallArg<V> =>
  !Array.isArray(a) && 'value' in a && !('type' in a);

const toCallArgs = <V extends CallValue>(args: readonly (V | CallArg<V>)[]): Array<CallArg<V>> => {
  const out = new Array<CallArg<V>>(args.length);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    out[i] = isCallArg(a) ? a : callArg(a);
  }
  return out;
};

export const funcCall = (
  name: string,
  args: readonly (ValueSlot | CallArg<ValueSlot>)[] = [],
  modern = false
): FunctionCall => {
  const boxed = toCallArgs(args);

  /* The authored-separator side table is keyed on the ARRAY OBJECT a grammar
   * built. Boxing the arguments produces a new array, so a layout recorded
   * BEFORE the call node existed has to travel with it — otherwise a grammar
   * that spells `funcCall(name, withValueLayout(args, seps))` silently loses
   * every authored comma, and the loss is invisible until the bytes differ. */
  const layout = valueLayoutOf(args);
  if (layout !== undefined) {
    withValueLayout(boxed, layout);
  }
  return { type: 'FunctionCall', name, args: boxed, modern, _s: NO_SPAN, _e: NO_SPAN };
};
export const block = (value: ValueSlot, delimiter: Block['delimiter'] = 'paren', escaped = false): Block =>
  escaped ? { type: 'Block', value, delimiter, escaped: true, _s: NO_SPAN, _e: NO_SPAN } : { type: 'Block', value, delimiter, _s: NO_SPAN, _e: NO_SPAN };

/** The `$( … )` computation boundary — see {@link Expression}. */
export const expression = (value: ValueSlot): Expression =>
  ({ type: 'Expression', value, _s: NO_SPAN, _e: NO_SPAN });
export const condition = (guard: GuardNode, src: string): Condition => ({ type: 'Condition', guard, src });
export const ifValue = (branches: readonly [IfValueBranch, ...IfValueBranch[]]): IfValue =>
  ({ type: 'IfValue', branches });
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

/** [guards] Args may be bare value nodes (positional) or {@link CallArg}s.
 *  `content` is the assigned block (`$ > m(): @{ … }`), not an argument. */
export const mixinCall = (
  name: string,
  args: readonly (CallValue | CallArg)[] = [],
  content: AnonymousMixin | null = null
): MixinCall => ({
  type: 'MixinCall',
  name,
  args: toCallArgs(args),
  path: [],
  important: false,
  content,
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

/**
 * The AUTHORED spelling of an import target: the bytes between the quotes as the
 * author typed them, with every interpolation hole read as empty. Nothing is
 * resolved — `@import "@{name}.css"` answers `.css` for the only question asked
 * of it, because the extension is authored plainly and only the stem substitutes.
 */
export const importTargetSpelling = (target: Quoted | Url | Interpolation): string => {
  if (target.type === 'Quoted') {
    return target.value;
  }
  const inner = target.type === 'Url' ? target.value : target;
  if (inner.type === 'Quoted') {
    return inner.value;
  }
  if (inner.type === 'Any') {
    return inner.src;
  }
  if (inner.type !== 'Interpolation') {
    return '';
  }
  let bytes = '';
  for (const part of inner.parts) {
    if ('lit' in part) {
      bytes += part.lit;
    }
  }
  const quote = bytes[0];
  if (quote === '"' || quote === '\'') {
    bytes = bytes.slice(1);
    if (bytes.endsWith(quote)) {
      bytes = bytes.slice(0, -1);
    }
  }
  return bytes;
};

/** The lowercase option words of an import's option clause, in authored order. */
export const importOptionWords = (options: List | null): string[] => {
  if (options === null) {
    return [];
  }
  const words: string[] = [];
  for (const option of options.value) {
    if (option !== null && typeof option === 'object' && 'type' in option
      && (option.type === 'Any' || option.type === 'Keyword')) {
      words.push(option.src.trim().toLowerCase());
    }
  }
  return words;
};

/**
 * A CSS-terminal target: a `.css` file, query/fragment allowed.
 *
 * A URL-scheme target is deliberately NOT terminal here. Whether an external
 * identifier resolves is a plugin's answer at load time, not a syntactic one:
 * a claimed `https://…` import loads through the dispatcher, and an unclaimed
 * one is declined and printed. Only the authored `.css` extension is a fact the
 * parser can read.
 */
const CSS_TARGET = /\.css(?:[?#].*)?$/iu;

/**
 * WHICH of the two import nodes an `@import` becomes — decided from SYNTAX, by
 * the grammar, never deferred to eval. `true` ⇒ build a {@link StyleImport};
 * `false` ⇒ it is a plain CSS `@import` and belongs in an `AtRuleStatement`.
 *
 * All four inputs are authored facts: the option words, the at-keyword, an `as`
 * alias, and the target's spelling. `(inline)` answers `true` even though it
 * loads bytes rather than a document — raw-byte IO is still compile-time work.
 *
 * `(optional)` is deliberately NOT terminal: it selects what happens when the
 * load FAILS, so an optional import must still be attempted and resolve normally
 * when the file exists.
 */
export const importIsCompileTime = (
  name: string,
  target: Quoted | Url | Interpolation,
  options: List | null = null,
  alias: ValueNode | null = null
): boolean => {
  const words = importOptionWords(options);
  if (words.includes('inline')) {
    return true;
  }
  if (words.includes('css') || alias !== null) {
    return false;
  }
  if (words.includes('less') || name.toLowerCase() === '@-import') {
    return true;
  }
  return !CSS_TARGET.test(importTargetSpelling(target));
};

export const styleImport = (
  name: string,
  target: Quoted | Url | Interpolation,
  fields: StyleImportFields = {}
): StyleImport => ({
  type: 'StyleImport',
  name,
  target,
  options: fields.options ?? null,
  alias: fields.alias ?? null,
  mode: fields.mode ?? 'compose',
  namespace: fields.namespace ?? null,
  forward: fields.forward ?? false,
  _s: NO_SPAN,
  _e: NO_SPAN
});
export const moduleImport = (
  path: Quoted,
  mode: ModuleImport['mode'],
  namespace: string | null = null,
  imports: readonly ModuleImportSpecifier[] = [],
  defaultImport: string | null = null
): ModuleImport => ({ type: 'ModuleImport', path, mode, defaultImport, namespace, imports });
export const stylesheet = (rules: Statement[]): Stylesheet => ({ type: 'Stylesheet', rules, _s: NO_SPAN, _e: NO_SPAN, _trivia: undefined });
