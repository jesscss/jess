import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/**
 * A nested rule opens like a declaration, `name:value`, until a later token
 * decides. An argument a value cannot hold must not end that reading before the
 * rule's own arm runs: `li:not(:last-child) {`, Foundation `docs/assets/scss/docs.scss`.
 */
describe('SCSS nested rule that opens with a functional pseudo', () => {
  it.each([
    ['a pseudo-class argument', '.a { li:not(:last-child) { b: c; } }'],
    ['a class argument', '.a { li:not(.b) { c: d; } }'],
    ['an id argument', '.a { li:is(#foo) { c: d; } }'],
    ['a universal argument', '.a { li:not(*) { c: d; } }'],
    ['a relative argument', '.a { li:has(> b) { c: d; } }'],
    ['a pseudo-element argument', '.a { li:not(::before) { c: d; } }'],
    ['an unknown pseudo', '.a { li:foo(.b) { c: d; } }'],
    ['a compound argument', '.a { li:not(a:hover) { c: d; } }'],
    ['a selector list', '.a { li:not(.b), x { c: d; } }'],
    ['a descendant after it', '.a { li:not(.b) x { c: d; } }'],
    ['a combinator after it', '.a { li:is(.b) > .c { d: e; } }'],
    ['a sibling after it', '.a { li:is(.b) ~ .c:not(.d) { e: f; } }'],
    ['a rule in a mixin', '@mixin m { li:not(.b) { c: d; } }']
  ])('reads %s as a rule', (_label, source) => {
    const rules = source.startsWith('@') ? [] : (parse(source).rules[0] as { rules: Array<{ type: string }> }).rules;
    expect(() => parse(source)).not.toThrow();
    expect(rules.map(rule => rule.type).filter(type => type === 'Declaration')).toEqual([]);
  });

  it('still reads a declaration', () => {
    expect(parse('.a { b:c(d); e:f(1, 2) g; h:i; }')).toMatchObject({
      rules: [{ rules: [
        { type: 'Declaration', name: 'b' },
        { type: 'Declaration', name: 'e' },
        { type: 'Declaration', name: 'h' }
      ] }]
    });
  });

  it('keeps a number that opens an argument', () => {
    expect(parse('.a { x: f(.5); }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'FunctionCall', args: [{ value: { type: 'Dimension' } }] } }] }]
    });
  });
});
