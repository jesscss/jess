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
    return { err: node.type, s: node.span.start, e: node.span.end, rules: node.rules.map(cstStructKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, rules: node.rules.map(cstStructKey) };
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
      node.rules.forEach(visit);
    }
  };
  visit(tree);
  return { leaves, grammarTypes, types };
}

function isModeLabel(type: string): boolean {
  return type.startsWith('Direct') || type.startsWith('Static') || type.includes('Ast') || type.includes('Cst');
}

function expectNoModeLabels(tree: CstNode) {
  const { grammarTypes, types } = stats(tree);
  expect([...grammarTypes.keys()].filter(isModeLabel)).toEqual([]);
  expect([...types].filter(isModeLabel)).toEqual([]);
}

function leafText(node: CstNode | CstNode['children'][number]): string {
  if (node._tag === 'leaf') {
    return node.value;
  }
  if (node._tag === 'error') {
    return node.rules.map(leafText).join('');
  }
  return node.rules.map(leafText).join('');
}

describe('@jesscss/scss-parser/cst', () => {
  it('parses SCSS through the public core-free CST entry', () => {
    const result = parseScssCst('$color: red; .x { color: $color; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.rules.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoModeLabels(result.tree);
  });

  it('uses one semantic custom-value group label for every balanced delimiter', () => {
    const result = parseScssCst('.a { --x: fn([a {b:c}]); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('CustomGroup')).toBe(3);
    expect(['CustomParen', 'CustomSquare', 'CustomCurly'].some(type => grammarTypes.has(type))).toBe(false);
  });

  it('uses semantic general-enclosed template labels in supports', () => {
    const result = parseScssCst('$kind: card; @supports selector(([#{$kind}] {"#{$kind}"})) { .a { color: red; } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('Enclosed')).toBe(1);
    expect(grammarTypes.get('GeneralTemplateGroup')).toBe(3);
    expect(grammarTypes.get('GeneralTemplateQuoted')).toBe(1);
    expect([...grammarTypes.keys()].some(type => type.startsWith('SupportsGeneralTemplate'))).toBe(false);
  });

  it('matches CSS semantic labels for static at-rule prelude fragments', () => {
    const result = parseScssCst('@layer theme (wide) [brand] "local" { .a { color: red; } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('AtRulePreludeGroup')).toBe(2);
    expect(grammarTypes.get('AtRulePreludeQuoted')).toBe(1);
    expect([...grammarTypes.keys()].some(type => /^AtRulePrelude(?:Paren|Square|DoubleQuoted|SingleQuoted)$/.test(type))).toBe(false);
  });

  it('uses one semantic group label for nested generic pseudo arguments', () => {
    const result = parseScssCst('.a:lang(([wide])) { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('PseudoArgumentGroup')).toBe(2);
    expect(grammarTypes.has('PseudoArgumentSquare')).toBe(false);
  });

  it('accepts an ASCII-case-insensitive declaration priority through the public parser', () => {
    const result = parseScssCst('.card { color: blue !IMPORTANT; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expectNoModeLabels(result.tree);
  });

  it('uses contextual CST labels for quoted, pseudo-selector, and $if-body syntax', () => {
    const result = parseScssCst('@use "theme"; @forward "public"; $state: open; .a[data-label="#{$state}"]:not(:where([data-kind="open"])) { color: red; } .c:nth-child(2n) { color: blue; } @if true { .when-true { color: green; } @media screen { .nested { color: lime; } } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('Quoted')).toBeGreaterThan(1);
    expect(grammarTypes.get('UseRule')).toBe(1);
    expect(grammarTypes.get('ForwardRule')).toBe(1);
    expect(grammarTypes.get('AttributeSelector')).toBeGreaterThan(1);
    expect(grammarTypes.get('Interpolation')).toBeGreaterThan(0);
    expect(grammarTypes.get('PseudoArgument')).toBeGreaterThan(0);
    expect(grammarTypes.get('SelectorOnlyPseudoArgument')).toBeGreaterThan(0);
    expect(grammarTypes.get('IfBodyRule')).toBeGreaterThan(0);
    expect(grammarTypes.get('IfBodyConditionalBlock')).toBe(1);
    expectNoModeLabels(result.tree);
  });

  it('preserves direct import CST facts without a split CST-only route', () => {
    const source = '@import "theme.css" layer(tokens) supports((display: grid)) screen;';
    const result = parseScssCst(source);

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('ImportStatement')).toBe(1);
    expect(leafText(result.tree)).toContain('supports');
    expect(leafText(result.tree)).toContain('theme.css');
    expectNoModeLabels(result.tree);
  });

  it('keeps the selected SCSS @at-root continuation as the semantic CST node', () => {
    const result = parseScssCst('@at-root { .top { color: red; } } @at-root (with: .scope) { .filtered { color: blue; } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('AtRootBlock')).toBe(1);
    expect(grammarTypes.get('AtRootFilter')).toBe(1);
    expectNoModeLabels(result.tree);
  });

  it('routes Sass directive keywords without exposing dispatcher CST nodes', () => {
    const source = '@mixin tone($value) { color: $value; } @include tone(red); @function identity($value) { @return $value; } @each $name in red { .#{$name} { color: red; } } @for $i from 1 through 2 { .n-#{$i} { color: red; } } @if true { .yes { color: red; } } @at-root { .top { color: red; } }';
    const result = parseScssCst(source);

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('MixinDefinition')).toBe(1);
    expect(grammarTypes.get('MixinCall')).toBe(1);
    expect(grammarTypes.get('FunctionRule')).toBe(1);
    expect(grammarTypes.get('EachRule')).toBe(1);
    expect(grammarTypes.get('ForRule')).toBe(1);
    expect(grammarTypes.get('IfRule')).toBe(1);
    expect(grammarTypes.get('AtRootBlock')).toBe(1);
    expect(grammarTypes.has('SassDirective')).toBe(false);
    expectNoModeLabels(result.tree);
  });

  it('uses CSS-aligned CST labels for generic at-rule preludes', () => {
    const result = parseScssCst('@layer base.utilities { .card { color: red; } } @charset "UTF-8";');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('AtRulePrelude')).toBe(1);
    expect(grammarTypes.get('AtRulePreludeAtom')).toBeGreaterThan(0);
    expect(grammarTypes.get('StatementPrelude')).toBe(1);
    expectNoModeLabels(result.tree);
  });

  it('uses the CSS query-list separator shape without a tail wrapper', () => {
    const result = parseScssCst('@media screen, print { .card { color: red; } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('QueryPrelude')).toBe(1);
    expect(grammarTypes.get('QueryClause')).toBe(2);
    expect(grammarTypes.has('QueryPreludeTail')).toBe(false);
    expectNoModeLabels(result.tree);
  });

  it('uses cross-dialect semantic CST labels for mixin definitions and calls', () => {
    const result = parseScssCst('@mixin spacing($size) { padding: $size; } .card { @include spacing(1rem); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('MixinDefinition')).toBe(1);
    expect(grammarTypes.get('MixinCall')).toBe(1);
    expect(grammarTypes.has('MixinDefinitionRule')).toBe(false);
    expect(grammarTypes.has('MixinCallRule')).toBe(false);
    expectNoModeLabels(result.tree);
  });

  it('collapses transparent CST wrappers without dropping leaves', () => {
    const expanded = parseScssCst('$color: red; .x { color: $color; }');
    const collapsed = parseScssCst('$color: red; .x { color: $color; }', 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...stats(expanded.tree).types]).not.toContain('Unknown');
    expect(stats(expanded.tree).types).toContain('VariableDeclaration');
    expect(stats(collapsed.tree).leaves).toBe(stats(expanded.tree).leaves);
    expect(collapsed.tree.rules.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoModeLabels(expanded.tree);
    expectNoModeLabels(collapsed.tree);
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
