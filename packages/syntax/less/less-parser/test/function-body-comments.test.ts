import { describe, expect, it } from 'vitest';
import { serialize } from '@jesscss/core';
import { parse } from '@jesscss/less-parser';

/**
 * The CSS base rules that spell a function body's padding clear trivia themselves,
 * so a comment beside a delimiter stays in the tree in every dialect composed on them.
 */
describe('Less keeps the comments a CSS function body spells', () => {
  it.each([
    'if(a: 1 /* c */, 2; else: 3)',
    'if(media(print): a /* c */ ; else: b)'
  ])('%s', async (value) => {
    const { css } = await serialize(parse(`a { b: ${value}; }`));
    expect(css).toContain(`b: ${value};`);
  });
});
