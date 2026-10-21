import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { parseCssCst } from '@jesscss/css-parser/cst';
import { forgivenSelectorItemsOf, sourceEndOf, sourceStartOf } from '@jesscss/core/ast';
import type { PseudoSelector, SelectorBranch } from '@jesscss/core/ast';
import { serialize } from '@jesscss/core';

/**
 * `:is()` and `:where()` take a `<forgiving-selector-list>` (Selectors 4 §4.2,
 * §4.4, §16.1): an item that is not a selector is dropped by a browser and the
 * others still match, so `.card:is(.active, 1px)` matches as
 * `.card:is(.active)`, and `.a:is(1px)` / `.a:is()` are valid selectors that
 * match nothing. Owner 2026-10-20: "it should parse then... sure warning is
 * ok". The item is kept as written, and the document records it for the
 * compiler's `css/forgiving-selector-item` warning.
 */
function pseudoOf(source: string): PseudoSelector {
  const rule = parse(source).rules[0];
  if (rule?.type !== 'Ruleset') {
    throw new Error(`Expected a rule for ${source}`);
  }
  const branch = rule.selector.selectors[0];
  const tokens = branch?.type === 'CompoundSelector' ? branch.value : [];
  const pseudo = tokens.find(token => token.type === 'PseudoSelector');
  if (pseudo?.type !== 'PseudoSelector') {
    throw new Error(`Expected a structured pseudo in ${source}`);
  }
  return pseudo;
}

function itemTypes(pseudo: PseudoSelector): string[] {
  return (pseudo.args?.selectors ?? []).map((branch: SelectorBranch) => branch.type);
}

describe('the forgiving selector list of :is() and :where()', () => {
  it.each([
    ['.card:is(.active, 1px) { color: red; }', '.card:is(.active, 1px) {\n  color: red;\n}\n', [['1px', 18]]],
    ['.a:is(1px) { color: red; }', '.a:is(1px) {\n  color: red;\n}\n', [['1px', 6]]],
    ['.x:where(2n+1) { color: red; }', '.x:where(2n+1) {\n  color: red;\n}\n', [['2n+1', 9]]],
    ['.a:is() { color: red; }', '.a:is() {\n  color: red;\n}\n', []],
    [':is(.card, ) { color: red; }', ':is(.card, ) {\n  color: red;\n}\n', []],
    ['.x:is( .a , .b ) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n', []],
    ['.x:is(.a 1px, .b) { color: red; }', '.x:is(.a 1px, .b) {\n  color: red;\n}\n', [['.a 1px', 6]]],
    ['.x:is(.b, {x,y}) { color: red; }', '.x:is(.b, {x,y}) {\n  color: red;\n}\n', [['{x,y}', 10]]]
  ] as const)('parses %s, keeps it as written and records each item that is not a selector', (source, css, forgiven) => {
    const document = parse(source);
    expect(serialize(document).css).toBe(css);
    expect(forgivenSelectorItemsOf(document).map(item => [item.text, sourceStartOf(item)])).toEqual(forgiven);
    for (const item of forgivenSelectorItemsOf(document)) {
      expect(source.slice(sourceStartOf(item), sourceEndOf(item))).toBe(item.text);
    }
  });

  it('keeps the selectors of a forgiving list structured beside the kept item', () => {
    const pseudo = pseudoOf('.card:is(.active, 1px) { color: red; }');
    expect(pseudo).toMatchObject({ name: ':is', crossable: true });
    expect(itemTypes(pseudo)).toEqual(['SimpleSelector', 'SimpleSelector']);
    expect(pseudo.args?.selectors.map(branch => branch.type === 'SimpleSelector' ? branch.text : null)).toEqual(['.active', '1px']);
  });

  it('reads the CST with no error', () => {
    for (const source of ['.card:is(.active, 1px) { color: red; }', '.a:is() { color: red; }', '.x:where(2n+1) { color: red; }']) {
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
    }
  });

  it('records nothing for a list of selectors', () => {
    expect(forgivenSelectorItemsOf(parse('.x:is(.a, .b) { color: red; }'))).toEqual([]);
  });

  /* `:not()` takes a `<complex-real-selector-list>` and `:has()` a `<relative-selector-list>`: neither forgives. */
  it.each([
    '.x:not(2n+1) { color: red; }',
    '.x:has(2n+1) { color: red; }'
  ])('still rejects %s', (source) => {
    expect(() => parse(source)).toThrow();
  });
});
