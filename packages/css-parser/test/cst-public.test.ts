import { describe, expect, it } from 'vitest';
import { parseCss, parseCssCst } from '../src/cst-css.js';

type CstNode = ReturnType<typeof parseCss>['tree'];

function collect(tree: CstNode) {
  let leaves = 0;
  let basicSelectors = 0;
  const types = new Set<string>();
  const visit = (node: CstNode | CstNode['children'][number]) => {
    if (node._tag === 'leaf') {
      leaves++;
      return;
    }
    if (node._tag === 'node') {
      types.add(node.type);
      if (node.type === 'BasicSelector') {
        basicSelectors++;
      }
      node.children.forEach(visit);
    }
  };
  visit(tree);
  return { leaves, basicSelectors, types };
}

describe('@jesscss/css-parser/cst', () => {
  it('parses CSS through the public core-free CST entry', () => {
    const result = parseCssCst('a { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.children.some(c => c._tag === 'node' && c.type === 'QualifiedRule')).toBe(true);
  });

  it('exports parseCss and accepts collapse mode', () => {
    const result = parseCss('a.foo { color: red; }', 'Stylesheet', { collapse: true });

    expect(result.errors).toHaveLength(0);
    expect(result.tree.children.some(c => c._tag === 'node' && c.type === 'QualifiedRule')).toBe(true);
    expect(parseCssCst).toBe(parseCss);
  });

  it('keeps named CSS CST nodes stable with and without collapse mode', () => {
    const expanded = parseCss('a.foo { color: red; }');
    const collapsed = parseCss('a.foo { color: red; }', 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...collect(collapsed.tree).types]).not.toContain('Unknown');
    expect(collect(collapsed.tree)).toMatchObject({ leaves: collect(expanded.tree).leaves, basicSelectors: 2 });
  });
});
