import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A paren group around a comma list is well-formed CSS (css-syntax-3 §5.4.8),
 * so Less parses it (ledger P45), and a paren group written in a Less value
 * keeps its parens (ledger J16). The `.scss` rule that writes such a group
 * without its parens (J16's `.scss` amendment) is SCSS's alone.
 */
const render = async (source: string): Promise<string> =>
  (await new Compiler({}).renderString(source, { extension: '.less' })).replace(/\s+/g, ' ').trim();

const cases: ReadonlyArray<readonly [source: string, expected: string]> = [
  ['.x { y: (1, 2); }', '.x { y: (1, 2); }'],
  ['.x { y: foo((c, d), e); }', '.x { y: foo((c, d), e); }'],
  ['.x { y: (a b, c d); }', '.x { y: (a b, c d); }'],
  ['.x { y: var(--x, (1, 2)); }', '.x { y: var(--x, (1, 2)); }'],
  ['.x { y: ((1, 2), (3, 4)); }', '.x { y: ((1, 2), (3, 4)); }'],
  ['@l: (1, 2); .x { y: @l; }', '.x { y: (1, 2); }'],
  ['@media (min-width: (1, 2)) { .x { y: z; } }', '@media (min-width: (1, 2)) { .x { y: z; } }']
];

describe('less: a paren group around a comma list parses and keeps its parens', () => {
  it.each(cases)('%s', async (source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('keeps the comments around its commas as the css group keeps them', async () => {
    const source = '.x { y: (1 /* a */, /* b */ 2); }';
    const css = (await new Compiler({}).renderString(source, { extension: '.css' })).replace(/\s+/g, ' ').trim();
    await expect(render(source)).resolves.toBe(css);
  });

  /* A paren group in a mixin argument already writes its content (`(1px 2px)` → `1px 2px`); a list does the same. */
  it('parses one as a mixin parameter default', async () => {
    await expect(render('.m(@a: (1, 2)) { y: @a; } .x { .m(); }')).resolves.toBe('.x { y: 1, 2; }');
  });

  it('leaves a math group as it was', async () => {
    await expect(render('.x { a: (1 + 2); b: (4/2); c: (1px 2px); }')).resolves.toBe('.x { a: 3; b: 2; c: (1px 2px); }');
  });
});
