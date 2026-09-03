import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { resolveLessTestDataRoot } from '../test-utils.js';

describe('Less strict-unit final validation', () => {
  it('applies legacy language.less math and strictUnits through Context', async () => {
    const fixture = path.join(
      resolveLessTestDataRoot(),
      'tests-config/units/strict/strict-units.less'
    );
    const expected = path.join(
      resolveLessTestDataRoot(),
      'tests-config/units/strict/strict-units.css'
    );
    const compiler = new Compiler();

    const result = await compiler.renderToResult(fixture, { outputFile: expected });

    expect(result.css).toBe(readFileSync(expected, 'utf8'));
  });

  it('applies legacy language.less math without enabling strict units', async () => {
    const fixture = path.join(
      resolveLessTestDataRoot(),
      'tests-config/units/no-strict/no-strict.less'
    );
    const expected = path.join(
      resolveLessTestDataRoot(),
      'tests-config/units/no-strict/no-strict.css'
    );
    const compiler = new Compiler();

    const result = await compiler.renderToResult(fixture, { outputFile: expected });

    const expectedCss = readFileSync(expected, 'utf8');
    expect(result.css).toBe(expectedCss);
  });

  it('applies unitMode loose: the Less 4.x fold, selected only by the explicit option', async () => {
    const fixture = path.join(resolveLessTestDataRoot(), 'tests-config/units/loose/loose.less');
    const expected = path.join(resolveLessTestDataRoot(), 'tests-config/units/loose/loose.css');
    const result = await new Compiler().renderToResult(fixture, { outputFile: expected });
    expect(result.css).toBe(readFileSync(expected, 'utf8'));
  });

  it('folds scalar bare slashes while preserving lists and parens-division', async () => {
    const source = `
      .a {
        first: 4 / 2 + 5em;
        second: 4+2 / 5em;
        same-unit: 2em/1em;
        shorthand: normal small / 20px;
        bare-parens-mode: 10px / 2;
        grouped: (10px / 2);
      }
    `;
    const eager = await new Compiler({ compile: { mathMode: 'always' } }).renderString(source, {
      language: 'less',
      extension: '.less'
    });
    expect(eager).toContain('first: 7em;');

    /*
     * §4.7 row h — `2 / 5em` is a reciprocal, and there is no `em⁻¹` in CSS, so
     * the sum it feeds carries no expressible unit either. Less 4.x answers
     * `4.4em`, which is dimensionally false. The value IS computed (0.4, with
     * `em` in the denominator); `preserve` only declines to pin a unit on it,
     * and says the authored expression back instead.
     */
    expect(eager).toContain('second: calc(4 + 2 / 5em);');

    // §4.7 row g2 — like units CANCEL, so `2em/1em` is a genuine unitless 2.
    expect(eager).toContain('same-unit: 2;');
    expect(eager).toContain('shorthand: normal small / 20px;');
    expect(eager).toContain('bare-parens-mode: 5px;');
    expect(eager).toContain('grouped: 5px;');

    const parensDivision = await new Compiler({ compile: { mathMode: 'parens-division' } }).renderString(source, {
      language: 'less',
      extension: '.less'
    });
    expect(parensDivision).toContain('first: 4 / 2 + 5em;');
    expect(parensDivision).toContain('second: 4 + 2 / 5em;');
    expect(parensDivision).toContain('same-unit: 2em / 1em;');
    expect(parensDivision).toContain('shorthand: normal small / 20px;');
    expect(parensDivision).toContain('bare-parens-mode: 10px / 2;');
    expect(parensDivision).toContain('grouped: 5px;');
  });

  it('allows compound units to cancel before final emission', async () => {
    const fixture = path.join(
      resolveLessTestDataRoot(),
      'tests-config/units/strict/strict-units.less'
    );
    const expected = path.join(
      resolveLessTestDataRoot(),
      'tests-config/units/strict/strict-units.css'
    );
    const options = { mathMode: 'always' as const, unitMode: 'strict' as const };
    const compiler = new Compiler({
      compile: { ...options, plugins: [lessPlugin(options)] }
    });

    const result = await compiler.renderToResult(fixture, { outputFile: expected });

    expect(result.css).toBe(readFileSync(expected, 'utf8'));
  });
});
