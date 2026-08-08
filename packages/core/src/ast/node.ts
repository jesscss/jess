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
  Stylesheet,
  Ruleset,
  Declaration,
  Comment,
  SelectorList,
  ComplexSelector,
  RelativeSelector,
  CompoundSelector,
  SimpleSelector,
  SelectorCapture,
  Keyword,
  Color,
  Quoted,
  Any,
  Url,
  Dimension,
  List,
  Lookup,
  MixinDefinition,
  MixinCall,
  VariableDeclaration,
  Sequence,
  Important,
  Operation,
  FunctionCall,
  Block,
  Interpolation,
  AnonymousMixin,
  Collection,
  CollectionEntry,
  Reference,
  Range,
  For,
  If,
  StyleImport,
  ModuleImport,
  Condition,
  IfValue
} from './nodes.js';
import type { AtRuleBlock, AtRuleStatement, OpaqueAtRuleBlock, Plugin } from './at-rule.js';

/** Every tree2 node's PascalCase `type` discriminant (Less-matching). */
export type NodeType =
  | 'Stylesheet' | 'Ruleset' | 'Declaration' | 'Comment' | 'SelectorList'
  | 'ComplexSelector' | 'RelativeSelector' | 'CompoundSelector' | 'SimpleSelector' | 'Keyword' | 'Color' | 'Quoted' | 'Any' | 'Url' | 'SelectorCapture' | 'Dimension'
  | 'Sequence' | 'List' | 'Lookup' | 'MixinDefinition' | 'MixinCall' | 'VariableDeclaration'
  | 'Important' | 'Operation' | 'FunctionCall' | 'Block' | 'Condition' | 'IfValue'
  | 'AtRuleBlock' | 'AtRuleStatement' | 'Plugin' | 'OpaqueAtRuleBlock' | 'Interpolation'
  | 'AnonymousMixin' | 'Collection' | 'CollectionEntry' | 'Reference' | 'Range' | 'For' | 'If' | 'StyleImport' | 'ModuleImport';

/** Combinator between two compounds in a complex selector. `|` is the CSS
 * namespace separator (tight, no spaces: `foo|h1`); `||` is the column
 * combinator (spaced). */
export type Combinator = ' ' | '>' | '+' | '~' | '|' | '||';

/** Render a combinator: descendant is a single space; the namespace pipe binds
 * tightly with no surrounding spaces (`foo|h1`); the rest are surrounded by spaces. */
export function renderCombinator(comb: Combinator): string {
  return comb === ' ' ? ' ' : comb === '|' ? '|' : ` ${comb} `;
}

/**
 * The tree2 node union. `Node` is the exported NAME — a discriminated union of
 * the plain-data member interfaces (no base class, no `instanceof`). Narrow with
 * `node.type === '…'` or the {@link isNode} value predicate.
 */
export type Node =
  | Stylesheet | Ruleset | Declaration | Comment | SelectorList | ComplexSelector | RelativeSelector | CompoundSelector
  | SimpleSelector | SelectorCapture | Keyword | Color | Quoted | Any | Url | Dimension | Sequence | List | Lookup | MixinDefinition | MixinCall
  | VariableDeclaration | Important | Operation | FunctionCall | Block | Condition | IfValue
  | AtRuleBlock | AtRuleStatement | Plugin | OpaqueAtRuleBlock | Interpolation | AnonymousMixin | Collection
  | CollectionEntry | Reference | Range | For | If | StyleImport | ModuleImport;

/**
 * The frozen set of the structural `type` strings — the membership basis for
 * {@link isNode}. A bare `'type' in x` is NOT a sound node test: the value domain
 * (`Value`) also carries a PascalCase `type`, and after the #44 literal reshape
 * the AST literal leaves REUSE the value-domain names — `'Dimension'`, `'Color'`,
 * `'Quoted'`, `'Keyword'` are ALL shared between an AST leaf node and a `Value`
 * (`'Bool'` is value-domain ONLY — no AST `Bool` node exists, §CORR-4). `'List'` is
 * likewise shared — an AST separator-aware list node vs the materialized value-domain `List`.
 * Membership in this AST set neutralizes every non-shared collision; the shared
 * strings are neutralized by the lane invariant (a value-domain `Value` never enters the
 * AST-build lane; never form a `Node | Value` union). The cheap structural
 * disambiguator, if ever needed, is the verbatim-field split: an AST literal names
 * it `src`, a `Value` names it `bytes` — so `'bytes' in v` uniquely identifies a
 * value object and `'src' in v` an AST literal.
 */
export const AST_NODE_TYPES: ReadonlySet<string> = new Set<NodeType>([
  'Stylesheet', 'Ruleset', 'Declaration', 'Comment', 'SelectorList',
  'ComplexSelector', 'RelativeSelector', 'CompoundSelector', 'SimpleSelector', 'Keyword', 'Color', 'Quoted', 'Any', 'Url', 'SelectorCapture', 'Dimension',
  'Sequence', 'List', 'Lookup', 'MixinDefinition', 'MixinCall', 'VariableDeclaration',
  'Important', 'Operation', 'FunctionCall', 'Block', 'Condition', 'IfValue',
  'AtRuleBlock', 'AtRuleStatement', 'Plugin', 'OpaqueAtRuleBlock', 'Interpolation',
  'AnonymousMixin', 'Collection', 'CollectionEntry', 'Reference', 'Range', 'For', 'If', 'StyleImport', 'ModuleImport'
]);

/** Value predicate for a tree2 AST node (replaces the old `x instanceof Node`). */
export function isNode(x: unknown): x is Node {
  if (typeof x !== 'object' || x === null || !('type' in x) || typeof x.type !== 'string') {
    return false;
  }
  return AST_NODE_TYPES.has(x.type);
}
