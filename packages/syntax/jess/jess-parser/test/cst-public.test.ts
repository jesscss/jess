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

describe('@jesscss/jess-parser/cst', () => {
  it('parses Jess through the public core-free CST entry', () => {
    const result = parseJessCst('$color: red; .x { color: $color; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.tree.type).toBe('StyleSheet');
    expect(result.tree.rules.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoModeLabels(result.tree);
  });

  it('keeps collapse mode from dropping leaves or inventing Unknown nodes', () => {
    /*
     * A bare `${side}` selector owns a structural interpolation boundary in the
     * folded grammar. Collapse mode may keep that boundary, but it must never
     * drop authored leaves or degrade known Jess syntax to Unknown.
     */
    const src = '$color: red; ${side} { color: $color; }';
    const expanded = parseJessCst(src);
    const collapsed = parseJessCst(src, 'Stylesheet', { collapse: true });

    expect(expanded.errors).toHaveLength(0);
    expect(collapsed.errors).toHaveLength(0);
    expect([...stats(expanded.tree).types]).not.toContain('Unknown');
    expect([...stats(collapsed.tree).types]).not.toContain('Unknown');
    expect(stats(expanded.tree).types).toContain('VariableDeclaration');
    expect(stats(collapsed.tree).leaves).toBe(stats(expanded.tree).leaves);
    expect(collapsed.tree.rules.some(c => c._tag === 'node' && c.grammarType === 'VariableDeclaration')).toBe(true);
    expectNoModeLabels(expanded.tree);
    expectNoModeLabels(collapsed.tree);
  });

  it('uses structural interpolation nodes in selector interpolation', () => {
    const result = parseJessCst('.widget-${side}-${theme} { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('InterpolatedSimple')).toBe(1);
    expect(stats(result.tree).grammarTypes.get('DollarBrace')).toBe(2);
  });

  it('uses semantic CST labels for quoted and pseudo-selector syntax', () => {
    const result = parseJessCst('@charset "UTF-8"; .a:not(.b) { color: red; } .c:nth-child(2n of .d) { color: blue; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('Quoted')).toBe(1);
    expect(grammarTypes.get('PseudoSelectorArgument')).toBe(1);
    expect(grammarTypes.get('PseudoSelectorList')).toBeGreaterThan(0);
    expect(grammarTypes.get('PseudoSelectorCompound')).toBeGreaterThan(0);
    expect(grammarTypes.get('NthChildArgument')).toBe(1);
    expect([...grammarTypes.keys()].filter(type => type.startsWith('Static'))).toEqual([]);
  });

  it('reuses the semantic Quoted slot for static attribute values', () => {
    const result = parseJessCst('[data-kind="primary" i] { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('AttributeSelector')).toBe(1);
    expect(grammarTypes.get('Quoted')).toBe(1);
    expectNoModeLabels(result.tree);
  });

  it('uses semantic CST labels for CSS at-rule preludes and headers', () => {
    const result = parseJessCst('@media screen and (width >= 1px), print { .a { color: red; } } @container card (width > 1px) { .b { color: blue; } } @unknown screen;');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('AtRulePrelude')).toBeGreaterThan(0);
    expect(grammarTypes.get('AtRulePreludeTerm')).toBeGreaterThan(0);
    expect(grammarTypes.get('QueryFeature')).toBeGreaterThan(0);
    expect(grammarTypes.get('QueryComparisonFeature')).toBeGreaterThan(0);
    expect(grammarTypes.get('QueryFeatureName')).toBeGreaterThan(0);
    expect(grammarTypes.get('QueryValue')).toBeGreaterThan(0);
    expect(grammarTypes.get('QueryClause')).toBe(2);
    expect(grammarTypes.get('QueryPrelude')).toBeGreaterThan(0);
    expect(grammarTypes.get('AtRuleStatementHeader')).toBe(1);
    expect([...grammarTypes.keys()].filter(type => type.startsWith('Static'))).toEqual([]);
  });

  it('keeps constrained CSS-header value helpers private to the Jess grammar', () => {
    const result = parseJessCst('@property --theme { syntax: fn(1px, "x"); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    const { grammarTypes } = stats(result.tree);
    expect(grammarTypes.get('ValueAtom')).toBeGreaterThan(0);
    expect(grammarTypes.get('Value')).toBeGreaterThan(0);
    expect(grammarTypes.get('CallArgument')).toBeGreaterThan(0);
    expect(grammarTypes.get('Call')).toBeGreaterThan(0);
    expect([...grammarTypes.keys()].filter(type => type.startsWith('Plain'))).toEqual([]);
  });

  /*
   * The editor route must recognize `${…}` too, or valid source that compiles
   * would light up red in the language service. Selector interpolation and value
   * interpolation are SEPARATE routes because they occupy disjoint positions — the editor has to
   * reject what the compiler rejects, not merely accept what it accepts.
   */
  it('uses structural DollarBrace nodes for the ${…} interpolation form', () => {
    const result = parseJessCst('.widget-${side}-${[theme]} { color: red; }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('InterpolatedSimple')).toBe(1);
    expect(stats(result.tree).grammarTypes.get('DollarBrace')).toBe(2);
  });

  // The position split, in the route the editor actually uses.
  it('rejects each $ form outside the position it belongs to', () => {
    const bad = (src: string) => {
      const r = parseJessCst(src);
      return r.errors.length > 0 || r.unconsumedFrom !== null;
    };

    expect(bad('.card { color: ${tone}; }'), 'value ${…}').toBe(true);
    expect(bad('.card-$[side] { a: b; }'), 'identifier $[…]').toBe(true);
    expect(bad('.card { content: "f-$[family]"; }'), 'string $[…]').toBe(true);

    // …and the spellings that DO belong stay accepted.
    expect(bad('.card { color: $[tone]; }'), 'value $[…]').toBe(false);
    expect(bad('.card-${side} { a: b; }'), 'identifier ${…}').toBe(false);
    expect(bad('.card { content: "f-${family}"; }'), 'string ${…}').toBe(false);
  });

  /*
   * A `${…}` inside a quoted string has to break the string into structured
   * parts — otherwise the fast flat-string path swallows it as literal bytes and
   * the editor shows no interpolation at all.
   */
  it('structures ${…} inside a quoted string without disturbing plain strings', () => {
    const interpolated = parseJessCst('.a { content: "font-${family}.woff"; }');

    expect(interpolated.errors).toHaveLength(0);
    expect(interpolated.unconsumedFrom).toBeNull();
    expect(stats(interpolated.tree).grammarTypes.get('DollarBrace')).toBe(1);

    // A lone `$` that opens nothing stays literal text inside the flat string.
    const plain = parseJessCst('.a { content: "costs $5 and $x too"; }');

    expect(plain.errors).toHaveLength(0);
    expect(plain.unconsumedFrom).toBeNull();
    expect(stats(plain.tree).grammarTypes.get('DollarBrace')).toBeUndefined();
  });

  it('keeps CSS import targets static while unquoted value URLs retain ${…} templates', () => {
    const result = parseJessCst('@import url(theme.css) supports(display: grid); .asset { image: url(images/${file}.svg); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('ImportStatement')).toBeGreaterThan(0);
    expect(stats(result.tree).grammarTypes.get('Url')).toBeGreaterThan(0);
    expect(stats(result.tree).grammarTypes.get('UrlInterpolatedValue')).toBeGreaterThan(0);
  });

  it('rejects runtime values in a bare CSS @import', () => {
    for (const source of [
      '@import url(${path});',
      '@import "${path}.css";',
      '@import "theme.css" $media;'
    ]) {
      const result = parseJessCst(source);
      expect(result.errors.length + Number(result.unconsumedFrom !== null), source).toBeGreaterThan(0);
    }
  });

  it('keeps documented expression arithmetic in the public CST route', () => {
    const result = parseJessCst('$w: 2px; .card { width: $($w * 2 + 1px); slash: $($w / 2); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();

    /*
     * Expression operators belong behind `$()`. A normal value position should
     * not accept this arithmetic grammar directly.
     */
    expect(stats(result.tree).grammarTypes.get('ExpressionProduct')).toBeGreaterThan(0);
    expect(stats(result.tree).grammarTypes.get('ExpressionAtom')).toBeGreaterThan(0);
    expectNoModeLabels(result.tree);

    const normalValue = parseJessCst('$w: 2px; .card { width: $w * 2 + 1px; }');
    expect(normalValue.errors.length + Number(normalValue.unconsumedFrom !== null)).toBeGreaterThan(0);
  });

  it('keeps leading-dot declaration lookup expression-only in the public CST route', () => {
    const result = parseJessCst('$tokens: { tone: blue; }; .card { value: $(.type.isnumber(.math.e)); root: $($.tokens.tone); ns: $($tokens.tone); decimal: $(.1); }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('ExpressionDeclarationReference')).toBeGreaterThan(0);
    expect(stats(result.tree).grammarTypes.get('ReferenceDotTail')).toBeGreaterThan(0);
    expect(stats(result.tree).grammarTypes.get('ExpressionAtom')).toBeGreaterThan(0);
    expectNoModeLabels(result.tree);

    const normalLookup = parseJessCst('.card { value: .type.isnumber(.math.e); }');
    expect(normalLookup.errors.length + Number(normalLookup.unconsumedFrom !== null)).toBeGreaterThan(0);

    const normalDecimal = parseJessCst('.card { value: .1; }');
    expect(normalDecimal.errors).toHaveLength(0);
    expect(normalDecimal.unconsumedFrom).toBeNull();
  });

  it('uses unprefixed structural nodes for documented $for loops', () => {
    const result = parseJessCst('$for ($item of $items) { .item { value: $item; } }');

    expect(result.errors).toHaveLength(0);
    expect(result.unconsumedFrom).toBeNull();
    expect(stats(result.tree).grammarTypes.get('For')).toBe(1);
    expectNoModeLabels(result.tree);
  });

  it('rejects malformed selector interpolation instead of swallowing it as a token', () => {
    const result = parseJessCst('.widget-${side { color: red; }');

    expect(result.errors.length + Number(result.unconsumedFrom !== null)).toBeGreaterThan(0);
  });
});
