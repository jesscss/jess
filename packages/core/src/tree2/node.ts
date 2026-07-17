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
  SelectorList = 4,
  Complex = 5,
  Compound = 6,
  Simple = 7,
  Word = 8,
  Dimension = 9,
  SpacedValue = 10,
  VarRef = 11,
  MixinDef = 12,
  MixinCall = 13,
  VarDeclaration = 14,
  Concat = 15,
  Operation = 16,
  FunctionCall = 17,
  Paren = 18,
  // [atrule] block-bearing at-rule (`@media {…}`) + statement at-rule (`@charset …;`)
  AtRuleBlock = 19,
  AtRuleStatement = 20,
  // [R4] interpolation template (`@{var}` / `~"…@{x}…"`) resolving to bytes.
  Interp = 21,
  // [R4] indirect variable (`@@name`): a variable whose NAME comes from another.
  VarIndirect = 22,
  // [R4] detached ruleset value (`@rs: { … }`), callable to splice its body.
  DetachedRuleset = 23,
  // [R4] map / namespace accessor value (`@p[text]`, `#ns[$@prop]`).
  MapAccessor = 24,
  // [R4] a call of a detached-ruleset-valued variable (`@ruleset();`).
  DetachedCall = 25,
  // [import:inline] verbatim raw bytes spliced by `@import (inline)` — emitted
  // exactly as read from the target file, never parsed or reformatted.
  RawInline = 26,
}

/** Combinator between two compounds in a complex selector. */
export type Combinator = ' ' | '>' | '+' | '~';

/** Render a combinator: descendant is a single space; the rest are surrounded by spaces. */
export function renderCombinator(comb: Combinator): string {
  return comb === ' ' ? ' ' : ` ${comb} `;
}

/** Base of every clean-room tree2 node. Owns nothing but its tag. */
export abstract class Node {
  abstract readonly kind: Kind;
}
