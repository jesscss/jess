import { describe, expect, it } from 'vitest';
import { parseCssCst } from '../src/cst.js';
import type { CssCstNode } from '../src/index.js';

function childTypes(node: { rules: ReadonlyArray<unknown> }) {
  return node.rules
    .filter(isNode)
    .map(c => c.type);
}

function isNode(value: unknown): value is CssCstNode {
  return typeof value === 'object'
    && value !== null
    && '_tag' in value
    && value._tag === 'node';
}

describe('parseCssCst', () => {
  it('builds a spec-named CST without using Jess AST nodes', () => {
    const result = parseCssCst('a { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(childTypes(result.tree)).toContain('QualifiedRule');

    const rule = result.tree.rules.find(c => isNode(c) && c.type === 'QualifiedRule');
    expect(rule).toBeDefined();
    expect(childTypes(rule!)).toContain('SelectorList');
    expect(childTypes(rule!)).toContain('Declaration');
  });

  it('classifies basic selector atoms as honest CST nodes', () => {
    const result = parseCssCst('.foo #bar main * { color: red; }');
    const seen: string[] = [];
    const visit = (node: unknown) => {
      if (!isNode(node)) {
        return;
      }
      seen.push(node.type);
      for (const child of node.rules) {
        visit(child);
      }
    };

    visit(result.tree);

    expect(seen.filter(t => t === 'ClassSelector')).toHaveLength(1);
    expect(seen.filter(t => t === 'IdSelector')).toHaveLength(1);
    expect(seen.filter(t => t === 'TypeSelector')).toHaveLength(1);
    expect(seen.filter(t => t === 'UniversalSelector')).toHaveLength(1);
    expect(seen).not.toContain('BasicSelector');

    const selectorTags: string[] = [];
    const collectTags = (node: unknown) => {
      if (!isNode(node)) {
        return;
      }
      if (node.tags?.includes('Selector') === true) {
        selectorTags.push(node.type);
      }
      for (const child of node.rules) {
        collectTags(child);
      }
    };

    collectTags(result.tree);

    expect(selectorTags).toEqual(['ClassSelector', 'IdSelector', 'TypeSelector', 'UniversalSelector']);
  });
});
