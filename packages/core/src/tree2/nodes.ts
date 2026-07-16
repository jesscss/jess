/**
 * Clean-room tree2 concrete node types + programmatic constructors.
 *
 * Written from scratch to reproduce the exact output BYTES the legacy renderer
 * emits for each shape — NOT to mirror the legacy serialization *method*.
 *
 * Selector model (rung 3+): a selector is a `SelectorList` of `Complex`
 * selectors; a `Complex` is a head `Compound` plus `(combinator, compound)`
 * tail segments; a `Compound` is a run of `Simple` tokens concatenated with no
 * separator (`.a` + `.b` => `.a.b`). The `&` parent-reference is just a
 * `Simple` whose text is `'&'`. Canonical selector text is computed once and
 * cached — composition (nesting) then works on these cached strings, with NO
 * per-placement node cloning / `inherit` analog.
 *
 * Trivia (comments) is carried STRUCTURALLY as a body child, so byte-identity
 * holds with zero source-position tracking.
 */

import { Combinator, Kind, Node } from './node.js';
import type { GuardNode } from './guard.js'; // [guards]
import type { CallArg } from './mixin-dispatch.js'; // [guards]

/* ------------------------------------------------------------------ values */

/** A bare identifier / keyword leaf, e.g. `red`, `solid`. */
export class Word extends Node {
  readonly kind = Kind.Word as const;
  constructor(readonly text: string) {
    super();
  }
}

/** A numeric dimension leaf, e.g. `0px`, `10px`. */
export class Dimension extends Node {
  readonly kind = Kind.Dimension as const;
  constructor(
    readonly value: number,
    readonly unit: string = '',
  ) {
    super();
  }
}

/** A space-separated list of value parts, e.g. `1px solid black`. */
export class SpacedValue extends Node {
  readonly kind = Kind.SpacedValue as const;
  constructor(readonly parts: ValueNode[]) {
    super();
  }
}

/** A reference to a mixin parameter / bound variable, e.g. `@c`. */
export class VarRef extends Node {
  readonly kind = Kind.VarRef as const;
  constructor(readonly name: string) {
    super();
  }
}

/**
 * A value template: literal text and `@var` references concatenated with NO
 * separator (the literal parts already carry their own spacing). This is how a
 * static value that embeds variable references is represented — e.g.
 * `1px solid @c` => Concat[Word('1px solid '), VarRef('c')]. Reference
 * substitution only (this rung): no arithmetic, no function evaluation.
 */
export class Concat extends Node {
  readonly kind = Kind.Concat as const;
  constructor(readonly parts: ValueNode[]) {
    super();
  }
}

/**
 * A binary value operation, e.g. `#aaa * 3` or `@a + @b`. tree2 owns the
 * STRUCTURE (operator + operand value nodes); the MATH is delegated to the
 * injected value service. Operands are themselves value nodes so nested
 * operations / variable refs fold bottom-up (each sub-operation is computed to
 * bytes before the outer one runs — precedence is carried by the tree shape).
 */
export class Operation extends Node {
  readonly kind = Kind.Operation as const;
  constructor(
    readonly operator: string,
    readonly left: ValueNode,
    readonly right: ValueNode,
  ) {
    super();
  }
}

/**
 * A function call value, e.g. `lighten(blue, 10%)`. [R2] tree2 owns the STRUCTURE
 * (name + a MODELED argument list) so the evaluator can bind TYPED params. Each
 * arg is an independent value node (folded bottom-up to a typed value). `modern`
 * marks CSS Color-4 modern syntax (`rgb(0 128 255 / 50%)`) — space/slash
 * separators — vs the legacy comma form, so the evaluator preserves the output
 * spelling.
 */
export class FunctionCall extends Node {
  readonly kind = Kind.FunctionCall as const;
  constructor(
    readonly name: string,
    readonly args: ValueNode[],
    readonly modern: boolean = false,
  ) {
    super();
  }
}

/** A parenthesized value, e.g. `(#aaa * 3)`. Transparent to computed bytes. */
export class Paren extends Node {
  readonly kind = Kind.Paren as const;
  constructor(readonly inner: ValueNode) {
    super();
  }
}

export type ValueNode =
  | Word
  | Dimension
  | SpacedValue
  | VarRef
  | Concat
  | Operation
  | FunctionCall
  | Paren;

/* ---------------------------------------------------------------- selectors */

function renderCombinator(comb: Combinator): string {
  // Descendant is a single space; the rest are surrounded by spaces.
  return comb === ' ' ? ' ' : ` ${comb} `;
}

/** A single simple-selector token, e.g. `.a`, `:hover`, `&`. */
export class Simple extends Node {
  readonly kind = Kind.Simple as const;
  constructor(readonly text: string) {
    super();
  }
}

/** A run of simple tokens with no separator, e.g. `.a.b`, `&:hover`. */
export class Compound extends Node {
  readonly kind = Kind.Compound as const;
  private _canon: string | undefined;
  constructor(readonly simples: Simple[]) {
    super();
  }
  canonical(): string {
    if (this._canon === undefined) {
      let s = '';
      for (const sim of this.simples) s += sim.text;
      this._canon = s;
    }
    return this._canon;
  }
  get hasAmpersand(): boolean {
    for (const sim of this.simples) if (sim.text === '&') return true;
    return false;
  }
}

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
export class Complex extends Node {
  readonly kind = Kind.Complex as const;
  private _canon: string | undefined;
  private _hasAmp: boolean | undefined;
  constructor(
    readonly head: Compound,
    readonly tail: ComplexSegment[] = [],
    readonly leadingComb?: Combinator,
  ) {
    super();
  }
  canonical(): string {
    if (this._canon === undefined) {
      let s = this.head.canonical();
      // A leading combinator (e.g. `> .b`) is rendered surrounded on the right
      // only: `renderCombinator` yields ` > `; the head has no left context, so
      // trim the leading space to emit `> .b`.
      if (this.leadingComb !== undefined && this.leadingComb !== ' ') {
        s = renderCombinator(this.leadingComb).trimStart() + s;
      }
      for (const seg of this.tail) {
        s += renderCombinator(seg.comb) + seg.compound.canonical();
      }
      this._canon = s;
    }
    return this._canon;
  }
  get hasAmpersand(): boolean {
    if (this._hasAmp === undefined) {
      let has = this.head.hasAmpersand;
      if (!has) {
        for (const seg of this.tail) {
          if (seg.compound.hasAmpersand) {
            has = true;
            break;
          }
        }
      }
      this._hasAmp = has;
    }
    return this._hasAmp;
  }
}

