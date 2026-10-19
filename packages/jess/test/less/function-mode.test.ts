import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { Compiler } from '../../src/index.js';
import { resolveLessTestDataRoot, lessHarnessFunctionsPlugin } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * `functionMode` — mirrors `unitMode`. Governs an optional/global function call
 * that matched a registered function but couldn't be evaluated (bad args, or the
 * function threw). Default `'preserve'` keeps it as a call, silently, with its
 * arguments evaluated and canonically spaced (`unit(80/16,rem)` →
 * `unit(80 / 16, rem)`); `'error'` throws the underlying error (Less 4.x parity).
 *
 * Every Less error fixture that renders only because of this default (ledger
 * C17), with the declaration it renders.
 */
const TD = resolveLessTestDataRoot();
const FIXTURES: ReadonlyArray<readonly [fixture: string, declaration: string]> = [
  ['tests-error/eval/color-func-invalid-color', 'color: color("NOT A COLOR");'],
  ['tests-error/eval/percentage-css-var', 'b: percentage(var(--x));'],
  ['tests-error/eval/percentage-non-number-argument', 'percentage: percentage(16 / 17);'],
  ['tests-error/eval/svg-gradient1', 'a: svg-gradient(horizontal, black, white);'],
  ['tests-error/eval/svg-gradient2', 'a: svg-gradient(to bottom, black, orange, 45%, white);'],
  ['tests-error/eval/svg-gradient3', 'a: svg-gradient(black, orange);'],
  ['tests-error/eval/svg-gradient4', 'a: svg-gradient(horizontal, black, white);'],
  ['tests-error/eval/svg-gradient5', 'a: svg-gradient(to bottom, black, orange, 45%, white);'],
  ['tests-error/eval/svg-gradient6', 'a: svg-gradient(black, orange);'],
  ['tests-error/eval/unit-function', 'font-size: unit(80 / 16, rem);']
];

function makeCompiler(compileExtra: Record<string, unknown> = {}) {
  return new Compiler({
    output: { collapseNesting: true },
    compile: {
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })],
      ...compileExtra
    }
  });
}

describe('functionMode', () => {
  it('default \'preserve\' keeps the call silently', async () => {
    for (const [f, declaration] of FIXTURES) {
      const r = await makeCompiler().renderToResult(path.join(TD, `${f}.less`), { breakOnError: true });
      expect(r.errors ?? [], `${f} should render`).toHaveLength(0);
      expect(r.css, `${f} should keep the call`).toContain(declaration);

      // Valid CSS-compatible output is not a warning.
      expect(r.warnings ?? [], `${f} should preserve silently`).toHaveLength(0);
    }
  }, 60000);

  it('\'error\' throws the underlying Less function error', async () => {
    for (const [f] of FIXTURES) {
      const r = await makeCompiler({ functionMode: 'error' })
        .renderToResult(path.join(TD, `${f}.less`), { breakOnError: true })
        .catch((error: unknown) => ({ errors: [error] }));
      expect(r.errors?.length ?? 0, `${f} should error under functionMode:'error'`).toBeGreaterThan(0);
    }
  }, 60000);

  it('evaluates a failing call in a variable only where the variable is referenced (lazy variables, R1)', async () => {
    // tests-error/eval/color-func-invalid-color-2 declares this variable and never reads it.
    const declared = '@base-color: darken(var(--baseColor, red), 50%);';
    const referenced = `${declared}\n.a { color: @base-color; }`;
    const options = { filePath: 'entry.less', extension: '.less' };

    await expect(makeCompiler({ functionMode: 'error' }).renderString(declared, options)).resolves.toBe('');
    await expect(makeCompiler({ functionMode: 'error' }).renderString(referenced, options))
      .rejects.toMatchObject({ code: 'eval/invalid-function', line: 1, column: 14 });
    await expect(makeCompiler().renderString(referenced, options))
      .resolves.toContain('color: darken(var(--baseColor, red), 50%)');
  }, 60000);

  it('leaves unknown (non-registered) function names as-is WITHOUT warning, even in error mode', async () => {
    /*
     * `calc`/`madeup` are not registered functions → they render as-is via
     * name-resolution fallback, never reaching functionMode. No warning.
     */
    const dir = mkdtempSync(path.join(tmpdir(), 'fm-'));
    const file = path.join(dir, 'a.less');
    writeFileSync(file, '.a { x: calc(1px + 2px); y: madeup(1, 2); }');
    const r = await makeCompiler({ functionMode: 'error' }).renderToResult(file, { breakOnError: true });
    expect(r.warnings ?? []).toHaveLength(0);
    expect(r.css).toContain('madeup(1, 2)');
  }, 60000);
});
