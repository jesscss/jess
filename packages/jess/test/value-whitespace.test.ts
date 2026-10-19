/**
 * A run of spaces or tabs inside a declaration value is written as one space, in every
 * dialect (owner 2026-10-13: "they're never meaningful unless in a custom property, so
 * they can be collapsed"). A custom-property value stays exactly as written, and an
 * authored line break with its indentation stays (owner 2026-09-06), so only a run on
 * one line collapses.
 */
import { describe, expect, it } from 'vitest';
import { serialize } from '@jesscss/core';
import { parse as parseCss } from '@jesscss/css-parser';
import { Compiler } from '../src/index.js';

const SOURCE = '.k { y: a   b; w: 1px  solid\tred; v: f(a   b,  c); z: a\n    b; --c: a   b; --d: a\t\tb; }';
const EXPECTED = '.k {\n  y: a b;\n  w: 1px solid red;\n  v: f(a b, c);\n  z: a\n    b;\n  --c: a   b;\n  --d: a\t\tb;\n}\n';

async function render(source: string, extension: '.css' | '.less' | '.scss' | '.jess'): Promise<string> {
  if (extension === '.css') {
    return String((await serialize(parseCss(source), { collapseNesting: false })).css);
  }
  return String(await new Compiler().renderString(source, { filePath: `entry${extension}`, extension, suppressWarnings: true }));
}

describe('owner 2026-10-13: "they\'re never meaningful unless in a custom property, so they can be collapsed"', () => {
  for (const extension of ['.css', '.less', '.scss', '.jess'] as const) {
    it(`writes a run of spaces or tabs in a value as one space, a custom property as written (${extension})`, async () => {
      await expect(render(SOURCE, extension)).resolves.toBe(EXPECTED);
    });
  }

  /* `.jess` does not parse a comment between two values yet (P45, owner-rulings.test.ts). */
  for (const extension of ['.css', '.less', '.scss'] as const) {
    it(`keeps a comment in a run and collapses the blanks around it (${extension})`, async () => {
      await expect(render('.k { x: a  /* c */   b; }', extension)).resolves.toBe('.k {\n  x: a /* c */ b;\n}\n');
    });
  }
});
