import { describe, expect, it } from 'vitest';
import { absolutizeCST } from 'parseman';
import { parseCss, parseCssCst, parseCssDoc } from '../src/cst-css.js';
import type { CssCstChild } from '../src/cst-css.js';

/**
 * Structural CST equality (type + absolute span + children, leaves by value+span).
 * `parseDoc().tree` carries PARENT-RELATIVE spans, so absolutize before comparing
 * to a one-shot `parseCst().tree` (absolute).
 */
function cstStructKey(node: CssCstChild): unknown {
  if (node._tag === 'leaf') {
    return { l: node.value, s: node.span.start, e: node.span.end };
  }
  if (node._tag === 'error') {
    return { err: node.type, s: node.span.start, e: node.span.end, children: node.children.map(cstStructKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, children: node.children.map(cstStructKey) };
}

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

const CSS_DOC_CORPUS: string[] = [
  'a { color: red; }',
  '.x{a:1}',
  'a { color: red; }\n.b { width: 10px; height: 20px; }',
  '@media (min-width: 600px) { .a { display: block; } }',
  'a,\nb ,\nc { margin: 0 }',
  '.grid { grid-template: "a b" 1fr / auto; padding: calc(1px + 2px); }',
  ':root { --x: 10px; } a { width: var(--x); }',
  '/* leading */\na { /* inner */ color: red; } /* trailing */',
  '@import "x.css";\n@font-face { font-family: F; src: url(f.woff2); }'
];

describe('@jesscss/css-parser/cst — parseCssDoc structural parity', () => {
  it('parseCssDoc().tree (absolutized) equals parseCss().tree across a corpus', () => {
    for (const input of CSS_DOC_CORPUS) {
      const oneShot = parseCss(input);
      const doc = parseCssDoc(input);
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
