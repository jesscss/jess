import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';
import cssPlugin from '@jesscss/plugin-css';

/**
 * `min()`/`max()` are CSS, so all four dialects owe the same answer.
 *
 * CSS Values and Units 4 § 10.2 defines `min()`/`max()` over "a comma-separated
 * list of one or more calculations"; § 10.1 requires the arguments to resolve to
 * a common type. `max(1px, 2em)` is therefore VALID CSS that the browser
 * resolves at used-value time. A dialect that rejects it — or that quietly
 * rewrites it — is not a CSS superset.
 *
 * Every `PRESERVED` case below was checked against lessc 4.8.0, which emits the
 * call verbatim and exits 0, and (except where noted) dart-sass 1.101.0's global
 * form. The four multi-argument cases are the regression this file exists for:
 * jess used to partially reduce them per unit group (`max(1px, 2em, 3px)` →
 * `max(3px, 2em)`), matching NEITHER reference.
 */

const REDUCED: Array<[string, string]> = [
  ['max(1px, 2px)', '2px'],
  ['max(1px, 1in)', '1in'],
  ['max(3, 1cm)', '3'],
  ['min(3, 1cm)', '1cm'],
  ['min(2px, 1)', '1'],
  ['max(1px)', '1px']
];

const PRESERVED = [
  'max(1px, 2em)',
  'max(1px, 2em, 3px)',
  'min(1px, 3px, 2em, 1em)',
  'max(10px, 2em, 1in)',
  'min(1px, 1%, 2px)',
  // `px` vs `s` is length-vs-time and genuinely invalid per § 10.1 — dart-sass
  // errors on it. It PRESERVES here on purpose: strictness is a property of the
  // CALL FORM, and a bare call could be a CSS function this compiler does not
  // know. Do not "fix" this against dart-sass; a validity diagnostic for it
  // belongs in the language service, not the evaluator.
  'min(1px, 2s)',
  'min(a, b)',
  'max(1px, red)',
  'min(1px, var(--x))',
  'min()'
];

const DIALECTS = ['.css', '.less', '.scss', '.jess'] as const;

const render = async (compiler: Compiler, expr: string, extension: string): Promise<string> => {
  const output = await compiler.renderString(`a { b: ${expr}; }`, { extension, suppressWarnings: true });
  const matched = /b:\s*([^;]*);/.exec(String(output));
  if (!matched) {
    throw new Error(`No declaration in output for ${expr} (${extension})`);
  }
  return matched[1]!.trim();
};

describe('CSS min()/max() behave identically in css, less, scss and jess', () => {
  const compiler = new Compiler({ compile: { plugins: [cssPlugin()] } });

  it.each(REDUCED)('reduces %s to %s in every dialect', async (expr, expected) => {
    for (const extension of DIALECTS) {
      expect(await render(compiler, expr, extension), `${expr} in ${extension}`).toBe(expected);
    }
  });

  it.each(PRESERVED)('preserves %s verbatim in every dialect', async (expr) => {
    for (const extension of DIALECTS) {
      expect(await render(compiler, expr, extension), `${expr} in ${extension}`).toBe(expr);
    }
  });
});

/**
 * The preservation above is the ENGINE's decision, not the function's.
 *
 * The bodies throw; `evaluator.ts` `recoverCallFailure` preserves under the
 * default `functionMode: 'preserve'` and rethrows under `'error'`. Before this,
 * `min`/`max` swallowed their own failure and returned a verbatim keyword, so
 * these cases rendered identically in BOTH modes and the setting was silently
 * inert for them. That is what this block guards.
 */
describe('functionMode reaches min()/max()', () => {
  it('reports an unreducible call under functionMode: error', async () => {
    const strict = new Compiler({ compile: { plugins: [cssPlugin()], functionMode: 'error' } });
    for (const extension of DIALECTS) {
      await expect(
        strict.renderString('a { b: max(1px, 2em, 3px); }', { extension, suppressWarnings: true })
      ).rejects.toThrow();
    }
  });

  it('still reduces a reducible call under functionMode: error', async () => {
    const strict = new Compiler({ compile: { plugins: [cssPlugin()], functionMode: 'error' } });
    for (const extension of DIALECTS) {
      expect(await render(strict, 'max(1px, 2px)', extension)).toBe('2px');
    }
  });
});
