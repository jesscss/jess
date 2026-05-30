import { F_STATIC, type Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

type StaticRulesLike = {
  hasFlag(flag: number): boolean;
  value: Node[];
};

export function isPlainStaticRuleLeaf(node: Node): boolean {
  if (isNode(node, N.Comment | N.Nil)) {
    return true;
  }
  if (!isNode(node, N.Declaration) || !node.hasFlag(F_STATIC)) {
    return false;
  }
  const assign = Reflect.get(node.options, 'assign');
  const normalizedFromAssign = Reflect.get(node.options, 'normalizedFromAssign');
  return normalizedFromAssign === undefined
    && (assign === undefined || assign === ':');
}

export function canRenderStaticRulesDirectly(rules: StaticRulesLike): boolean {
  return rules.hasFlag(F_STATIC) && rules.value.every(isPlainStaticRuleLeaf);
}
