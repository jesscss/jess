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
 * function threw). Default `'preserve'` renders the call as-is silently;
 * `'error'` throws the underlying error (Less 4.x parity).
 */
const TD = resolveLessTestDataRoot();
const FIXTURES = [
  'tests-error/eval/unit-function',
  'tests-error/eval/percentage-non-number-argument',
  'tests-error/eval/color-func-invalid-color',
  'tests-error/eval/svg-gradient1'
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
  it('default \'preserve\' renders the call as-is silently', async () => {
    for (const f of FIXTURES) {
      const r = await makeCompiler().renderToResult(path.join(TD, `${f}.less`), { breakOnError: true } as any);
      // renders (no error) …
      expect(r.errors ?? []).toHaveLength(0);
      expect(r.css.length).toBeGreaterThan(0);

      // … without treating valid CSS-compatible output as a warning.
      expect(r.warnings ?? [], `${f} should preserve silently`).toHaveLength(0);
    }
  }, 60000);

  it('\'error\' throws the underlying Less function error', async () => {
    for (const f of FIXTURES) {
      const r = await makeCompiler({ functionMode: 'error' })
        .renderToResult(path.join(TD, `${f}.less`), { breakOnError: true } as any)
        .catch((e: any) => ({ errors: [{ message: String(e?.message) }] }));
      expect((r as any).errors?.length ?? 0, `${f} should error under functionMode:'error'`).toBeGreaterThan(0);
    }
  }, 60000);

  it('leaves unknown (non-registered) function names as-is WITHOUT warning, even in error mode', async () => {
    // `calc`/`madeup` are not registered functions → they render as-is via
    // name-resolution fallback, never reaching functionMode. No warning.
    const dir = mkdtempSync(path.join(tmpdir(), 'fm-'));
    const file = path.join(dir, 'a.less');
    writeFileSync(file, '.a { x: calc(1px + 2px); y: madeup(1, 2); }');
    const r = await makeCompiler({ functionMode: 'error' }).renderToResult(file, { breakOnError: true } as any);
    expect(r.warnings ?? []).toHaveLength(0);
    expect(r.css).toContain('madeup(1, 2)');
  }, 60000);
});
