/**
 * `collapseNesting` is the compiler's output option, not a dialect option. Owner
 * (2026-10-15): "collapseNesting is not language-specific. It's a serialization
 * option for the compiler. It applies for all Jess output regardless of sources,
 * including SCSS".
 *
 * So one stylesheet, written as `.css`, `.less`, `.scss` and `.jess`, gives the
 * same CSS under each mode, set in code or in a `styles.config` next to the input.
 * The input is one where `'native'` and `'compact'` differ: `.c` and `#d` do not
 * share a specificity, so `'native'` distributes them and `'compact'` folds them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CollapseNesting } from '@jesscss/core';
import { Compiler } from '../src/index.js';

const SOURCE = '.a, .b {\n  color: red;\n  .c, #d {\n    color: blue;\n  }\n}\n';

const NESTED = '.a,\n.b {\n  color: red;\n  .c,\n  #d {\n    color: blue;\n  }\n}\n';
const NATIVE = '.a,\n.b {\n  color: red;\n}\n:is(.a, .b) .c,\n:is(.a, .b) #d {\n  color: blue;\n}\n';
const COMPACT = '.a,\n.b {\n  color: red;\n}\n:is(.a, .b) :is(.c, #d) {\n  color: blue;\n}\n';

/* `true` is the deprecated alias of `'native'`. */
const MODES: [CollapseNesting, string][] = [
  [false, NESTED],
  ['native', NATIVE],
  ['compact', COMPACT],
  [true, NATIVE]
];

const DIALECTS = ['.css', '.less', '.scss', '.jess'] as const;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeEntries(config?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-collapse-nesting-'));
  tempDirs.push(dir);
  for (const extension of DIALECTS) {
    fs.writeFileSync(path.join(dir, `entry${extension}`), SOURCE);
  }
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'styles.config.js'), config);
  }
  return dir;
}

describe('output.collapseNesting applies the same to every source dialect', () => {
  it('native and compact give different CSS for this input', () => {
    expect(NATIVE).not.toBe(COMPACT);
  });

  for (const [mode, expected] of MODES) {
    it(`collapseNesting: ${JSON.stringify(mode)} set on the Compiler`, async () => {
      const dir = writeEntries();
      const compiler = new Compiler({ output: { collapseNesting: mode } });
      for (const extension of DIALECTS) {
        const result = await compiler.renderToResult(path.join(dir, `entry${extension}`), {});
        expect(result.errors, extension).toHaveLength(0);
        expect(result.css, extension).toBe(expected);
      }
    });

    it(`collapseNesting: ${JSON.stringify(mode)} set in a styles.config next to the input`, async () => {
      const dir = writeEntries(`module.exports = { output: { collapseNesting: ${JSON.stringify(mode)} } };\n`);
      for (const extension of DIALECTS) {
        const result = await new Compiler().renderToResult(path.join(dir, `entry${extension}`), {});
        expect(result.errors, extension).toHaveLength(0);
        expect(result.css, extension).toBe(expected);
      }
    });
  }

  it('is unset by default: nesting is kept', async () => {
    const dir = writeEntries();
    for (const extension of DIALECTS) {
      const result = await new Compiler().renderToResult(path.join(dir, `entry${extension}`), {});
      expect(result.errors, extension).toHaveLength(0);
      expect(result.css, extension).toBe(NESTED);
    }
  });
});
