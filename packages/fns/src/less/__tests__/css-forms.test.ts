import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate } from '../../../scripts/build-css-forms.mjs';
import { parse } from '../../../../syntax/jess/jess-parser/src/index.js';

describe('the CSS forms', () => {
  it('ship as the parse of their source: run `pnpm build:forms`', () => {
    const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(generate(parse, read('css-forms.jess'))).toBe(read('css-forms.generated.ts'));
  });
});