/** A comma-separated list of complex selectors, e.g. `.a, .b`. */
export class SelectorList extends Node {
  readonly kind = Kind.SelectorList as const;
  constructor(readonly selectors: Complex[]) {
    super();
  }
}

/* -------------------------------------------------------------- statements */

/** A `name: value;` declaration. */
export class Declaration extends Node {
  readonly kind = Kind.Declaration as const;
  constructor(
    readonly name: string,
    readonly value: ValueNode,
  ) {
    super();
  }
}

/** A `@name: value;` variable declaration. Emits nothing; lives in scope. */
export class VarDeclaration extends Node {
  readonly kind = Kind.VarDeclaration as const;
  constructor(
    readonly name: string,
    readonly value: ValueNode,
  ) {
    super();
  }
}

/** A comment carried structurally in source order (block or line text as-is). */
export class Comment extends Node {
  readonly kind = Kind.Comment as const;
  constructor(readonly text: string) {
    super();
  }
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
export class Rule extends Node {
  readonly kind = Kind.Rule as const;
  constructor(
    readonly selector: SelectorList,
    readonly body: Statement[],
    readonly extendInstructions?: ExtendInstruction[],
  ) {
    super();
  }
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
export class MixinDef extends Node {
  readonly kind = Kind.MixinDef as const;
  constructor(
    readonly name: string,
    readonly params: Param[],
    readonly body: Statement[],
    readonly guard?: GuardNode, // [guards]
  ) {
    super();
  }
}

/** A mixin call. Args bind to the def's params (positional or named). [guards] */
export class MixinCall extends Node {
  readonly kind = Kind.MixinCall as const;
  constructor(
    readonly name: string,
    readonly args: CallArg[],
  ) {
    super();
  }
}

/** The document root: an ordered list of top-level statements. */
export class Root extends Node {
  readonly kind = Kind.Root as const;
  constructor(readonly children: Statement[]) {
    super();
  }
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
  | AtRuleStatement;

/* ------------------------------------------------------------ constructors */

export const word = (text: string): Word => new Word(text);
export const dim = (value: number, unit = ''): Dimension => new Dimension(value, unit);
export const spaced = (parts: ValueNode[]): SpacedValue => new SpacedValue(parts);

export const simple = (text: string): Simple => new Simple(text);
/** `compound('.a', '.b')` => `.a.b`. */
export const compound = (...texts: string[]): Compound => new Compound(texts.map(simple));
/** `complex([{ compound: compound('.a') }, { comb: '>', compound: compound('.b') }])` => `.a > .b`. */
export const complex = (
  segments: Array<{ comb?: Combinator; compound: Compound }>,
  leadingComb?: Combinator,
): Complex => {
  const [head, ...tail] = segments;
  if (!head) throw new Error('complex() needs at least one segment');
  return new Complex(
    head.compound,
    tail.map((s) => ({ comb: s.comb ?? ' ', compound: s.compound })),
    leadingComb,
  );
};
export const selist = (...selectors: Complex[]): SelectorList => new SelectorList(selectors);

export const decl = (name: string, value: ValueNode): Declaration => new Declaration(name, value);
export const comment = (text: string): Comment => new Comment(text);
export const varRef = (name: string): VarRef => new VarRef(name);
export const concat = (parts: ValueNode[]): Concat => new Concat(parts);
export const operation = (operator: string, left: ValueNode, right: ValueNode): Operation =>
  new Operation(operator, left, right);
export const funcCall = (name: string, args: ValueNode[], modern = false): FunctionCall =>
  new FunctionCall(name, args, modern);
export const paren = (inner: ValueNode): Paren => new Paren(inner);
export const varDecl = (name: string, value: ValueNode): VarDeclaration =>
  new VarDeclaration(name, value);
export const mixinDef = (
  name: string,
  params: Param[],
  body: Statement[],
  guard?: GuardNode, // [guards]
): MixinDef => new MixinDef(name, params, body, guard);
/** [guards] Args may be bare value nodes (positional) or `{ value, name? }`. */
export const mixinCall = (name: string, args: Array<ValueNode | CallArg> = []): MixinCall =>
  new MixinCall(
    name,
    args.map((a) => (a instanceof Node ? { value: a } : a)),
  );

/** A single simple-string complex selector, e.g. `sel('.test')`. */
export const sel = (text: string): Complex => complex([{ compound: compound(text) }]);

/** `rule('.test', [...])`, `rule(sel('.a > .b'), ...)`, or `rule(selist(...), ...)`. */
export const rule = (selector: string | Complex | SelectorList, body: Statement[]): Rule => {
  const list =
    typeof selector === 'string'
      ? selist(sel(selector))
      : selector.kind === Kind.SelectorList
        ? selector
        : selist(selector);
  return new Rule(list, body);
};
export const root = (children: Statement[]): Root => new Root(children);
