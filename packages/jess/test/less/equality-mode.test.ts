import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * `equalityMode` — the JS `==` vs `===` split for guard comparisons.
 * - `loose` (Less default): cross-type operands can compare equal (`2px = 2`).
 * - `strict` (SCSS default): operands must be the same node type.
 */
async function guardMatches(cond: string, equalityMode?: 'loose' | 'strict'): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), 'eq-'));
  const f = path.join(dir, 'a.less');
  writeFileSync(f, `.m() when (${cond}) { hit: 1; }\n.a { .m(); }`);
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()], ...(equalityMode ? { equalityMode } : {}) }
  });
  const css = await c.render(f, { breakOnError: false, suppressWarnings: true } as any);
  return css.includes('hit');
}

describe('equalityMode', () => {
  it("default 'loose' compares cross-type operands equal", async () => {
    expect(await guardMatches('1 = 1')).toBe(true);
    expect(await guardMatches('2px = 2')).toBe(true);       // Dimension = Num
    expect(await guardMatches('red = "red"')).toBe(true);   // Keyword = Quoted
  }, 60000);

  it("'strict' requires same node type", async () => {
    expect(await guardMatches('1 = 1', 'strict')).toBe(true);        // same type
    expect(await guardMatches('2px = 2', 'strict')).toBe(false);     // Dimension vs Num
    expect(await guardMatches('red = "red"', 'strict')).toBe(false); // Keyword vs Quoted
  }, 60000);
});
