import { F_STATIC, type Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

type StaticRulesLike = {
  hasFlag(flag: number): boolean;
  rules: Node[];
};

export function isPlainStaticRuleLeaf(node: Node): boolean {
  if (isNode(node, N.Comment) || isNode(node, N.Nil)) {
    return true;
  }
  if (isNode(node, N.VarDeclaration) && node.hasFlag(F_STATIC) && !node.visible) {
    return true;
  }
  // Merge declarations (`+:` / `&,:` / `&_:` or normalized-from-assign) are never
  // F_STATIC — the constructor marks them F_NON_STATIC because they need
  // structural coalescing during eval — so the F_STATIC gate below already
  // excludes them; no separate assign check is required.
  return isNode(node, N.Declaration) && node.hasFlag(F_STATIC);
}

export function canRenderStaticRulesDirectly(rules: StaticRulesLike): boolean {
  return rules.hasFlag(F_STATIC) && rules.rules.every(isPlainStaticRuleLeaf);
}

export function canRenderStaticRuleArrayDirectly(rules: readonly Node[]): boolean {
  return rules.every(isPlainStaticRuleLeaf);
}
