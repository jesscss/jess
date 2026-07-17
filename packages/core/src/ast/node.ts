/**
 * Clean-room tree2 base node abstraction.
 *
 * HARD MODULE BOUNDARY: nothing in `tree2/` may import from the legacy tree
 * directory. This file defines tree2's OWN node vocabulary from scratch — it does
 * NOT extend the legacy `Node`. The only things allowed to cross the boundary are
 * neutral context/config objects, and this scaffold does not need any.
 *
 * The representation is plain-data: every node is a plain object carrying a
 * PascalCase string `type` discriminant (Less-matching, e.g. `type: 'Dimension'`),
 * so the serializer dispatches with a `switch (node.type)`. `Node` is the exported
 * NAME — a discriminated UNION of the plain-data member interfaces, not a base
 * class. Construction goes through the free-function factories in `nodes.ts` /
 * `at-rule.ts`; there is no `new`.
 */

import type {
  Root,
  Rule,
  Declaration,
  Comment,
  SelectorList,
  Complex,
  Compound,
  Simple,
  Word,
  Dimension,
  SpacedValue,
  VarRef,
  MixinDef,
  MixinCall,
  VarDeclaration,
  Sequence,
  Operation,
  FunctionCall,
  Paren,
  Interp,
  VarIndirect,
  DetachedRuleset,
  MapAccessor,
  DetachedCall,
  For,
  RawInline,
  StyleImport,
} from './nodes.js';
import type { AtRuleBlock, AtRuleStatement } from './at-rule.js';

/** Every tree2 node's PascalCase `type` discriminant (Less-matching). */
export type NodeType =
  | 'Root' | 'Rule' | 'Declaration' | 'Comment' | 'SelectorList'
  | 'Complex' | 'Compound' | 'Simple' | 'Word' | 'Dimension'
  | 'SpacedValue' | 'VarRef' | 'MixinDef' | 'MixinCall' | 'VarDeclaration'
  | 'Sequence' | 'Operation' | 'FunctionCall' | 'Paren'
  | 'AtRuleBlock' | 'AtRuleStatement' | 'Interp' | 'VarIndirect'
  | 'DetachedRuleset' | 'MapAccessor' | 'DetachedCall' | 'For' | 'RawInline'
  | 'StyleImport';

/** Combinator between two compounds in a complex selector. */
export type Combinator = ' ' | '>' | '+' | '~';

/** Render a combinator: descendant is a single space; the rest are surrounded by spaces. */
export function renderCombinator(comb: Combinator): string {
  return comb === ' ' ? ' ' : ` ${comb} `;
}

/**
 * The tree2 node union. `Node` is the exported NAME — a discriminated union of
 * the plain-data member interfaces (no base class, no `instanceof`). Narrow with
 * `node.type === '…'` or the {@link isNode} value predicate.
 */
export type Node =
  | Root | Rule | Declaration | Comment | SelectorList | Complex | Compound
  | Simple | Word | Dimension | SpacedValue | VarRef | MixinDef | MixinCall
  | VarDeclaration | Sequence | Operation | FunctionCall | Paren
  | AtRuleBlock | AtRuleStatement | Interp | VarIndirect | DetachedRuleset
  | MapAccessor | DetachedCall | For | RawInline | StyleImport;

/**
 * The frozen set of the structural `type` strings — the membership basis for
 * {@link isNode}. A bare `'type' in x` is NOT a sound node test: the value domain
 * (`ValueObj`) now also carries a PascalCase `type` (`'Dimension'`/`'Color'`/…),
 * so a property test would misclassify an eval RESULT as an AST node. Membership
 * in this AST set neutralizes every collision except the shared `Dimension`
 * string, which is neutralized in turn by the lane invariant (a value-domain
 * `ValueObj` never enters the AST-build lane; never form a `Node | ValueObj`
 * union — disambiguate on a structural field like `'bytes' in v` if ever needed).
 */
export const AST_NODE_TYPES: ReadonlySet<string> = new Set<NodeType>([
  'Root', 'Rule', 'Declaration', 'Comment', 'SelectorList',
  'Complex', 'Compound', 'Simple', 'Word', 'Dimension',
  'SpacedValue', 'VarRef', 'MixinDef', 'MixinCall', 'VarDeclaration',
  'Sequence', 'Operation', 'FunctionCall', 'Paren',
  'AtRuleBlock', 'AtRuleStatement', 'Interp', 'VarIndirect',
  'DetachedRuleset', 'MapAccessor', 'DetachedCall', 'For', 'RawInline',
  'StyleImport',
]);

/** Value predicate for a tree2 AST node (replaces the old `x instanceof Node`). */
export function isNode(x: unknown): x is Node {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { type?: unknown }).type === 'string' &&
    AST_NODE_TYPES.has((x as { type: string }).type)
  );
}
