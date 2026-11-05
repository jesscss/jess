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
    ['a class argument', '.a { li:not(.active) { c: d; } }'],
    ['a relative argument', '.a { a:has(> img) { c: d; } }'],
    ['an attribute argument', '.a { input:not([type=text]) { c: d; } }'],
    ['a compound argument', '.a { li:not(a:hover) { c: d; } }'],
    ['a selector list', '.a { li:not(.active), li:hover { c: d; } }'],
    ['a descendant after it', '.a { li:not(.active) a { c: d; } }'],
    ['a combinator after it', '.a { li:is(.active) > a { d: e; } }'],
    ['a sibling after it', '.a { li:is(.active) ~ li:not(.disabled) { e: f; } }'],
    ['a rule in a mixin', '@mixin m { li:not(.active) { c: d; } }']
  ])('reads %s as a rule', (_label, source) => {
    const rules = source.startsWith('@') ? [] : (parse(source).rules[0] as { rules: Array<{ type: string }> }).rules;
    expect(() => parse(source)).not.toThrow();
    expect(rules.map(rule => rule.type).filter(type => type === 'Declaration')).toEqual([]);
  });

  it('still reads a declaration', () => {
    expect(parse('.a { transform:rotate(1deg); margin:calc(1px + 2px) auto; color:red; }')).toMatchObject({
      rules: [{ rules: [
        { type: 'Declaration', name: 'transform' },
        { type: 'Declaration', name: 'margin' },
        { type: 'Declaration', name: 'color' }
      ] }]
    });
  });

  /* Only a colon before a pseudo's name can open a selector, so the others keep the declaration. */
  it.each([
    ['a spaced colon', '.a {\n  margin: 0 auto\n  .title { color: red; }\n}'],
    ['a glued number', '.a {\n  margin:0 auto\n  .title { color: red; }\n}'],
    ['a glued negative number', '.a {\n  margin:-1px auto\n  .title { color: red; }\n}'],
    ['a glued variable', '.a {\n  margin:$gap auto\n  .title { color: red; }\n}']
  ])('keeps the rule after %s as a rule', (_label, source) => {
    expect(parse(source)).toMatchObject({
      rules: [{ rules: [
        { type: 'Declaration', name: 'margin' },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }
      ] }]
    });
  });

  it('keeps a number that opens an argument', () => {
    expect(parse('.a { x: f(.5); }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'FunctionCall', args: [{ value: { type: 'Dimension' } }] } }] }]
    });
  });
});
