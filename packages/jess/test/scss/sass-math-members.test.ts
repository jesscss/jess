import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * The `sass:math` members Jess computes through the math kernel it shares with
 * Less (`packages/fns/src/shared/math/math-helper.ts`) or through `.scss`'s own
 * division (`math.div`), and the module variables (`$pi`, …). Inputs and
 * outputs are sass-spec's (`spec/core_functions/math/**`, section named), which
 * Dart Sass 1.101.7 writes the same. Not pinned here: sass-spec sections whose
 * numbers Jess writes with V4's tolerance rather than Dart Sass's 10 decimal
 * places (`sin.hrx § turn`), whose result is not finite (V7), or that read a
 * variable as `math.$pi` (the `.scss` parse gives that the shape of
 * `map-get(math, $pi)`; not resolved yet).
 */
const render = (source: string): Promise<string> =>
  new Compiler({}).renderString(`@use "sass:math";\na {b: ${source}}`, { extension: '.scss', suppressWarnings: true });

const computes: ReadonlyArray<readonly [section: string, source: string, expected: string]> = [
  ['pow/base_greater_than_zero.hrx § base/greater_than_one/with_exponent/integer', 'math.pow(2, 3)', '8'],
  ['pow/base_greater_than_zero.hrx § base/greater_than_one/with_exponent/decimal', 'math.pow(2, 0.5)', '1.4142135624'],
  ['pow/base_less_than_zero.hrx § base/less_than_negative_one/with_exponent/integer', 'math.pow(-2, 2)', '4'],
  ['pow/arguments.hrx § named_args', 'math.pow($base: 2, $exponent: 3)', '8'],
  ['sqrt.hrx § positive', 'math.sqrt(2)', '1.4142135624'],
  ['sqrt.hrx § named_arg', 'math.sqrt($number: 2)', '1.4142135624'],
  ['sin.hrx § unitless', 'math.sin(1)', '0.8414709848'],
  ['sin.hrx § rad', 'math.sin(1rad)', '0.8414709848'],
  ['cos.hrx § deg', 'math.cos(1deg)', '0.9998476952'],
  ['cos.hrx § grad', 'math.cos(1grad)', '0.9998766325'],
  ['cos.hrx § turn', 'math.cos(1turn)', '1'],
  ['tan.hrx § rad', 'math.tan(1rad)', '1.5574077247'],
  ['asin.hrx § decimal', 'math.asin(0.5)', '30deg'],
  ['acos.hrx § negative_decimal', 'math.acos(-0.5)', '120deg'],
  ['atan.hrx § negative', 'math.atan(-1)', '-45deg'],
  ['atan2/arguments.hrx § compatible_units', 'math.atan2(1cm, -10mm)', '135deg'],
  ['atan2/arguments.hrx § named_args', 'math.atan2($y: 1, $x: -1)', '135deg'],
  ['log.hrx § positive', 'math.log(2)', '0.6931471806'],
  ['log.hrx § base/null', 'math.log(2, null)', '0.6931471806'],
  ['log.hrx § base/between_zero_and_one', 'math.log(2, 0.5)', '-1'],
  ['clamp.hrx § chooses_number', 'math.clamp(0, 1, 2)', '1'],
  ['clamp.hrx § min_greater_than_max', 'math.clamp(1, 2, 0)', '1'],
  ['clamp.hrx § preserves_units/number', 'math.clamp(180deg, 0.75turn, 360deg)', '0.75turn'],
  ['div.hrx § unitless/fraction', 'math.div(6, 5)', '1.2'],
  ['div.hrx § unitless/named', 'math.div($number2: 3, $number1: 6)', '2'],
  ['div.hrx § unit/numerator', 'math.div(6px, 3)', '2px'],
  ['div.hrx § unit/denominator', 'math.div(6, 3px) * 1px', '2'],
  ['div.hrx § unit/same', 'math.div(6px, 3px)', '2']
];

describe('sass:math members compute as in Dart Sass', () => {
  it.each(computes)('%s', async (_section, source, expected) => {
    await expect(render(source)).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it('values/numbers/precision.hrx § very_close_to_int/positive/above/at_boundary', async () => {
    await expect(render('10 + math.pow(10, -11)')).resolves.toBe('a {\n  b: 10;\n}\n');
  });

  it('binds the module variables for `@use … as *`', async () => {
    const css = await new Compiler({}).renderString('@use "sass:math" as *;\na {b: $pi * 1e15; c: $e * 1e15; d: $max-safe-integer}', { extension: '.scss' });
    expect(css).toBe('a {\n  b: 3141592653589793;\n  c: 2718281828459045;\n  d: 9007199254740991;\n}\n');
  });
});

/*
 * Where Dart Sass rejects an argument, the call fails (`functionMode: 'error'`
 * reports Dart Sass's message; the default keeps the call as written). These are
 * the unit rules that separate the `sass:math` members from Less's `pow`,
 * `sqrt` and trig functions, which share their computation.
 */
const rejects: ReadonlyArray<readonly [section: string, source: string, message: string]> = [
  ['pow/arguments.hrx § error/base_has_units', 'math.pow(1px, 0)', '$base: Expected 1px to have no units.'],
  ['pow/arguments.hrx § error/exponent_has_units', 'math.pow(0, 1px)', '$exponent: Expected 1px to have no units.'],
  ['sqrt.hrx § error/units', 'math.sqrt(1px)', '$number: Expected 1px to have no units.'],
  ['sin.hrx § error/unit', 'math.sin(1px)', '$number: Expected 1px to have an angle unit (deg, grad, rad, turn).'],
  ['asin.hrx § error/units', 'math.asin(1px)', '$number: Expected 1px to have no units.'],
  ['log.hrx § error/base_has_units', 'math.log(1, 1px)', '$base: Expected 1px to have no units.'],
  ['atan2/arguments.hrx § error/unitless_x', 'math.atan2(1px, 1)', '$x: 1 and $y: 1px have incompatible units (one has units and the other doesn\'t).'],
  ['hypot.hrx § error/incompatible_units/first_and_second', 'math.hypot(1deg, 1px, 1turn)', '$numbers[2]: 1px and $numbers[1]: 1deg have incompatible units.'],
  ['hypot.hrx § error/zero_args', 'math.hypot()', 'At least one argument must be passed.'],
  ['clamp.hrx § error/incompatible_units/min_and_number', 'math.clamp(1deg, 1px, 1turn)', '$number: 1px and $min: 1deg have incompatible units.'],
  ['div.hrx § error/too_few_args', 'math.div(6)', 'Missing argument $number2.'],
  ['div.hrx § error/too_many_args', 'math.div(6, 3, 1)', 'Only 2 arguments allowed, but 3 were passed.']
];

describe('sass:math members reject what Dart Sass rejects', () => {
  const strict = new Compiler({ compile: { functionMode: 'error' } });

  it.each(rejects)('%s', async (_section, source, message) => {
    await expect(
      strict.renderString(`@use "sass:math";\na {b: ${source}}`, { extension: '.scss', suppressWarnings: true })
    ).rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });

  it('keeps a rejected call as written by default', async () => {
    await expect(render('math.sqrt(1px)')).resolves.toBe('a {\n  b: math.sqrt(1px);\n}\n');
  });
});
