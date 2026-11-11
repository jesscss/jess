import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import scssPlugin from '@jesscss/plugin-scss';

const CODE = 'parse/at-root-placement';
const compile = (source: string, extension = '.scss') => new Compiler().renderString(source, { extension });

/**
 * `@at-root` moves a rule in the output and nothing carries that yet (ledger P10), so
 * it parses and then fails the compile at the at-rule (P45). `sass` 1.101.7 writes
 * `.x .y { e: f; }` for the first source below; there is no output here to compare.
 */
describe('SCSS @at-root in a compile', () => {
  it.each([
    ['a selector prelude', 'a { b: c; }\n.d {\n  @at-root .x .y { e: f; }\n}\n', 3, 3],
    ['a bare block', 'a { b: c; }\n.d {\n  @at-root { e: f; }\n}\n', 3, 3],
    ['a filter', 'a { b: c; }\n.d {\n  @at-root (with: media) { e: f; }\n}\n', 3, 3],
    ['one a mixin brings in', '@mixin m { @at-root .x { e: f; } }\n.d {\n  @include m;\n}\n', 1, 12]
  ])('%s parses, then is an error at the at-rule', async (_label, source, line, column) => {
    const parsed = scssPlugin().safeParse!('/proj/at-root.scss', source);
    expect(parsed.errors).toEqual([]);
    await expect(compile(source)).rejects.toMatchObject({ code: CODE, line, column });
  });

  it('reports nothing for a mixin that is not called', async () => {
    await expect(compile('@mixin m { @at-root .x { e: f; } }\n.d { g: h; }\n')).resolves.toBe('.d {\n  g: h;\n}\n');
  });

  it.each(['.css', '.less', '.jess'])('%s keeps @at-root as an unknown at-rule', async (extension) => {
    expect(await compile('@at-root .x { b: c; }', extension)).toContain('@at-root .x');
  });
});
