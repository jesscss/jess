import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * `.less` guard equality — ONE answer per row.
 *
 * This file used to be `equality-mode.test.ts` and asserted a three-column
 * truth table, one column per `equalityMode`. That option is gone (§5.1): a
 * dialect front end lowers to the primitive that says what it means, and Less
 * `=` lowers to the LOOSE `.jess` `=`. So there is one column left, and the
 * rows that used to differ per mode are the interesting ones.
 *
 * Three rows MOVED, which is §5.2's admitted `.less` output shift: Less 4.x is
 * numbers-loose and text-STRICT, `.jess` `=` is loose on both, so a value now
 * equals its own spelling. `a = "a"`, `1 = "1"` and `red = "red"` were all
 * false on lessc 4.6.3 and are true here.
 */
async function matches(cond: string): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), 'eq-'));
  const f = path.join(dir, 'a.less');
  writeFileSync(f, `.m() when (${cond}) { hit: 1; }\n.a { .m(); }`);
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  });
  const css = await c.render(f, { breakOnError: false, suppressWarnings: true });
  return css.includes('hit');
}

describe('`.less` guard equality is loose on every ground', () => {
  it('numeric ground — a unitless side is a wildcard, compatible units convert', async () => {
    expect(await matches('1 = 1')).toBe(true);
    expect(await matches('1 = 1.0')).toBe(true);
    expect(await matches('2px = 2')).toBe(true);
    expect(await matches('2px = 2px')).toBe(true);
    expect(await matches('1in = 96px')).toBe(true);
  }, 60000);

  it('colour ground — rgb + alpha', async () => {
    expect(await matches('red = red')).toBe(true);
  }, 60000);

  /*
   * The §5.2 shift. Every row here answered FALSE on lessc 4.6.3 and on jess
   * before phase 4, because the quoted operand kept its quote characters when
   * the pair took string ground. A value equals its own spelling, so it does
   * not any more.
   */
  it('string ground — a value equals its own spelling (MOVED from Less 4.x)', async () => {
    expect(await matches('a = "a"')).toBe(true);
    expect(await matches('1 = "1"')).toBe(true);
    expect(await matches('red = "red"')).toBe(true);
    expect(await matches('"a" = "a"')).toBe(true);
  }, 60000);

  it('string ground is still a real comparison, not a coercion to true', async () => {
    expect(await matches('a = "b"')).toBe(false);
    expect(await matches('1 = "1px"')).toBe(false);
  }, 60000);
});
