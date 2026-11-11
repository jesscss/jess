import { describe, expect, it } from 'vitest';
import scssPlugin from '@jesscss/plugin-scss';
import { Compiler } from '../../src/index.js';

const CODE = 'parse/invalid-rule-prelude';
const SOURCE = 'a { b: c; }\n.a {\n  font:bold 12px serif\n  .title { color: red; }\n}\n';

/**
 * It parses, with the error on the prelude, and the compile stops on that error
 * (ledger P45, P47). `sass` 1.101.7 rejects this source, so there is no output to compare.
 */
describe('SCSS rule whose prelude no selector reads, in a compile', () => {
  it('keeps the document and reports the prelude', () => {
    const parsed = scssPlugin().safeParse!('/proj/prelude.scss', SOURCE);
    expect(parsed.document).toBeDefined();
    expect(parsed.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 3, 3]]);
  });

  it('fails the compile with the same code', async () => {
    await expect(new Compiler().renderString(SOURCE, { extension: '.scss' })).rejects.toMatchObject({ code: CODE, line: 3, column: 3 });
  });
});
