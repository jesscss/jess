import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Math compares units ASCII case-insensitively (css-values-4 §2.3; ledger V37),
 * in every dialect through the one core path. Only the comparison folds: an
 * operated result keeps the spelling the operation gives it (`+`/`-`: the left
 * operand's unit) and an un-operated value is written as authored.
 */
const render = (source: string, extension: '.less' | '.scss' | '.jess'): Promise<string> =>
  new Compiler({}).renderString(source, { filePath: `entry${extension}`, extension, suppressWarnings: true });

const cases: ReadonlyArray<readonly [expression: string, expected: string]> = [
  ['1PX + 1mm', '4.779527559PX'],
  ['1Px + 1px', '2Px'],
  ['1kHz + 1khz', '2kHz'],
  ['1Hz + 1hz', '2Hz'],
  ['4Q + 1mm', '8Q'],
  ['4q + 1mm', '8q'],
  ['10PX / 2px', '5']
];

describe('math folds unit case', () => {
  it.each(cases)('.less (%s)', async (expression, expected) => {
    await expect(render(`a { b: (${expression}); }`, '.less')).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it.each(cases)('.scss (%s)', async (expression, expected) => {
    await expect(render(`a { b: (${expression}); }`, '.scss')).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it.each(cases)('.jess $(%s)', async (expression, expected) => {
    await expect(render(`a { b: $(${expression}); }`, '.jess')).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it('compares across spellings in a Less guard', async () => {
    await expect(render('a when (1PX = 1px) { b: c; }\nd when (1PX > 1mm) { e: f; }', '.less'))
      .resolves.toBe('a {\n  b: c;\n}\n');
  });

  it('converts and reduces across spellings in math functions', async () => {
    await expect(render('a { b: convert(1cm, Q); c: min(1PX, 1mm); d: max(1IN, 1px); }', '.less'))
      .resolves.toBe('a {\n  b: 40Q;\n  c: 1PX;\n  d: 1IN;\n}\n');
    await expect(render('@use "sass:math";\na { b: math.compatible(1PX, 1mm); c: math.hypot(3MM, 4mm); }', '.scss'))
      .resolves.toBe('a {\n  b: true;\n  c: 5MM;\n}\n');
  });

  it('writes an un-operated unit as authored', async () => {
    await expect(render('a { b: 10PX; }', '.less')).resolves.toBe('a {\n  b: 10PX;\n}\n');
    await expect(render('a { b: 10PX; }', '.scss')).resolves.toBe('a {\n  b: 10PX;\n}\n');
    await expect(render('a { b: 10PX; }', '.jess')).resolves.toBe('a {\n  b: 10PX;\n}\n');
  });
});
