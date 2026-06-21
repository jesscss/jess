import { parseFlatCssDeclarationStylesheet } from '../src/index.js';
import { N, isNode } from '@jesscss/core';

describe('parseFlatCssDeclarationStylesheet', () => {
  test('returns a string-backed core Stylesheet for cheap qualified rules', () => {
    const root = parseFlatCssDeclarationStylesheet('inline.css', `
      .a {
        color: red;
        background: blue !important;
        --gap:  1px 2px;
      }
    `);

    expect(root.type).toBe('Stylesheet');
    expect(isNode(root, N.Rules)).toBe(true);

    const firstRule = root.rules[0];
    expect(isNode(firstRule, N.Ruleset)).toBe(true);
    if (!isNode(firstRule, N.Ruleset)) {
      throw new Error('Expected a ruleset');
    }

    expect(firstRule.selector).toBe('.a');
    const [color, background, custom] = firstRule.rules.rules;
    expect(isNode(color, N.Declaration)).toBe(true);
    expect(isNode(background, N.Declaration)).toBe(true);
    expect(isNode(custom, N.Declaration)).toBe(true);
    if (!isNode(color, N.Declaration) || !isNode(background, N.Declaration) || !isNode(custom, N.Declaration)) {
      throw new Error('Expected declarations');
    }

    expect(color.name).toBe('color');
    expect(color.valueNode).toBe('red');
    expect(background.important).toBe('!important');
    expect(custom.name).toBe('--gap');
    expect(custom.valueNode).toBe('  1px 2px');
    expect(root.toTrimmedString()).toBe([
      '.a {',
      '  color: red;',
      '  background: blue !important;',
      '  --gap:  1px 2px;',
      '}',
      ''
    ].join('\n'));
  });
});
