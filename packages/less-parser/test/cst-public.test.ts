import { describe, expect, it } from 'vitest';
import { absolutizeCST } from 'parseman';
import { parseLessCst, parseLessDoc } from '../src/cst.js';
import type { LessCstChild } from '../src/cst.js';

/** Structural CST key (type + absolute span + children; leaves by value+span). */
function cstStructKey(node: LessCstChild): unknown {
  if (node._tag === 'leaf') {
    return { l: node.value, s: node.span.start, e: node.span.end };
  }
  if (node._tag === 'error') {
    return { err: node.type, s: node.span.start, e: node.span.end, children: node.children.map(cstStructKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, children: node.children.map(cstStructKey) };
}

type CstNode = ReturnType<typeof parseLessCst>['tree'];

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

describe('@jesscss/less-parser/cst', () => {
  it('parses Less through the public core-free CST entry', () => {
    const result = parseLessCst('@color: red; .x { color: @color; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.children.some(c => c._tag === 'node' && c.grammarType === 'VarDeclaration')).toBe(true);
  });

  it('collapses transparent CST wrappers without dropping leaves', () => {
    const expanded = parseLessCst('@color: red; .x { color: @color; }');
    const collapsed = parseLessCst('@color: red; .x { color: @color; }', 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...stats(expanded.tree).types]).not.toContain('Unknown');
    expect(stats(expanded.tree).types).toContain('VarDeclaration');
    expect(stats(expanded.tree).grammarTypes.get('Reference')).toBeGreaterThan(stats(collapsed.tree).grammarTypes.get('Reference') ?? 0);
    expect(stats(collapsed.tree).leaves).toBe(stats(expanded.tree).leaves);
    expect(collapsed.tree.children.some(c => c._tag === 'node' && c.grammarType === 'VarDeclaration')).toBe(true);
  });
});

function findNode(node: LessCstChild, grammarType: string): Extract<LessCstChild, { _tag: 'node' }> | undefined {
  if (node._tag !== 'node') {
    return undefined;
  }
  if (node.grammarType === grammarType) {
    return node;
  }
  for (const child of node.children) {
    const found = findNode(child, grammarType);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function leafValues(node: LessCstChild): string[] {
  if (node._tag === 'leaf') {
    return [node.value];
  }
  if (node._tag !== 'node') {
    return [];
  }
  return node.children.flatMap(leafValues);
}

function findNodes(node: LessCstChild, grammarType: string): Extract<LessCstChild, { _tag: 'node' }>[] {
  if (node._tag !== 'node') {
    return [];
  }
  return [
    ...(node.grammarType === grammarType ? [node] : []),
    ...node.children.flatMap(child => findNodes(child, grammarType))
  ];
}

describe('Less import CST facts', () => {
  it('keeps quoted interpolation segments, typed options, and a typed media postlude', () => {
    const result = parseLessCst('@import (less, multiple) "theme-@{name}.css" screen and (min-width: 600px);');
    expect(result.errors).toHaveLength(0);
    const imp = findNode(result.tree, 'ImportAtRule');
    expect(imp).toBeDefined();
    expect(leafValues(findNode(imp!, 'ImportOptions')!)).toEqual(['(', 'less', ',', 'multiple', ')']);
    expect(findNode(imp!, 'ImportTarget')).toBeDefined();
    expect(findNode(imp!, 'Quoted')).toBeDefined();
    expect(leafValues(findNode(imp!, 'LessInterp')!)).toEqual(['@{', 'name', '}']);
    expect(leafValues(findNode(imp!, 'ImportMedia')!)).toContain('screen');
  });

  it('keeps a url target and the @-export keyword', () => {
    const result = parseLessCst('@-export (reference) url("theme.less") print;');
    expect(result.errors).toHaveLength(0);
    const imp = findNode(result.tree, 'ImportAtRule');
    expect(imp).toBeDefined();
    expect(leafValues(imp!)).toContain('@-export');
    expect(findNode(imp!, 'ImportOptions')).toBeDefined();
    expect(findNode(imp!, 'ImportTarget')).toBeDefined();
    expect(findNode(imp!, 'Url')).toBeDefined();
    expect(findNode(imp!, 'ImportMedia')).toBeDefined();
  });
});

describe('Less custom-property interpolation CST facts', () => {
  it('keeps valid interpolation typed instead of swallowing it in opaque custom-property chunks', () => {
    const input = '.x { --theme: pre-@{name}-post (@{map[key]}) [@{index}] { @{nested} }; }';
    const result = parseLessCst(input);

    expect(result.errors).toHaveLength(0);
    expect(findNodes(result.tree, 'LessInterp').map(leafValues)).toEqual([
      ['@{', 'name', '}'],
      ['@{', 'map', '[', 'key', ']', '}'],
      ['@{', 'index', '}'],
      ['@{', 'nested', '}']
    ]);
  });

  it('retains invalid or escaped interpolation starts as literal custom-property content', () => {
    for (const [input, literal] of [
      ['.x { --theme: pre-@{ spaced }-post; }', 'pre-@{ spaced }-post'],
      ['.x { --theme: pre-@{map.key}-post; }', 'pre-@{map.key}-post'],
      ['.x { --theme: pre-@{}-post; }', 'pre-@{}-post'],
      ['.x { --theme: pre-\\@{name}-post; }', 'pre-\\@{name}-post']
    ]) {
      const result = parseLessCst(input);
      expect(result.errors, input).toHaveLength(0);
      expect(findNodes(result.tree, 'LessInterp'), input).toHaveLength(0);
      expect(leafValues(result.tree).join(''), input).toContain(literal);
    }
  });
});

describe('Less quoted and URL interpolation CST facts', () => {
  it('keeps quoted-string literal chunks and the typed interpolation body in source order', () => {
    const result = parseLessCst('.a { content: "pre-@{theme[variant]}-post"; }');
    expect(result.errors).toHaveLength(0);

    const quoted = findNode(result.tree, 'Quoted');
    expect(quoted).toBeDefined();
    expect(leafValues(quoted!)).toEqual(['"', 'pre-', '@{', 'theme', '[', 'variant', ']', '}', '-post', '"']);
    expect(leafValues(findNode(quoted!, 'LessInterp')!)).toEqual(['@{', 'theme', '[', 'variant', ']', '}']);
  });

  it('uses that same quoted target structure inside url()', () => {
    const result = parseLessCst('.a { background: url("@{base}/icon.svg"); }');
    expect(result.errors).toHaveLength(0);

    const url = findNode(result.tree, 'Url');
    expect(url).toBeDefined();
    expect(leafValues(url!)).toEqual(['url(', '"', '@{', 'base', '}', '/icon.svg', '"', ')']);
    expect(findNode(url!, 'Quoted')).toBeDefined();
    expect(leafValues(findNode(url!, 'LessInterp')!)).toEqual(['@{', 'base', '}']);
  });

  it('does not invent interpolation structure for escaped or non-Less-shaped text', () => {
    const result = parseLessCst('.a { a: "\\@{literal}"; b: "@{ spaced }"; }');
    expect(result.errors).toHaveLength(0);
    expect(findNode(result.tree, 'LessInterp')).toBeUndefined();
  });
});

const LESS_DOC_CORPUS: string[] = [
  '@color: red; .x { color: @color; }',
  '.mixin(@a) { padding: @a; }\n.y { .mixin(4px); }',
  '@w: 10px;\n.a { width: @w; height: @w * 2; }',
  '.a { &:hover { color: blue; } }',
  '@media (min-width: @w) { .a { display: block; } }',
  '// line comment\n.a { color: red; } /* block */',
  '.a { .b { .c { color: red } } }',
  '@list: 1px, 2px, 3px; .a { margin: @list; }'
];

describe('@jesscss/less-parser/cst — parseLessDoc structural parity', () => {
  it('parseLessDoc().tree (absolutized) equals parseLessCst().tree across a corpus', () => {
    for (const input of LESS_DOC_CORPUS) {
      const oneShot = parseLessCst(input);
      const doc = parseLessDoc(input);
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
