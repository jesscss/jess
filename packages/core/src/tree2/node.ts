/**
 * Clean-room tree2 base node abstraction.
 *
 * HARD MODULE BOUNDARY: nothing in `tree2/` may import from the legacy tree
 * directory. This file defines tree2's OWN base node from scratch — it does NOT
 * extend the legacy `Node`. The only things allowed to cross the boundary are neutral
 * context/config objects, and this scaffold does not need any.
 *
 * The representation is a lean tagged node: every node carries a numeric
 * `kind` tag so the serializer can dispatch with a `switch` instead of virtual
 * calls. This keeps the door open to a later struct-of-arrays packing without
 * committing to it now — the scaffold stays a plain object tree so the harness
 * can grow rung by rung.
 */

/** Numeric discriminant for every tree2 node. */
export enum Kind {
  Root = 0,
  Rule = 1,
  Declaration = 2,
  Comment = 3,
  Selector = 4,
  Word = 5,
  Dimension = 6,
  SpacedValue = 7,
}

/** Base of every clean-room tree2 node. Owns nothing but its tag. */
export abstract class Tree2Node {
  abstract readonly kind: Kind;
}
