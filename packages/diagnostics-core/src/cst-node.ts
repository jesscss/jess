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

/*
 * The variable a `.jess` `${…}` reads, from its tokens, so padding inside the
 * braces (`${ name }`) changes nothing: `${name}` reads `$name`, `${[$key]}`
 * reads `$key`, and `${[name]}` reads a property, no variable.
 */
export function dollarBraceVariableNameOf(node: CssCstNode): string | null {
  const leaves = cstChildrenOf(node).filter(child => child._tag === 'leaf');
  const name = leaves[1]?.value === '[' ? (leaves[2]?.value === '$' ? leaves[3] : undefined) : leaves[1];
  return name?._tag === 'leaf' ? name.value : null;
}
