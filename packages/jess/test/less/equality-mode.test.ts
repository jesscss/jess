import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * `equalityMode` — guard-comparison dialect. Behavior is verified against the
 * real engines (Less 4.6.3 + Dart Sass). Less and Sass diverge in OPPOSITE
 * directions, so these are dialects, not a strictness gradient:
 *   - `less`  = Less 4.x   (`2px = 2` ✓,  `a = "a"` ✗,  `red = "red"` ✗)
 *   - `sass`  = Dart Sass  (`2px = 2` ✗,  `a = "a"` ✓,  `red = "red"` ✗)
 *   - `exact` = no coercion (`2px = 2` ✗, `a = "a"` ✗) — stricter than both
 */
async function matches(cond: string, equalityMode: 'less' | 'sass' | 'exact'): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), 'eq-'));
  const f = path.join(dir, 'a.less');
  writeFileSync(f, `.m() when (${cond}) { hit: 1; }\n.a { .m(); }`);
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()], equalityMode }
  });
  const css = await c.render(f, { breakOnError: false, suppressWarnings: true } as any);
  return css.includes('hit');
}

// [expr, less, sass, exact] — the columns are the real-engine truth table.
const TRUTH: Array<[string, boolean, boolean, boolean]> = [
  ['1 = 1',      true,  true,  true],
  ['1 = "1"',    false, false, false],
  ['2px = 2',    true,  false, false],  // Less coerces unit↔unitless; Sass/exact don't
  ['2px = 2px',  true,  true,  true],
  ['1in = 96px', true,  true,  true],   // both engines convert compatible units
  ['red = red',  true,  true,  true],
  ['red = "red"', false, false, false], // Color vs string
  ['a = "a"',    false, true,  false],  // Sass: quote-insensitive strings; Less: keyword ≠ quoted
  ['"a" = "a"',  true,  true,  true],
  ['1 = 1.0',    true,  true,  true]
];

describe('equalityMode (verified vs Less 4.6.3 + Dart Sass)', () => {
  it('less mode matches Less 4.x', async () => {
    for (const [expr, less] of TRUTH) {
      expect(await matches(expr, 'less'), `less: ${expr}`).toBe(less);
    }
  }, 60000);

  it('sass mode matches Dart Sass', async () => {
    for (const [expr, , sass] of TRUTH) {
      expect(await matches(expr, 'sass'), `sass: ${expr}`).toBe(sass);
    }
  }, 60000);

  it('exact mode is no-coercion (stricter than both)', async () => {
    for (const [expr, , , exact] of TRUTH) {
      expect(await matches(expr, 'exact'), `exact: ${expr}`).toBe(exact);
    }
  }, 60000);
});
