import { describe, expect, it } from 'vitest';
import { absolutizeCST } from 'parseman';
import { parseCst } from '@jesscss/css-parser/cst';
import { parseLessCst, parseLessDoc } from '../src/cst.js';
import { lessCstGrammar } from '../src/grammar.js';
import type { LessCstChild } from '../src/cst.js';

/** Structural CST key (type + absolute span + children; leaves by value+span). */
function cstStructKey(node: LessCstChild): unknown {
  if (node._tag === 'leaf') {
    return { l: node.value, s: node.span.start, e: node.span.end };
  }
  if (node._tag === 'error') {
    return { err: node.type, s: node.span.start, e: node.span.end, rules: node.rules.map(cstStructKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, rules: node.rules.map(cstStructKey) };
}

type CstNode = ReturnType<typeof parseLessCst>['tree'];
type CstResult = ReturnType<typeof parseLessCst>;

function parseLessCstResult(input: string): CstResult {
  return parseCst(lessCstGrammar as Record<string, unknown>, input);
}

function cstIssueCount(result: CstResult): number {
  return Number(!result.ok)
    + result.errors.length
    + Number(result.unconsumedFrom !== null);
}

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

describe('@jesscss/less-parser/cst', () => {
  it('parses Less through the public core-free CST entry', () => {
    const result = parseLessCst('@color: red; .x { color: @color; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.rules.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoModeLabels(result.tree);
  });

  it('uses one semantic custom-value group label for every balanced delimiter', () => {
    const result = parseLessCst('.a { --x: fn([a {b:c}]); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('CustomGroup')).toBe(3);
    expect(['CustomParen', 'CustomSquare', 'CustomCurly'].some(type => grammarTypes.has(type))).toBe(false);
  });

  it('uses one semantic group label for nested generic pseudo arguments', () => {
    const result = parseLessCst('.a:lang(([wide])) { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('PseudoArgumentGroup')).toBe(2);
    expect(grammarTypes.has('PseudoArgumentSquare')).toBe(false);
  });

  it('keeps unsupported Less variable names recoverable in CST mode', () => {
    for (const input of [
      '@1: red;',
      '@-: red;',
      '.entry { color: @-; }',
      'each(1, .(@-) { color: red; });'
    ]) {
      const result = parseLessCst(input);

      expect(result.tree.type).toBe('StyleSheet');
      expectNoModeLabels(result.tree);
    }
  });

  it('ignores trailing Less trivia but reports a non-trivia tail', () => {
    const trailingTrivia = parseLessCst('@color: red; .x { color: @color; }\n// trailing\n');
    const trailingJunk = parseLessCst('@color: red; .x { color: @color; } ???');

    expect(trailingTrivia.errors).toHaveLength(0);
    expect(trailingTrivia.unconsumedFrom).toBeNull();
    expect(trailingJunk.unconsumedFrom).not.toBeNull();
  });

  it('collapses transparent CST wrappers without dropping leaves', () => {
    const expanded = parseLessCst('@color: red; .x { color: @color; }');
    const collapsed = parseLessCst('@color: red; .x { color: @color; }', 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...stats(expanded.tree).types]).not.toContain('Unknown');
    expect(stats(expanded.tree).types).toContain('VariableDeclaration');
    expect(stats(collapsed.tree).grammarTypes.get('Reference') ?? 0).toBeLessThanOrEqual(stats(expanded.tree).grammarTypes.get('Reference') ?? 0);
    expect(stats(collapsed.tree).leaves).toBe(stats(expanded.tree).leaves);
    expect(collapsed.tree.rules.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoModeLabels(expanded.tree);
    expectNoModeLabels(collapsed.tree);
  });
});

function findNode(node: LessCstChild, grammarType: string): Extract<LessCstChild, { _tag: 'node' }> | undefined {
  if (node._tag !== 'node') {
    return undefined;
  }
  if (node.grammarType === grammarType) {
    return node;
  }
  for (const child of node.rules) {
    const found = findNode(child, grammarType);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function hasNode(node: LessCstChild, grammarType: string): boolean {
  return findNode(node, grammarType) !== undefined;
}

function leafValues(node: LessCstChild): string[] {
  if (node._tag === 'leaf') {
    return [node.value];
  }
  if (node._tag !== 'node') {
    return [];
  }
  return node.rules.flatMap(leafValues);
}

function findNodes(node: LessCstChild, grammarType: string): Extract<LessCstChild, { _tag: 'node' }>[] {
  if (node._tag !== 'node') {
    return [];
  }
  return [
    ...(node.grammarType === grammarType ? [node] : []),
    ...node.rules.flatMap(child => findNodes(child, grammarType))
  ];
}

describe('Less import CST facts', () => {
  it('keeps quoted interpolation segments, typed options, and a typed media postlude', () => {
    const result = parseLessCst('@import (less, multiple) "theme-@{name}.css" screen and (min-width: 600px);');
    expect(result.errors).toHaveLength(0);
    const imp = findNode(result.tree, 'ImportStatement');
    expect(imp).toBeDefined();
    expect(leafValues(findNode(imp!, 'ImportOptions')!)).toEqual(['(', 'less', ',', 'multiple', ')']);
    expect(findNode(imp!, 'ImportTarget')).toBeDefined();
    expect(findNode(imp!, 'Quoted')).toBeDefined();
    expect(leafValues(findNode(imp!, 'VariableInterpolation')!)).toEqual(['@{', 'name', '}']);
    expect(leafValues(findNode(imp!, 'ImportTail')!)).toContain('screen and ');
  });

  it('keeps a url target and the @-import keyword', () => {
    const result = parseLessCst('@-import (reference) url("theme.less") print;');
    expect(result.errors).toHaveLength(0);
    const imp = findNode(result.tree, 'ImportStatement');
    expect(imp).toBeDefined();
    expect(leafValues(imp!)).toContain('@-import');
    expect(findNode(imp!, 'ImportOptions')).toBeDefined();
    expect(findNode(imp!, 'ImportTarget')).toBeDefined();
    expect(findNode(imp!, 'Url')).toBeDefined();
    expect(findNode(imp!, 'ImportTail')).toBeDefined();
    expectNoModeLabels(result.tree);
  });

  it('does not treat @-export as a Less import spelling', () => {
    const result = parseLessCst('@-export (reference) url("theme.less") print;');
    expect(cstIssueCount(result)).toBeGreaterThan(0);
  });

  it('rejects an unterminated quoted interpolation import target', () => {
    const result = parseLessCst('@import "theme-@{name}.css;');
    expect(cstIssueCount(result)).toBeGreaterThan(0);
  });
});

describe('Less statement-container CST facts', () => {
  it('keeps nested rules, at-rules, mixins, and each bodies in detached and callback containers', () => {
    const source = '@theme: { .nested { color: red; } @media screen { .media { color: blue; } } .tone() { color: green; } each(1, { .item { order: @value; } }); }; each(1, .(@entry) { .entry { order: @entry; } @media print { .print { color: black; } } });';
    const result = parseLessCst(source);

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(findNodes(result.tree, 'Ruleset')).toHaveLength(5);
    expect(findNodes(result.tree, 'For')).toHaveLength(2);
    expect(findNodes(result.tree, 'MixinDefinition')).toHaveLength(1);
    expectNoModeLabels(result.tree);
  });
});

describe('Less custom-property interpolation CST facts', () => {
  it('segments custom and ordinary interpolated property names around the shared VariableInterpolation fact', () => {
    const result = parseLessCst('.x { --theme-@{name[key]}-${tone}: red; pre-@{name[key]}-${tone}-post: blue; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const custom = findNode(result.tree, 'CustomDeclaration');
    const declaration = findNode(result.tree, 'Declaration');
    expect(custom).toBeDefined();
    expect(declaration).toBeDefined();
    expect(leafValues(custom!)).toEqual(['--', 'theme-', '@{', 'name', '[', 'key', ']', '}', '-', '${', 'tone', '}', ':', 'red']);
    expect(leafValues(declaration!)).toEqual(['pre-', '@{', 'name', '[', 'key', ']', '}', '-', '${', 'tone', '}', '-post', ':', ' ', 'blue']);
    expect(leafValues(result.tree).filter(value => value === ';')).toHaveLength(2);
    expect(findNodes(result.tree, 'VariableInterpolation').map(leafValues)).toEqual([
      ['@{', 'name', '[', 'key', ']', '}'],
      ['@{', 'name', '[', 'key', ']', '}']
    ]);
    expect(findNodes(result.tree, 'PropertyInterpolation').map(leafValues)).toEqual([
      ['${', 'tone', '}'],
      ['${', 'tone', '}']
    ]);
    expect(findNodes(result.tree, 'InterpolatedProperty').map(leafValues)).toEqual([
      ['pre-', '@{', 'name', '[', 'key', ']', '}', '-', '${', 'tone', '}', '-post']
    ]);
    expect(findNodes(result.tree, 'GatedInterpolatedProperty')).toHaveLength(0);
  });

  it('keeps valid interpolation typed instead of swallowing it in opaque custom-property chunks', () => {
    const input = '.x { --theme: pre-@{name}-post (@{map[key]}) [@{index}] { @{nested} }; }';
    const result = parseLessCst(input);

    expect(result.errors).toHaveLength(0);
    expect(findNodes(result.tree, 'VariableInterpolation').map(leafValues)).toEqual([
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
      expect(findNodes(result.tree, 'VariableInterpolation'), input).toHaveLength(0);
      expect(leafValues(result.tree).join(''), input).toContain(literal);
    }
  });

  it('rejects malformed interpolation-shaped property names instead of treating them as property text', () => {
    for (const input of [
      '.x { pre-@{ spaced }-post: red; }',
      '.x { pre-@{}-post: red; }',
      '.x { --theme-@{map.key}: red; }',
      '.x { --theme-${}: red; }',
      '.x { --theme-${ spaced }: red; }'
    ]) {
      const result = parseLessCst(input);
      expect(result.errors.length + Number(result.unconsumedFrom !== null), input).toBeGreaterThan(0);
    }
  });
});

describe('Less quoted and URL interpolation CST facts', () => {
  it('uses the semantic attribute and quoted owners for a CSS-compatible attribute selector', () => {
    const result = parseLessCst('.card[svg|title="Save" i] { color: red; }');

    expect(result.errors).toHaveLength(0);
    const attribute = findNode(result.tree, 'AttributeSelector');
    expect(attribute).toBeDefined();
    expect(findNode(attribute!, 'AttributeName')).toBeDefined();
    expect(findNode(attribute!, 'AttributeMatch')).toBeDefined();
    expect(findNode(attribute!, 'Quoted')).toBeDefined();
    for (const legacyLabel of [
      'StaticAttribute',
      'StaticAttributeName',
      'StaticAttributeMatch',
      'StaticAttributeQuoted'
    ]) {
      expect(findNode(result.tree, legacyLabel)).toBeUndefined();
    }
  });

  it('keeps quoted-string literal chunks and the typed interpolation body in source order', () => {
    const result = parseLessCst('.a { content: "pre-@{theme[variant]}-post"; }');
    expect(result.errors).toHaveLength(0);

    const quoted = findNode(result.tree, 'Quoted');
    expect(quoted).toBeDefined();
    expect(leafValues(quoted!)).toEqual(['"', 'pre-', '@{', 'theme', '[', 'variant', ']', '}', '-post', '"']);
    expect(leafValues(findNode(quoted!, 'VariableInterpolation')!)).toEqual(['@{', 'theme', '[', 'variant', ']', '}']);
  });

  it('uses that same quoted target structure inside url()', () => {
    const result = parseLessCst('.a { background: url("@{base}/icon.svg"); }');
    expect(result.errors).toHaveLength(0);

    const url = findNode(result.tree, 'Url');
    expect(url).toBeDefined();
    expect(leafValues(url!)).toEqual(['url(', '"', '@{', 'base', '}', '/icon.svg', '"', ')']);
    expect(findNode(url!, 'Quoted')).toBeDefined();
    expect(leafValues(findNode(url!, 'VariableInterpolation')!)).toEqual(['@{', 'base', '}']);
  });

  it('does not invent interpolation structure for escaped or non-Less-shaped text', () => {
    const result = parseLessCst('.a { a: "\\@{literal}"; b: "@{ spaced }"; }');
    expect(result.errors).toHaveLength(0);
    expect(findNode(result.tree, 'VariableInterpolation')).toBeUndefined();
  });
});

describe('Less selector interpolation CST facts', () => {
  it('keeps selector-token interpolation structural rather than absorbing it into selector text', () => {
    const result = parseLessCst('.@{name}-item, #tone-@{state} { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(findNodes(result.tree, 'VariableInterpolation').map(leafValues)).toEqual([
      ['@{', 'name', '}'],
      ['@{', 'state', '}']
    ]);
  });
});

describe('Less direct-AST closure CST contract', () => {
  /*
   * This is intentionally CST-only. It proves the grammar already owns each
   * valid statement boundary that a future single direct reducer must map in
   * one atomic pass; it must not introduce a partial AST-producing grammar.
   */
  const cases: readonly [label: string, source: string, grammarType: string][] = [
    ['top-level variable declaration', '@color: red;', 'VariableDeclaration'],
    ['detached-ruleset binding', '@theme: { color: red; };', 'VariableDeclaration'],
    ['top-level detached-ruleset call', '@rules();', 'VarCall'],
    ['nested detached-ruleset call', '.a { @rules(); }', 'VarCall'],
    ['query at-rule block', '@media (min-width: 1px) { .a { color: red; } }', 'QueryAtRuleBlock'],
    ['generic at-rule block', '@font-face { font-family: x; }', 'AtRuleBlock'],
    ['nested generic at-rule block', '.a { @layer utilities { color: red; } }', 'AtRuleBlock'],
    ['empty statement in generic at-rule block', '@foo { ; color: red; }', 'AtRuleBlock'],
    ['typed import fact', '@import (less) "theme.less";', 'ImportStatement'],
    ['at-rule statement', '@charset "utf-8";', 'AtRuleStatement'],
    ['ruleset', '.a { color: red; }', 'Ruleset'],
    ['top-level mixin definition', '.m(@x) { color: @x; }', 'MixinDefinition'],
    ['static mixin call', '.a { .m(1px, red); }', 'MixinCall'],
    ['important mixin call', '.a { .m(1px) !important; }', 'MixinCall'],
    ['namespaced mixin call', '.a { .library > .colors .tone(red); }', 'MixinCall'],
    ['named namespaced mixin call', '.a { .library > .colors .tone(@shade: red, @gap: 2px); }', 'MixinCall'],
    ['pattern and variadic mixin definition', '.m(red, @gap, @rest...) { color: @gap; }', 'MixinDefinition'],
    ['static mixin guard', '.m(@width) when (@width >= 20px) { width: @width; }', 'MixinDefinition'],
    ['logical mixin guard', '.m(@value) when (not (@value < 2) and iscolor(red), default()) { color: red; }', 'MixinDefinition'],
    ['each control statement', 'each(1, { color: red; });', 'For'],
    ['namespaced mixin-call each iterable', 'each(.library > .values(), { color: red; });', 'For'],
    ['bare function-call statement', 'e("x");', 'Call'],
    ['nested mixin definition', '.a { .m(@x) { color: @x; } }', 'MixinDefinition'],
    ['nested mixin call', '.a { .m(1); }', 'MixinCall'],
    ['nested extend instruction', '.a { &:extend(.b); }', 'ExtendStatement'],
    ['static pseudo selector', '.a:hover, .b::before { color: red; }', 'Ruleset'],
    ['static An+B pseudo selector', '.a:nth-child(odd), .b:nth-last-child(2n + 1) { color: red; }', 'Ruleset'],
    ['static attribute selector', '.a[data-state][role=button][title="Save" i] { color: red; }', 'Ruleset'],
    ['static namespace attribute selector', '.a[svg|role=button][*|data-state][|title="Save" i] { color: red; }', 'Ruleset'],
    ['static namespace type selector', 'svg|a, *|a, |a, svg|* { color: red; }', 'Ruleset'],
    ['ordinary declaration', '.a { color: red; }', 'Declaration'],
    ['merge and important declaration', '.a { box-shadow+: red !important; }', 'Declaration'],
    ['custom-property declaration', '.a { --theme: pre-@{name}; }', 'CustomDeclaration']
  ];

  it.each(cases)('keeps the %s boundary in the parser-owned CST', (_label, source, grammarType) => {
    const result = parseLessCstResult(source);

    expect(result.errors, source).toHaveLength(0);
    expect(result.unconsumedFrom, source).toBeNull();
    expect(hasNode(result.tree, grammarType), source).toBe(true);
  });

  it('keeps each( as one routed function-opener leaf', () => {
    const result = parseLessCstResult('each(1, { color: red; });');
    const loops = findNodes(result.tree, 'For');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(loops).toHaveLength(1);
    expect(leafValues(loops[0]!)[0]).toBe('each(');
    expect(leafValues(loops[0]!)).not.toContain('each');
  });

  it('keeps terminal generic calls on their single existing Call boundary', () => {
    for (const source of ['ordinary()', '.x { ordinary() }']) {
      const result = parseLessCstResult(source);

      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(findNodes(result.tree, 'Call'), source).toHaveLength(1);
    }
  });

  it('keeps direct inline extends under the public ExtendPseudo owner', () => {
    const result = parseLessCstResult('.first, .inline:extend(.target all), .sibling { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(findNodes(result.tree, 'InlineExtendTail')).toHaveLength(0);
    expect(findNodes(result.tree, 'ExtendPseudo').map(leafValues)).toEqual([
      [':', 'extend', '(', '.target', 'all', ')']
    ]);
    expect(findNodes(result.tree, 'Compound').map(leafValues)).toContainEqual(['.first']);
    expect(findNodes(result.tree, 'InlineExtendSubjectCompound').map(leafValues)).toEqual([
      ['.inline'],
      ['.sibling']
    ]);

    /*
     * `Complex`, `ExtendComplex` and `ExtendTargetComplex` all reduce with
     * `selectorBranchOf`, so they share the one label their node actually has.
     * The extend target is still pinned exactly — as the branch owned by the
     * `ExtendTarget` production, not by being the only node with a name.
     */
    expect(findNodes(result.tree, 'ComplexSelector').map(leafValues)).toEqual([
      ['.inline'],
      ['.target'],
      ['.sibling']
    ]);
    const extendTargets = findNodes(result.tree, 'ExtendTarget');
    expect(extendTargets).toHaveLength(1);
    expect(findNodes(extendTargets[0]!, 'ComplexSelector').map(leafValues)).toEqual([
      ['.target']
    ]);
  });

  it('names typed generic at-rule headers by their prelude value role', () => {
    const result = parseLessCstResult('@custom screen, print;');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(findNodes(result.tree, 'AtRulePreludeValue').map(leafValues)).toEqual([
      ['screen', ', ', 'print']
    ]);
    expect(findNodes(result.tree, 'AtRulePreludeValueTerm').map(leafValues)).toEqual([
      ['screen'],
      ['print']
    ]);
    expect(findNodes(result.tree, 'AtRulePreludeValueAtom').map(leafValues)).toEqual([
      ['screen'],
      ['print']
    ]);
  });

  it('routes static query identifiers and functions without widening url() into a query function', () => {
    const result = parseLessCstResult('@media screen and (width >= calc(10px + 1px)) and (height >= feature(1px, 2px)) { .card { color: red; } }');
    const badUrl = parseLessCstResult('@media (width >= url(foo)) { .card { color: red; } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(findNodes(result.tree, 'QueryIdentOrFunction')).toHaveLength(0);
    expect(findNodes(result.tree, 'Keyword').map(leafValues)).toContainEqual(['screen']);

    /* The sum operator leaf's value is the sign alone, matching the product
     * operator's. Its authored padding is the leaf's span, not its value. */
    expect(findNodes(result.tree, 'CalcCall').map(leafValues)).toContainEqual(['calc(', '10', 'px', '+', '1', 'px', ')']);
    expect(findNodes(result.tree, 'Call').map(leafValues)).toContainEqual(['feature(', '1', 'px', ', ', '2', 'px', ')']);
    expect(cstIssueCount(badUrl)).toBeGreaterThan(0);
  });

  it('keeps Less function-like openers glued in public CST owners', () => {
    const cases: readonly [source: string, grammarType: string, leaves: readonly string[]][] = [
      ['e("x");', 'Call', ['e(', '"', 'x', '"', ')']],
      ['.x { color: var(--accent); }', 'Call', ['var(', '--accent', ')']],
      ['.x { color: feature(1px, 2px); }', 'Call', ['feature(', '1', 'px', ', ', '2', 'px', ')']],
      ['.x { color: calc(1px + 2px); }', 'CalcCall', ['calc(', '1', 'px', '+', '2', 'px', ')']],
      ['.x { color: url(foo); }', 'Url', ['url(', 'foo', ')']],
      ['@supports selector(a:hover) { a { color: red; } }', 'EnclosedFunctionName', ['selector(']],
      ['@container style(--responsive: true) { .card { color: red; } }', 'ContainerStyleQuery', ['style(', '--responsive', ':', 'true', ')']]
    ];

    for (const [source, grammarType, leaves] of cases) {
      const result = parseLessCstResult(source);

      expect(cstIssueCount(result), source).toBe(0);
      expect(findNodes(result.tree, grammarType).map(leafValues), source).toContainEqual([...leaves]);
    }
  });

  it('keeps Less extend reserved for the glued inline-extend opener', () => {
    const valid = parseLessCstResult('.x:extend(.target) { color: red; }');
    const invalid = parseLessCstResult('.x:extend /* not glued */ (.target) { color: red; }');
    const uppercase = parseLessCstResult('.x:EXTEND(.target) { color: red; }');

    expect(cstIssueCount(valid)).toBe(0);
    expect(findNodes(valid.tree, 'ExtendPseudo').map(leafValues)).toContainEqual([':', 'extend', '(', '.target', ')']);
    expect(cstIssueCount(invalid)).toBeGreaterThan(0);
    expect(cstIssueCount(uppercase)).toBeGreaterThan(0);
  });

  it('preserves public CST owners for each structural query feature form', () => {
    const cases: readonly [source: string, grammarType: string][] = [
      ['@media (tv) { .card { color: red; } }', 'QueryBareFeature'],
      ['@media (min-width: 1px) { .card { color: red; } }', 'QueryColonFeature'],
      ['@media (width >= 1px) { .card { color: red; } }', 'QueryComparisonFeature'],
      ['@media (1px <= width) { .card { color: red; } }', 'QueryRangeFeature'],
      ['@container ((width < 500px) or (height < 500px)) { .card { color: red; } }', 'QueryLogicalGroup'],
      ['@container (not (height > 670px)) { .card { color: red; } }', 'QueryNegatedFeature']
    ];

    for (const [source, grammarType] of cases) {
      const result = parseLessCstResult(source);

      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(hasNode(result.tree, grammarType), source).toBe(true);
    }
  });

  it('accepts a final custom-property declaration without a semicolon', () => {
    const result = parseLessCst('.a { --theme: pre-@{name} }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(hasNode(result.tree, 'CustomDeclaration')).toBe(true);
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
