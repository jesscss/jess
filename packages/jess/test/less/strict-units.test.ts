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

    expect(result.css).toBe(readFileSync(expected, 'utf8'));
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
