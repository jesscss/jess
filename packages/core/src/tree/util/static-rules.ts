import { F_STATIC, type Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

type StaticRulesLike = {
  hasFlag(flag: number): boolean;
  value: Node[];
};

export function isPlainStaticRuleLeaf(node: Node): boolean {
  if (isNode(node, N.Comment) || isNode(node, N.Nil)) {
    return true;
  }
  if (isNode(node, N.VarDeclaration) && node.hasFlag(F_STATIC) && !node.visible) {
    return true;
  }
  if (!isNode(node, N.Declaration) || !node.hasFlag(F_STATIC)) {
    return false;
  }
  const assign = node.options.assign;
  const normalizedFromAssign = node.options.normalizedFromAssign;
  return normalizedFromAssign === undefined
    && (assign === undefined || assign === ':');
}

export function canRenderStaticRulesDirectly(rules: StaticRulesLike): boolean {
  return rules.hasFlag(F_STATIC) && rules.rules.every(isPlainStaticRuleLeaf);
}

export function canRenderStaticRuleArrayDirectly(rules: readonly Node[]): boolean {
  return rules.every(isPlainStaticRuleLeaf);
}
