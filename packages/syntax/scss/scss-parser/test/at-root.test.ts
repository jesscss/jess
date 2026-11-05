import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import { parse } from '@jesscss/scss-parser';
import { scssGrammar } from '../src/grammar.js';

/**
 * Every `@at-root` form parses (ledger P45). Foundation `scss/components/_off-canvas.scss`
 * writes the selector form inside a rule.
 */
describe('SCSS @at-root', () => {
  it('reads a selector prelude', () => {
    const source = '.off-canvas { @at-root .#{$maincontent-class} .off-canvas.position-#{$position} { transform: translateX(-$size); } }';
    expect(parse(source)).toMatchObject({
      rules: [{ rules: [{
        type: 'AtRuleBlock',
        name: '@at-root',
        prelude: { type: 'Any', src: '.#{$maincontent-class} .off-canvas.position-#{$position}' },
        rules: [{ type: 'Declaration', name: 'transform' }]
      }] }]
    });
  });

  it.each([
    ['a bare block', '.a { @at-root { b: c; } }', null],
    ['a filter', '.a { @at-root (with: media) { b: c; } }', { type: 'Any', src: '(with: media)' }],
    ['a selector list', '.a { @at-root .x, .y { b: c; } }', { type: 'Any', src: '.x, .y' }]
  ])('reads %s', (_label, source, prelude) => {
    expect(parse(source)).toMatchObject({
      rules: [{ rules: [{ type: 'AtRuleBlock', name: '@at-root', prelude, rules: [{ type: 'Declaration', name: 'b' }] }] }]
    });
  });

  it.each([
    ['a string', '"{"'],
    ['a length', '1px'],
    ['a selector and a length', '.x 1px'],
    ['a class with no name', '. b'],
    ['a leading combinator', '> .x'],
    ['a comment before', '/* c */ .x'],
    ['a comment after', '.x /* c */']
  ])('keeps a prelude that holds %s, as written', (_label, prelude) => {
    expect(parse(`.a { @at-root ${prelude} { b: c; } }`)).toMatchObject({
      rules: [{ rules: [{ type: 'AtRuleBlock', name: '@at-root', prelude: { type: 'Any', src: prelude } }] }]
    });
  });

  it('reads a prelude in a raw grammar run, which has no source to quote', () => {
    const result = run(scssGrammar.Stylesheet, '.a { @at-root .x { b: c; } }', { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
  });

  it('reads one in a mixin body', () => {
    expect(() => parse('@mixin m { @at-root #{&}-x { b: c; } }')).not.toThrow();
  });
});
