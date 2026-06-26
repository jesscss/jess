import { type Context } from '../../context.js';
import { AtRuleStatement } from '../at-rule-statement.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

function locationsEqual(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function importSyntaxMatches(a: AtRuleStatement, b: AtRuleStatement): boolean {
  if (!locationsEqual(a.location, b.location)) {
    return false;
  }
  const aName = a.name.valueOf?.() ?? a.name;
  const bName = b.name.valueOf?.() ?? b.name;
  if (String(aName) !== String(bName)) {
    return false;
  }
  const aPrelude = a.prelude?.valueOf?.() ?? '';
  const bPrelude = b.prelude?.valueOf?.() ?? '';
  return String(aPrelude) === String(bPrelude);
}

export function queueTopImport(context: Context, importRule: AtRuleStatement): void {
  if (context.inReferenceImportScope) {
    return;
  }
  const topImports = (context.topImports ??= []);
  for (let i = 0; i < topImports.length; i++) {
    const queuedNode = topImports[i]!;
    if (!isNode(queuedNode, N.AtRuleStatement) || !(queuedNode instanceof AtRuleStatement)) {
      continue;
    }
    const queued: AtRuleStatement = queuedNode;
    if (
      queued === importRule
      || queued.sourceNode === importRule.sourceNode
      || queued.sourceNode === importRule
      || importSyntaxMatches(queued, importRule)
    ) {
      return;
    }
  }
  topImports.push(importRule);
}
