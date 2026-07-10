import { describe, it, expect } from 'vitest';
import { Parser } from '../src/jess.js';
import { Context } from '@jesscss/core';

// A comma-list VALUE interpolated into a selector position is an error in v5 — you can't
// splice a list into a selector; use each() to distribute. (v4 silently produced a
// dangling `.fruit-apple, satsuma`.)
describe('comma-list value in selector interpolation', () => {
  const render = async (code: string): Promise<string> => {
    const { tree } = new Parser().parse(code);
    const ctx = new Context({ output: { collapseNesting: true } });
    return (await tree.render(ctx, { context: ctx, collapseNesting: true })).trim();
  };
  it('errors on `.fruit-@{list}` when @list is a comma-list', async () => {
    await expect(render('@list: apple, satsuma; .fruit-@{list} { color: red; }'))
      .rejects.toThrow(/comma|list|each\(\)/i);
  });
});
