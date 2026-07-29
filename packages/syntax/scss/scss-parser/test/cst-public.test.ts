import { describe, expect, it } from 'vitest';
import { absolutizeCST } from 'parseman';
import { parseScssCst, parseScssDoc } from '../src/cst.js';
import type { ScssCstChild } from '../src/cst.js';

/** Structural CST key (type + absolute span + children; leaves by value+span). */
function cstStructKey(node: ScssCstChild): unknown {
  if (node._tag === 'leaf') {
    return { l: node.value, s: node.span.start, e: node.span.end };
  }
  if (node._tag === 'error') {
    return { err: node.type, s: node.span.start, e: node.span.end, children: node.children.map(cstStructKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, children: node.children.map(cstStructKey) };
}

type CstNode = ReturnType<typeof parseScssCst>['tree'];

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

function expectNoDirectLabels(tree: CstNode) {
  const { grammarTypes, types } = stats(tree);
  expect([...grammarTypes.keys()].filter(type => type.startsWith('Direct'))).toEqual([]);
  expect([...types].filter(type => type.startsWith('Direct'))).toEqual([]);
}

function leafText(node: CstNode | CstNode['children'][number]): string {
  if (node._tag === 'leaf') {
    return node.value;
  }
  if (node._tag === 'error') {
    return node.children.map(leafText).join('');
  }
  return node.children.map(leafText).join('');
}

describe('@jesscss/scss-parser/cst', () => {
  it('parses SCSS through the public core-free CST entry', () => {
    const result = parseScssCst('$color: red; .x { color: $color; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.children.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoDirectLabels(result.tree);
  });

  it('accepts an ASCII-case-insensitive declaration priority through the public parser', () => {
    const result = parseScssCst('.card { color: blue !IMPORTANT; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expectNoDirectLabels(result.tree);
  });

  it('preserves direct import CST facts without a split CST-only route', () => {
    const source = '@import "theme.css" layer(tokens) supports((display: grid)) screen;';
    const result = parseScssCst(source);

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('StaticImportRule')).toBe(1);
    expect(leafText(result.tree)).toContain('supports');
    expect(leafText(result.tree)).toContain('theme.css');
    expectNoDirectLabels(result.tree);
  });

  it('collapses transparent CST wrappers without dropping leaves', () => {
    const expanded = parseScssCst('$color: red; .x { color: $color; }');
    const collapsed = parseScssCst('$color: red; .x { color: $color; }', 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...stats(expanded.tree).types]).not.toContain('Unknown');
    expect(stats(expanded.tree).types).toContain('VariableDeclaration');
    expect(stats(collapsed.tree).leaves).toBe(stats(expanded.tree).leaves);
    expect(collapsed.tree.children.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoDirectLabels(expanded.tree);
    expectNoDirectLabels(collapsed.tree);
  });
});

const SCSS_DOC_CORPUS: string[] = [
  '$c: red; .x { color: $c; }',
  '@mixin m($a) { padding: $a; }\n.y { @include m(4px); }',
  '$w: 10px;\n.a { width: $w; height: $w * 2; }',
  '.a { &:hover { color: blue; } }',
  '@media (min-width: $w) { .a { display: block; } }',
  '// line comment\n.a { color: red; } /* block */',
  '.a { .b { .c { color: red } } }',
  '@if true { .a { color: red; } } @else { .b { color: blue; } }'
];

describe('@jesscss/scss-parser/cst — parseScssDoc structural parity', () => {
  it('parseScssDoc().tree (absolutized) equals parseScssCst().tree across a corpus', () => {
    for (const input of SCSS_DOC_CORPUS) {
      const oneShot = parseScssCst(input);
      const doc = parseScssDoc(input);
      const tree = doc.tree;
      expect(tree, `doc parsed: ${JSON.stringify(input)}`).not.toBeNull();
      if (!tree) {
        continue;
      }
      const abs = absolutizeCST(tree);
      expect(cstStructKey(abs), `mismatch for: ${JSON.stringify(input)}`).toEqual(cstStructKey(oneShot.tree));
    }
  });
});
