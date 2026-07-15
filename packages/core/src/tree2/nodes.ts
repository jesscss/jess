/**
 * Clean-room tree2 concrete node types + programmatic constructors.
 *
 * These are written from scratch to reproduce the exact output BYTES that the
 * legacy renderer emits for each shape — NOT to mirror the legacy serialization
 * *method*. Trivia (comments) is carried STRUCTURALLY as a body child, so
 * byte-identity (a comment in the right place) holds with zero source-position
 * tracking.
 */

import { Kind, Tree2Node } from './node.js';

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

export type ValueNode = Word | Dimension | SpacedValue;

/* -------------------------------------------------------------- statements */

/** A selector head. For the bottom rungs this is a single literal string. */
export class Selector extends Tree2Node {
  readonly kind = Kind.Selector as const;
  constructor(readonly text: string) {
    super();
  }
}

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

/** A `selector { ...body }` rule. */
export class Rule extends Tree2Node {
  readonly kind = Kind.Rule as const;
  constructor(
    readonly selector: Selector,
    readonly body: Statement[],
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

export type Statement = Rule | Declaration | Comment;

/* ------------------------------------------------------------ constructors */

export const word = (text: string): Word => new Word(text);
export const dim = (value: number, unit = ''): Dimension => new Dimension(value, unit);
export const spaced = (parts: ValueNode[]): SpacedValue => new SpacedValue(parts);
export const selector = (text: string): Selector => new Selector(text);
export const decl = (name: string, value: ValueNode): Declaration => new Declaration(name, value);
export const comment = (text: string): Comment => new Comment(text);
export const rule = (sel: string | Selector, body: Statement[]): Rule =>
  new Rule(typeof sel === 'string' ? new Selector(sel) : sel, body);
export const root = (children: Statement[]): Root => new Root(children);
