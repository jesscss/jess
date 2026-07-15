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

import { Combinator, Kind, Tree2Node } from './node.js';

/* ------------------------------------------------------------------ values */

/** A bare identifier / keyword leaf, e.g. `red`, `solid`. */
export class Word extends Tree2Node {
  readonly kind = Kind.Word as const;
  constructor(readonly text: string) {
    super();
  }
}

/** A numeric dimension leaf, e.g. `0px`, `10px`. */
export class Dimension extends Tree2Node {
  readonly kind = Kind.Dimension as const;
  constructor(
    readonly value: number,
    readonly unit: string = '',
  ) {
    super();
  }
}

/** A space-separated list of value parts, e.g. `1px solid black`. */
export class SpacedValue extends Tree2Node {
  readonly kind = Kind.SpacedValue as const;
  constructor(readonly parts: ValueNode[]) {
    super();
  }
}

/** A reference to a mixin parameter / bound variable, e.g. `@c`. */
export class VarRef extends Tree2Node {
  readonly kind = Kind.VarRef as const;
  constructor(readonly name: string) {
    super();
  }
}

export type ValueNode = Word | Dimension | SpacedValue | VarRef;

/* ---------------------------------------------------------------- selectors */

function renderCombinator(comb: Combinator): string {
  // Descendant is a single space; the rest are surrounded by spaces.
  return comb === ' ' ? ' ' : ` ${comb} `;
}

/** A single simple-selector token, e.g. `.a`, `:hover`, `&`. */
export class Simple extends Tree2Node {
  readonly kind = Kind.Simple as const;
  constructor(readonly text: string) {
    super();
  }
}

/** A run of simple tokens with no separator, e.g. `.a.b`, `&:hover`. */
export class Compound extends Tree2Node {
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

/** A head compound plus combinator-joined tail compounds. */
export class Complex extends Tree2Node {
  readonly kind = Kind.Complex as const;
  private _canon: string | undefined;
  private _hasAmp: boolean | undefined;
  constructor(
    readonly head: Compound,
    readonly tail: ComplexSegment[] = [],
  ) {
    super();
  }
  canonical(): string {
    if (this._canon === undefined) {
      let s = this.head.canonical();
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
export class SelectorList extends Tree2Node {
  readonly kind = Kind.SelectorList as const;
  constructor(readonly selectors: Complex[]) {
    super();
  }
}

/* -------------------------------------------------------------- statements */

/** A `name: value;` declaration. */
export class Declaration extends Tree2Node {
  readonly kind = Kind.Declaration as const;
  constructor(
    readonly name: string,
    readonly value: ValueNode,
  ) {
    super();
  }
}

/** A comment carried structurally in source order (block or line text as-is). */
export class Comment extends Tree2Node {
  readonly kind = Kind.Comment as const;
  constructor(readonly text: string) {
    super();
  }
}

/** A `selector { ...body }` rule; body may nest further rules. */
export class Rule extends Tree2Node {
  readonly kind = Kind.Rule as const;
  constructor(
    readonly selector: SelectorList,
    readonly body: Statement[],
  ) {
    super();
  }
}

/** A mixin parameter: a name and an optional default value. */
export interface Param {
  name: string;
  default?: ValueNode;
}

/**
 * A mixin definition. Its `body` is the CANONICAL body, stored ONCE — every
 * call reads it through an overlay (bindings + parent-selector context) and
 * NEVER clones it.
 */
export class MixinDef extends Tree2Node {
  readonly kind = Kind.MixinDef as const;
  constructor(
    readonly name: string,
    readonly params: Param[],
    readonly body: Statement[],
  ) {
    super();
  }
}

/** A mixin call. Args bind positionally to the def's params. */
export class MixinCall extends Tree2Node {
  readonly kind = Kind.MixinCall as const;
  constructor(
    readonly name: string,
    readonly args: ValueNode[],
  ) {
    super();
  }
}

/** The document root: an ordered list of top-level statements. */
export class Root extends Tree2Node {
  readonly kind = Kind.Root as const;
  constructor(readonly children: Statement[]) {
    super();
  }
}

export type Statement = Rule | Declaration | Comment | MixinDef | MixinCall;

/* ------------------------------------------------------------ constructors */

export const word = (text: string): Word => new Word(text);
export const dim = (value: number, unit = ''): Dimension => new Dimension(value, unit);
export const spaced = (parts: ValueNode[]): SpacedValue => new SpacedValue(parts);

export const simple = (text: string): Simple => new Simple(text);
/** `compound('.a', '.b')` => `.a.b`. */
export const compound = (...texts: string[]): Compound => new Compound(texts.map(simple));
/** `complex([{ compound: compound('.a') }, { comb: '>', compound: compound('.b') }])` => `.a > .b`. */
export const complex = (segments: Array<{ comb?: Combinator; compound: Compound }>): Complex => {
  const [head, ...tail] = segments;
  if (!head) throw new Error('complex() needs at least one segment');
  return new Complex(
    head.compound,
    tail.map((s) => ({ comb: s.comb ?? ' ', compound: s.compound })),
  );
};
export const selist = (...selectors: Complex[]): SelectorList => new SelectorList(selectors);

export const decl = (name: string, value: ValueNode): Declaration => new Declaration(name, value);
export const comment = (text: string): Comment => new Comment(text);
export const varRef = (name: string): VarRef => new VarRef(name);
export const mixinDef = (name: string, params: Param[], body: Statement[]): MixinDef =>
  new MixinDef(name, params, body);
export const mixinCall = (name: string, args: ValueNode[] = []): MixinCall => new MixinCall(name, args);

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
