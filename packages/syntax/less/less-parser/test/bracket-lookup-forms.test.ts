import { describe, expect, it } from 'vitest';
import type { Declaration, Ruleset } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/**
 * A Less lookup is an `if()` condition operand (ledger P45), and its bracket
 * accessor is glued: whitespace or a comment inside the brackets is no lookup.
 */
const withoutSpans = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, field: unknown) => (['_s', '_e', '_bs', '_be'].includes(key) ? undefined : field)));

function bodyOf(source: string): Ruleset['rules'] {
  const [rule] = parse(source).rules;
  return (rule as Ruleset).rules;
}

function valueOf(source: string): unknown {
  return withoutSpans((bodyOf(source)[0] as Declaration).value);
}

describe('a Less bracket accessor is glued', () => {
  it.each([
    '"@{m[ k ]}"',
    '"-@{m[ k ]}"',
    '\'@{m[ ]}\'',
    '~"@{m[ k ]}"'
  ])('%s stays string text', (quoted) => {
    expect(valueOf(`.a { x: ${quoted}; }`)).toMatchObject({ type: 'Quoted', interp: null });
  });

  it.each([
    '@map[ @k ]',
    '@map[ k ]',
    '@map[/* c */k]',
    '@map[ ]'
  ])('%s is not a lookup', (padded) => {
    expect(() => parse(`.a { x: ${padded}; }`)).toThrow();
  });
});

describe('a Less lookup is an if() condition operand', () => {
  it.each([
    'if((@map[k] = 2), yes, no)',
    'if(@map[k] = 2, yes, no)',
    'if((#ns.m()[@k] = 2), yes, no)'
  ])('%s', (call) => {
    const value = bodyOf(`.a { x: ${call}; }`)[0] as Declaration;
    expect(value.value).toMatchObject({
      type: 'IfValue',
      branches: [{ guard: { g: 'cmp', op: '=', left: { type: 'Reference' } } }, { guard: null }]
    });
  });
});
