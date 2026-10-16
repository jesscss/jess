import type { CssCstChild, CssCstNode } from '@jesscss/css-parser/cst-host';

/* CST node kinds and readers shared by the tolerant diagnostics and their parse twins. */
export const RULESET_TYPES = new Set([
  'Ruleset',
  'NestedRuleset',
  'RulesetWithExtends',
  'NestedRulesetWithExtends'
]);
export const DECLARATION_TYPES = new Set(['Declaration']);
export const CUSTOM_DECLARATION_TYPES = new Set(['CustomDeclaration']);
export const CUSTOM_PROPERTY_VALUE_TYPES = new Set(['CustomPropertyValue']);
export const FUNCTION_TYPES = new Set(['Call', 'VarCall', 'FunctionCall', 'ImportTailFunction']);
export function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

export function cstChildrenOf(node: CssCstNode): readonly CssCstChild[] {
  return node.rules;
}

export function absoluteStart(node: CssCstNode): number {
  return Number(node.span.start);
}

export function absoluteEnd(node: CssCstNode): number {
  return Number(node.span.end);
}
