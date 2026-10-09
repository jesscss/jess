import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { Context, serialize } from '@jesscss/core';
import { isGluedConditionKeyword, sourceEndOf, sourceStartOf } from '@jesscss/core/ast';
import type { FunctionCall, ValueNode, ValueSlot } from '@jesscss/core/ast';

/**
 * `and(` / `or(` / `not(` is one `<function-token>` (css-syntax-3 §4.3.4), so in
 * a condition it is a `<general-enclosed>` function, never the keyword, and the
 * condition never matches (media-queries-4 §3.2). The parser keeps it as that
 * call, with its span, and the prelude is written as authored with one
 * `css/glued-condition-keyword` warning (owner ruling 2026-10-09, ledger N17).
 */
const GLUED: ReadonlyArray<readonly [prelude: string, call: string]> = [
  ['@media screen and(max-width: 1280px)', 'and(max-width: 1280px)'],
  ['@media (a) or(b)', 'or(b)'],
  ['@media not(color)', 'not(color)'],
  ['@media (not(hover))', 'not(hover)'],
  ['@media only screen and(color)', 'and(color)'],
  ['@container (a) and(b)', 'and(b)'],
  ['@container not(width > 1px)', 'not(width > 1px)'],
  ['@container ((a) and(b))', 'and(b)'],
  ['@container (not(b))', 'not(b)'],
  ['@supports not(display: grid)', 'not(display: grid)'],
  ['@supports NOT(display: grid)', 'NOT(display: grid)'],
  ['@supports (a: b) and(c: d)', 'and(c: d)'],
  ['@supports (a: b) or(c: d)', 'or(c: d)'],
  ['@supports ((a: b) and(c: d))', 'and(c: d)']
];

async function render(prelude: string) {
  const context = new Context({});
  const sheet = parse(`${prelude} { a { b: c } }`);
  const css = (await serialize(sheet, { context })).css;
  return {
    prelude: css.slice(0, css.indexOf('{')).trimEnd(),
    codes: context.warnings.map(warning => warning.code),
    sheet
  };
}

/* The glued keyword calls the parser built in a prelude, walked through its structure. */
function gluedCalls(value: ValueSlot | null, found: FunctionCall[] = []): FunctionCall[] {
  if (value === null) {
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value as readonly ValueNode[]) {
      gluedCalls(item, found);
    }
    return found;
  }
  if (isGluedConditionKeyword(value)) {
    found.push(value);
  } else if (value.type === 'Sequence') {
    gluedCalls(value.parts, found);
  } else if (value.type === 'List' || value.type === 'Block') {
    gluedCalls(value.value, found);
  }
  return found;
}

describe('a glued condition keyword is a general-enclosed function written as authored', () => {
  it.each(GLUED)('%s', async (prelude, call) => {
    const source = `${prelude} { a { b: c } }`;
    const rendered = await render(prelude);
    expect(rendered.prelude).toBe(prelude);
    expect(rendered.codes).toEqual(['css/glued-condition-keyword']);
    const rule = rendered.sheet.rules[0];
    if (rule?.type !== 'AtRuleBlock') {
      throw new Error('expected an at-rule block');
    }
    const calls = gluedCalls(rule.prelude);
    expect(calls.map(node => source.slice(sourceStartOf(node), sourceEndOf(node)))).toEqual([call]);
  });

  it.each([
    '@media screen and (max-width: 1280px)',
    '@media not all and (color)',
    '@container size(min-width: 60ch)',
    '@container not (width > 1px)',
    '@supports not (display: grid)',
    '@supports (a: b) and (c: d)',
    '@supports selector(a > b)'
  ])('%s keeps its keyword and does not warn', async (prelude) => {
    const rendered = await render(prelude);
    expect(rendered.prelude).toBe(prelude);
    expect(rendered.codes).toEqual([]);
  });

  it('reads a spaced not as the keyword and a glued not( as one function', () => {
    const preludeOf = (source: string) => {
      const rule = parse(`${source} { a { b: c } }`).rules[0];
      if (rule?.type !== 'AtRuleBlock' || rule.prelude === null || Array.isArray(rule.prelude)) {
        throw new Error('expected an at-rule prelude');
      }
      return rule.prelude as ValueNode;
    };
    expect(preludeOf('@supports not (a: b)')).toMatchObject({ type: 'Sequence', parts: [{ type: 'Keyword', src: 'not' }, { type: 'Block' }] });
    expect(preludeOf('@supports not(a: b)')).toMatchObject({ type: 'FunctionCall', name: 'not' });
  });
});

/* No whitespace is allowed inside a `<page-selector>` (css-page-3 §3); either way it is written as authored. */
describe('a @page selector is written as authored', () => {
  it.each(['@page Test:first', '@page :left:blank', '@page Test :first'])('%s', async (prelude) => {
    const css = (await serialize(parse(`${prelude} { size: a4 }`))).css;
    expect(css.slice(0, css.indexOf('{')).trimEnd()).toBe(prelude);
  });
});
