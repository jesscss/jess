import { describe, expect, it } from 'vitest';
import type { Declaration, Reference, Ruleset } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/**
 * Well-formed Less lookups parse (ledger P45): trivia inside a `[…]` accessor,
 * a lookup as an `if()` condition operand, and a mixin call's lookup/call chain
 * as a statement.
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

describe('Less bracket accessors read trivia around the key', () => {
  it.each([
    ['@map[ @k ]', '@map[@k]'],
    ['@map[ k ]', '@map[k]'],
    ['@map[/* c */k]', '@map[k]'],
    ['@map[\n  k // c\n]', '@map[k]'],
    ['@map[ @@k ]', '@map[@@k]'],
    ['@map[ $@k ]', '@map[$@k]'],
    ['@map[ 0 ]', '@map[0]'],
    ['@map[ ]', '@map[]'],
    ['@map[ a ][ b ]', '@map[a][b]'],
    ['#ns[ k ]', '#ns[k]'],
    ['.m()[ @k ]', '.m()[@k]']
  ])('%s reads as %s', (padded, glued) => {
    expect(valueOf(`.a { x: ${padded}; }`)).toEqual(valueOf(`.a { x: ${glued}; }`));
  });

  it.each([
    '"@{m[ k ]}"',
    '"-@{m[ k ]}"',
    '\'@{m[ ]}\'',
    '~"@{m[ k ]}"'
  ])('keeps an interpolation accessor glued: %s stays text', (quoted) => {
    expect(valueOf(`.a { x: ${quoted}; }`)).toMatchObject({ type: 'Quoted', interp: null });
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

describe('a mixin call continued by a lookup/call chain is a statement', () => {
  it.each([
    ['.m()[@k]();', '.m()[@k]()'],
    ['.m()[@k]()', '.m()[@k]()'],
    ['#ns.m(1)[@k]()[@j]();', '#ns.m(1)[@k]()[@j]()'],
    ['.m()[k].n(2);', '.m()[k].n(2)'],
    ['.m()[ @k ]();', '.m()[@k]()'],
    ['.m()[@k]( 1 );', '.m()[@k](1)']
  ])('%s', (statement, raw) => {
    const [reference] = bodyOf(`.x { ${statement} }`) as [Reference];
    expect(reference).toMatchObject({ type: 'Reference', base: { type: 'MixinCall' }, raw });
    expect(reference.steps.at(-1)).toMatchObject({ type: 'Call' });
  });

  it('reads a padded variable lookup call as the call', () => {
    expect(bodyOf('.x { @map[ @k ](); }')).toMatchObject([{ type: 'Reference', base: { type: 'Lookup' }, raw: '@map[@k]()' }]);
  });

  it('keeps a glued `.` as the next mixin call', () => {
    expect(bodyOf('.x { .m().n(); }').map(rule => rule.type)).toEqual(['MixinCall', 'MixinCall']);
  });

  it('keeps `!important` on a plain mixin call', () => {
    expect(bodyOf('.x { .m() !important; }')).toMatchObject([{ type: 'MixinCall', important: true }]);
  });
});
