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
  Rule,
  Declaration,
  Comment,
  SelectorList,
  ComplexSelector,
  CompoundSelector,
  SimpleSelector,
  SelectorCapture,
  Keyword,
  Color,
  Quoted,
  Any,
  Url,
  Dimension,
  SpacedValue,
  List,
  VariableReference,
  MixinDef,
  MixinCall,
  VariableDeclaration,
  Sequence,
  Operation,
  FunctionCall,
  Block,
  Interpolation,
  GeneralEnclosed,
  VarIndirect,
  DetachedRuleset,
  Reference,
  Range,
  PropertyReference,
  For,
  If,
  StyleImport,
  ModuleImport,
  RawInline,
  Condition
} from './nodes.js';
import type { AtRuleBlock, AtRuleStatement, ImportAtRule, OpaqueAtRuleBlock, Plugin } from './at-rule.js';

/** Every tree2 node's PascalCase `type` discriminant (Less-matching). */
export type NodeType =
  | 'Stylesheet' | 'Rule' | 'Declaration' | 'Comment' | 'SelectorList'
  | 'ComplexSelector' | 'CompoundSelector' | 'SimpleSelector' | 'Keyword' | 'Color' | 'Quoted' | 'Any' | 'Url' | 'SelectorCapture' | 'Dimension'
  | 'SpacedValue' | 'List' | 'VariableReference' | 'MixinDef' | 'MixinCall' | 'VariableDeclaration'
  | 'Sequence' | 'Operation' | 'FunctionCall' | 'Block' | 'Condition'
  | 'AtRuleBlock' | 'AtRuleStatement' | 'ImportAtRule' | 'Plugin' | 'OpaqueAtRuleBlock' | 'Interpolation' | 'GeneralEnclosed' | 'VarIndirect'
  | 'DetachedRuleset' | 'Reference' | 'Range' | 'PropertyReference' | 'For' | 'If' | 'StyleImport' | 'ModuleImport' | 'RawInline';

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
  | Stylesheet | Rule | Declaration | Comment | SelectorList | ComplexSelector | CompoundSelector
  | SimpleSelector | SelectorCapture | Keyword | Color | Quoted | Any | Url | Dimension | SpacedValue | List | VariableReference | MixinDef | MixinCall
  | VariableDeclaration | Sequence | Operation | FunctionCall | Block | Condition
  | AtRuleBlock | AtRuleStatement | ImportAtRule | Plugin | OpaqueAtRuleBlock | Interpolation | GeneralEnclosed | VarIndirect | DetachedRuleset
  | Reference | Range | PropertyReference | For | If | StyleImport | ModuleImport | RawInline;

/**
 * The frozen set of the structural `type` strings — the membership basis for
 * {@link isNode}. A bare `'type' in x` is NOT a sound node test: the value domain
 * (`ValueObj`) also carries a PascalCase `type`, and after the #44 literal reshape
 * the AST literal leaves REUSE the value-domain names — `'Dimension'`, `'Color'`,
 * `'Quoted'`, `'Keyword'` are ALL shared between an AST leaf node and a `ValueObj`
 * (`'Bool'` is value-domain ONLY — no AST `Bool` node exists, §CORR-4). `'List'` is
 * likewise shared — an AST separator-aware list node vs the materialized value-domain `List`.
 * Membership in this AST set neutralizes every non-shared collision; the shared
 * strings are neutralized by the lane invariant (a value-domain `ValueObj` never enters the
 * AST-build lane; never form a `Node | ValueObj` union). The cheap structural
 * disambiguator, if ever needed, is the verbatim-field split: an AST literal names
 * it `src`, a `ValueObj` names it `bytes` — so `'bytes' in v` uniquely identifies a
 * value object and `'src' in v` an AST literal.
 */
export const AST_NODE_TYPES: ReadonlySet<string> = new Set<NodeType>([
  'Stylesheet', 'Rule', 'Declaration', 'Comment', 'SelectorList',
  'ComplexSelector', 'CompoundSelector', 'SimpleSelector', 'Keyword', 'Color', 'Quoted', 'Any', 'Url', 'SelectorCapture', 'Dimension',
  'SpacedValue', 'List', 'VariableReference', 'MixinDef', 'MixinCall', 'VariableDeclaration',
  'Sequence', 'Operation', 'FunctionCall', 'Block', 'Condition',
  'AtRuleBlock', 'AtRuleStatement', 'ImportAtRule', 'Plugin', 'OpaqueAtRuleBlock', 'Interpolation', 'GeneralEnclosed', 'VarIndirect',
  'DetachedRuleset', 'Reference', 'Range', 'PropertyReference', 'For', 'If', 'StyleImport', 'ModuleImport', 'RawInline'
]);

/** Value predicate for a tree2 AST node (replaces the old `x instanceof Node`). */
export function isNode(x: unknown): x is Node {
  return (
    typeof x === 'object'
    && x !== null
    && typeof (x as { type?: unknown }).type === 'string'
    && AST_NODE_TYPES.has((x as { type: string }).type)
  );
}
