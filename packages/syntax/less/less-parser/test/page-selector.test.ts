import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/less-parser';
import { parseLessCst } from '@jesscss/less-parser/cst';

type CstNode = { readonly _tag: string; readonly grammarType?: string; readonly value?: string; readonly rules?: readonly CstNode[] };

/* Each `PageSelector` node in the CST and the leaves it holds, in source order. */
function pageSelectors(source: string): string[][] {
  const found: string[][] = [];
  const walk = (node: CstNode): void => {
    if (node.grammarType === 'PageSelector') {
      found.push((node.rules ?? []).map(child => child.value ?? `<${child.grammarType}>`));
      return;
    }
    for (const child of node.rules ?? []) {
      walk(child);
    }
  };
  walk(parseLessCst(source).tree as CstNode);
  return found;
}

/*
 * A `<page-selector>` (css-page-3 §3) is a page name and the `<pseudo-page>`s
 * glued to it, with no whitespace between them, so the parser reads the glued
 * run as one token — the shared `PagePseudoRun` terminal after the name — and
 * never rebuilds it from parts.
 */
describe('a @page header reads each page selector as one token', () => {
  it.each([
    ['@page Test:first {}', [['Test:first']]],
    ['@page :left:blank {}', [[':left:blank']]],
    ['@page wide :left {}', [[':left']]],
    ['@page wide:left, narrow :right {}', [['wide:left'], [':right']]]
  ])('%s', (source, selectors) => {
    expect(pageSelectors(source)).toEqual(selectors);
  });

  it('keeps a header word and a spaced colon apart (`@foo bar: baz;`)', () => {
    expect(pageSelectors('@foo bar: baz;')).toEqual([]);
    expect(parse('@foo bar:baz;').rules[0]).toMatchObject({ prelude: { type: 'Any', src: 'bar:baz' } });
  });
});
