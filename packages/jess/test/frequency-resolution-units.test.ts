import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Frequency (`hz`, `khz`; css-values-4 §7.3) and resolution (`dppx`, `x`,
 * `dpi`, `dpcm`; §7.4) are conversion groups of the one unit table
 * (`packages/core/src/ast/value-units.ts`), so they convert in every dialect:
 * 1kHz = 1000Hz, 1dppx = 1x = 96dpi, 1dpcm = 2.54dpi. Units match
 * case-insensitively (V37).
 */
const render = (source: string, extension: '.less' | '.scss' | '.jess'): Promise<string> =>
  new Compiler({}).renderString(source, { filePath: `entry${extension}`, extension, suppressWarnings: true });

const cases: ReadonlyArray<readonly [expression: string, expected: string]> = [
  ['1kHz + 1Hz', '1.001kHz'],
  ['1Hz + 1kHz', '1001Hz'],
  ['1kHz - 1Hz', '0.999kHz'],
  ['1dppx + 96dpi', '2dppx'],
  ['1dpi + 1dpcm', '3.54dpi'],
  ['1x + 1dppx', '2x'],
  ['1dppx + 1X', '2dppx'],
  ['10kHz / 2kHz', '5'],
  ['2kHz * 1Hz / 1kHz', '2Hz']
];

describe('frequency and resolution units convert', () => {
  it.each(cases)('.less (%s)', async (expression, expected) => {
    await expect(render(`a { b: (${expression}); }`, '.less')).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it.each(cases)('.scss (%s)', async (expression, expected) => {
    await expect(render(`a { b: (${expression}); }`, '.scss')).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it.each(cases)('.jess $(%s)', async (expression, expected) => {
    await expect(render(`a { b: $(${expression}); }`, '.jess')).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it('compares across units', async () => {
    await expect(render('a when (1kHz > 999Hz) and (1dppx = 96dpi) and (1x = 1dppx) { b: c; }\nd when (1kHz < 999Hz) { e: f; }', '.less'))
      .resolves.toBe('a {\n  b: c;\n}\n');
    await expect(render('@if 1kHz > 999Hz and 1dppx == 96dpi and 1x == 1dppx { a { b: c; } }', '.scss'))
      .resolves.toBe('a {\n  b: c;\n}\n');
    await expect(render('a { b: $(1kHz > 999Hz); c: $(1x == 1dppx); d: $(1kHz < 999Hz); }', '.jess'))
      .resolves.toBe('a {\n  b: true;\n  c: true;\n  d: false;\n}\n');
  });

  it('converts and reduces in Less math functions', async () => {
    await expect(render('a { b: convert(1kHz, Hz); c: convert(2dppx, dpi); d: convert(1x, dpcm); e: min(1kHz, 999Hz); f: max(1dppx, 97dpi); }', '.less'))
      .resolves.toBe('a {\n  b: 1000Hz;\n  c: 192dpi;\n  d: 37.79527559dpcm;\n  e: 999Hz;\n  f: 97dpi;\n}\n');
  });

  it('converts, cancels and reduces in Sass math', async () => {
    await expect(render(
      '@use "sass:math";\na { b: math.compatible(1kHz, 1Hz); c: math.compatible(1dppx, 1dpcm); d: math.compatible(1Hz, 1dpi); e: math.compatible(1x, 1dppx); f: min(1kHz, 999Hz); g: math.max(1dppx, 97dpi); h: (10kHz / 1Hz); i: math.div(1dppx, 1dpi); }',
      '.scss'
    )).resolves.toBe('a {\n  b: true;\n  c: true;\n  d: false;\n  e: true;\n  f: 999Hz;\n  g: 97dpi;\n  h: 10000;\n  i: 96;\n}\n');
  });

  it('writes an un-operated value as authored', async () => {
    for (const extension of ['.less', '.scss', '.jess'] as const) {
      await expect(render('a { b: 1kHz; c: 2x; d: 300DPI; }', extension)).resolves.toBe('a {\n  b: 1kHz;\n  c: 2x;\n  d: 300DPI;\n}\n');
    }
  });
});
