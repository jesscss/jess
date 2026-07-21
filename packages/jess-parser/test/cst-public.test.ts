import { describe, expect, it } from 'vitest';
import { parseJessCst } from '../src/cst.js';

type CstNode = ReturnType<typeof parseJessCst>['tree'];

function stats(tree: CstNode) {
  let leaves = 0;
  const grammarTypes = new Map<string, number>();
  const types = new Set<string>();
  const visit = (node: CstNode | CstNode['children'][number]) => {
    if (node._tag === 'leaf') {
      leaves++;
      return;
    }
    if (node._tag === 'node') {
      types.add(node.type);
      grammarTypes.set(node.grammarType, (grammarTypes.get(node.grammarType) ?? 0) + 1);
      node.children.forEach(visit);
    }
  };
  visit(tree);
  return { leaves, grammarTypes, types };
}

describe('@jesscss/jess-parser/cst', () => {
  it('parses Jess through the public core-free CST entry', () => {
    const result = parseJessCst('$color: red; .x { color: $color; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.children.some(c => c._tag === 'node' && c.grammarType === 'VarDeclaration')).toBe(true);
  });

  it('collapses transparent CST wrappers without dropping leaves', () => {
    // A bare `$[side]` selector is a single-child `InterpolatedSelector` — the
    // canonical transparent wrapper that `collapse` folds to its child. (A `$foo`
    // `Reference` is NOT a collapse witness: it carries the `$` sigil and the name
    // as two distinct leaves, so it's a genuine container, not a passthrough.)
    const src = '$color: red; $[side] { color: $color; }';
    const expanded = parseJessCst(src);
    const collapsed = parseJessCst(src, 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...stats(expanded.tree).types]).not.toContain('Unknown');
    expect(stats(expanded.tree).types).toContain('VarDeclaration');
    expect(stats(expanded.tree).grammarTypes.get('InterpolatedSelector')).toBeGreaterThan(stats(collapsed.tree).grammarTypes.get('InterpolatedSelector') ?? 0);
    expect(stats(collapsed.tree).leaves).toBe(stats(expanded.tree).leaves);
    expect(collapsed.tree.children.some(c => c._tag === 'node' && c.grammarType === 'VarDeclaration')).toBe(true);
  });

  it('uses structural DollarInterp nodes in selector interpolation', () => {
    const result = parseJessCst('.widget-$[side]-$[theme] { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('InterpolatedSelector')).toBe(1);
    expect(stats(result.tree).grammarTypes.get('DollarInterp')).toBe(2);
  });

  it('uses structural DollarInterp nodes in ordinary and @import url targets', () => {
    const result = parseJessCst('.asset { image: url(images/$[file].svg); } @import url($[path]) print;');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('Url')).toBeGreaterThan(0);
  });

  it('keeps the documented unwrapped variable-led arithmetic syntax in the public CST route', () => {
    const result = parseJessCst('$w: 2px; .card { width: $w * 2 + 1px; slash: $w / 2; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    // CST labels its operation node by output type, while the direct AST route
    // has the named DirectJessUnwrappedArithmetic reduction. This confirms the
    // historical public CST still recognizes the authored spelling.
    expect(stats(result.tree).grammarTypes.get('Operation')).toBeGreaterThan(0);
  });

  it('rejects malformed selector interpolation instead of swallowing it as a token', () => {
    const result = parseJessCst('.widget-$[side { color: red; }');

    expect(result.errors.length + Number(result.unconsumedFrom !== null)).toBeGreaterThan(0);
  });
});
