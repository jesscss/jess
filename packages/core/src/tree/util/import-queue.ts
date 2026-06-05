import { type Context } from '../../context.js';
import { type AtRule } from '../at-rule.js';
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

function importSyntaxMatches(a: AtRule, b: AtRule): boolean {
  if (!locationsEqual(a.location, b.location)) {
    return false;
  }
  const aName = a.value.name.valueOf?.() ?? a.value.name;
  const bName = b.value.name.valueOf?.() ?? b.value.name;
  if (String(aName) !== String(bName)) {
    return false;
  }
  const aPrelude = a.value.prelude?.valueOf?.() ?? '';
  const bPrelude = b.value.prelude?.valueOf?.() ?? '';
  return String(aPrelude) === String(bPrelude);
}

export function queueTopImport(context: Context, importRule: AtRule): void {
  if (context.inReferenceImportScope) {
    return;
  }
  const topImports = (context.topImports ??= []);
  for (let i = 0; i < topImports.length; i++) {
    const queuedNode = topImports[i]!;
    if (!isNode(queuedNode, N.AtRule)) {
      continue;
    }
    const queued = queuedNode as AtRule;
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
