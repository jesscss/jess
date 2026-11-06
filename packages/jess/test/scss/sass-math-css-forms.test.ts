/**
 * `.scss` math over what only the browser knows (ledger V38,
 * docs/design/CSS-NATIVE-BUILTINS.md §4 row 8): an operator is `calc()`, a Sass
 * math built-in with a form prints it, and a namespaced member CSS has a function
 * of its name for is that function. Known inputs compute, and Sass's own failures
 * stay.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from 'jess';

const render = (source: string, extension = '.scss', compress = false): Promise<string> =>
  new Compiler({ output: { collapseNesting: true, compress } }).renderString(source, { filePath: `entry${extension}`, extension });

const value = async (written: string, extension = '.scss', before = '@use "sass:math"; $x: var(--x); $s: var(--s); '): Promise<string> =>
  (await render(`${before}.a { b: ${written}; }`, extension)).replace(/^[^]*?b: /, '').replace(/;\s*}\s*$/, '');

describe('.scss operators on what only the browser knows', () => {
  it.each([
    ['$x * 2', 'calc(var(--x) * 2)'],
    ['$x + 1px', 'calc(var(--x) + 1px)'],
    ['1 - $x', 'calc(1 - var(--x))'],
    ['$x % 3', 'rem(var(--x), 3)'],
    ['-$x', 'calc(-1 * var(--x))'],
    ['($x / 2)', 'calc(var(--x) / 2)'],
    ['($x * 2) + 1', 'calc((var(--x) * 2) + 1)'],
    ['2 * ($x + $s)', 'calc(2 * (var(--x) + var(--s)))'],
    ['calc($x * 2) * 3', 'calc(var(--x) * 2 * 3)'],
    ['-$x * 2', 'calc(-1 * var(--x) * 2)'],
    ['($x * 2) % 3', 'rem((var(--x) * 2), 3)'],
    ['$x % 3 + 1', 'calc(rem(var(--x), 3) + 1)'],
    ['env(a) * 2', 'calc(env(a) * 2)'],
    ['min(1px, $x) * 2', 'calc(min(1px, var(--x)) * 2)'],
    ['foo(1) * 2', 'calc(foo(1) * 2)'],
    ['math.div($x, 2) + 1', 'calc(var(--x) / 2 + 1)'],
    ['percentage($x) * 2', 'calc(var(--x) * 100% * 2)'],
    ['-percentage($x)', 'calc(-1 * var(--x) * 100%)'],
    ['math.sqrt($x) * 2', 'calc(sqrt(var(--x)) * 2)'],
    ['translate(-$x, 0)', 'translate(calc(-1 * var(--x)), 0)'],
    ['translate(-$x, $x * 2)', 'translate(calc(-1 * var(--x)), calc(var(--x) * 2))'],
    ['translate(($x * 2), 1px)', 'translate(calc(var(--x) * 2), 1px)'],
    ['repeat(2, $x * 2)', 'repeat(2, calc(var(--x) * 2))'],
    ['foo($x * 2)', 'foo(calc(var(--x) * 2))'],
    ['hsl(($x + 1) 50% 50%)', 'hsl(calc(var(--x) + 1) 50% 50%)']
  ])('%s is %s', async (written, out) => {
    await expect(value(written)).resolves.toBe(out);
  });

  it.each([
    ['$x / 2', 'var(--x) / 2'],
    ['$x/2', 'var(--x)/2'],
    ['$x / 2 / 3', 'var(--x) / 2 / 3'],
    ['$x / foo', 'var(--x) / foo'],
    ['(foo / bar)', '(foo / bar)'],
    ['$x + "s"', '"var(--x)s"'],
    ['"s" + $x', '"svar(--x)"'],
    ['null * $x', 'var(--x)'],
    ['$x * null', 'var(--x)'],
    ['calc(var(--a) % 3)', 'calc(var(--a) % 3)']
  ])('%s stays %s', async (written, out) => {
    await expect(value(written)).resolves.toBe(out);
  });

  it.each([
    'foo * 2',
    'foo + $x',
    'true * 2',
    'true + $x',
    '(1 2) * 2',
    '(1 2) * $x',
    '(a: 1) * 2',
    '(a: 1) * $x',
    '#c00 * $x',
    '"s" * $x',
    'rgb(var(--r), 0, 0) * 2',
    'rgb(1 2 3) * 2',
    'media(print) + 1',
    '($x / foo)',
    '($x / red)',
    '("s" / $x)',
    '($x / true)',
    '(rgb(1 2 3) / $x)',
    '(media(print) / $x)',
    '($x / url(a.png))'
  ])('%s still fails', async (written) => {
    await expect(value(written)).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('reads the value a function or a mixin was given', async () => {
    await expect(render('@function f($a) { @return $a * 2; } $x: var(--x); .a { a: f($x); b: f(2); }'))
      .resolves.toBe('.a {\n  a: calc(var(--x) * 2);\n  b: 4;\n}\n');
    await expect(render('@mixin m($a: var(--x)) { w: $a + 1px; } .a { @include m; }'))
      .resolves.toBe('.a {\n  w: calc(var(--x) + 1px);\n}\n');
  });

  it('compresses what it keeps', async () => {
    await expect(render('$x: var(--x); .a { b: $x + 0.5px; }', '.scss', true)).resolves.toContain('calc(var(--x) + .5px)');
  });
});

describe('Sass math built-ins with a form', () => {
  it.each(['round(1px * 1px)', 'round(math.div(1px, 1em))', 'round(math.div(1, 2px))', 'ceil(1px * 1px)', 'floor(1px * 1px)'])('%s keeps its unit', async (written) => {
    await expect(value(written)).resolves.toBe('1px');
  });

  it.each([
    ['percentage($x)', 'calc(var(--x) * 100%)'],
    ['math.percentage($x)', 'calc(var(--x) * 100%)'],
    ['math.percentage(calc(1 + $x))', 'calc((1 + var(--x)) * 100%)'],
    ['ceil($x)', 'round(up, var(--x), 1)'],
    ['math.ceil($x)', 'round(up, var(--x), 1)'],
    ['floor($x)', 'round(down, var(--x), 1)'],
    ['math.floor($x)', 'round(down, var(--x), 1)'],
    ['round($x)', 'calc(sign(var(--x)) * round(abs(var(--x)), 1))'],
    ['math.round($x)', 'calc(sign(var(--x)) * round(abs(var(--x)), 1))'],
    ['round($x, 5px)', 'calc(sign(var(--x)) * round(abs(var(--x)), 5px))'],
    ['round(1.5, $s)', 'calc(sign(1.5) * round(abs(1.5), var(--s)))'],
    ['round(up, $x, 1px)', 'round(up, var(--x), 1px)'],
    ['math.div($x, 2)', 'calc(var(--x) / 2)'],
    ['math.div(2, $x)', 'calc(2 / var(--x))'],
    ['math.div(calc(1px + $x), 2)', 'calc((1px + var(--x)) / 2)']
  ])('%s is %s', async (written, out) => {
    await expect(value(written)).resolves.toBe(out);
  });

  it.each([
    ['percentage(0.5)', '50%'],
    ['math.percentage(0.1 + 0.2)', '30%'],
    ['math.percentage(math.div(1, 3))', '33.33333333%'],
    ['ceil(1.2px)', '2px'],
    ['math.ceil(1.2in)', '2in'],
    ['floor(-1.2)', '-2'],
    ['round(1.5px)', '2px'],
    ['round(-2.5)', '-3'],
    ['round(1.234, 2)', '2'],
    ['round(1.234, 0.1)', '1.2'],
    ['round(2.5, -1)', '3'],
    ['round(16px, 5px)', '15px'],
    ['round(16px, 10px)', '20px'],
    ['round(1.5, 1px)', '2px'],
    ['math.div(4, 2)', '2'],
    ['math.div(4px, 2)', '2px'],
    ['math.div(6in, 3px)', '192'],
    ['math.ceil($number: 1.2)', '2'],
    ['math.floor($number: 1.2)', '1'],
    ['math.round($number: 1.5, $step: 2)', '2'],
    ['math.percentage($number: 0.5)', '50%'],
    ['math.div($number2: 3, $number1: 6)', '2']
  ])('%s computes to %s', async (written, out) => {
    await expect(value(written)).resolves.toBe(out);
  });

  it.each([
    ['math.percentage(1px)', 'Expected 1px to have no units'],
    ['math.percentage(50%)', 'Expected 50% to have no units'],
    ['math.percentage(calc(1px + var(--x)))', 'to have no units'],
    ['math.percentage(foo)', 'percentage: arg 0'],
    ['math.percentage(rgb(var(--r), 0, 0))', 'percentage: arg 0'],
    ['math.ceil(foo)', 'ceil: arg 0'],
    ['math.floor(1px, 2px)', 'too many arguments'],
    ['math.round(1, 2, 3)', 'too many arguments'],
    ['math.round(1.5, 0)', 'not a finite number'],
    ['math.div(4, 0)', 'divides by zero'],
    ['math.div(red, 2)', '$number1: red is not a number'],
    ['math.div($x, foo)', '$number2: foo is not a number'],
    ['math.div(rgb(var(--r), 0, 0), 2)', 'is not a number'],
    ['math.div($x)', 'Missing argument $number2'],
    ['math.div(1, 2, 3)', 'Only 2 arguments allowed']
  ])('%s fails: %s', async (written, message) => {
    await expect(value(written)).rejects.toMatchObject({ code: 'eval/invalid-function', reason: expect.stringContaining(message) });
  });
});

describe('a member CSS has a function of its name for, over what only the browser knows', () => {
  it.each([
    ['math.sqrt($number: var(--x))', 'sqrt(var(--x))'],
    ['math.pow($base: var(--x), $exponent: 2)', 'pow(var(--x), 2)'],
    ['math.pow($exponent: 2, $base: var(--x))', 'pow(var(--x), 2)'],
    ['math.clamp($max: 1, $number: var(--x), $min: 0)', 'clamp(0, var(--x), 1)'],
    ['math.atan2($x: 1, $y: var(--a))', 'atan2(var(--a), 1)'],
    ['math.log($number: var(--x))', 'log(var(--x))'],
    ['math.log($base: 2, $number: var(--x))', 'log(var(--x), 2)'],
    ['math.sin($number: var(--x))', 'sin(var(--x))'],
    ['math.abs($number: var(--x))', 'abs(var(--x))'],
    ['math.log(var(--a), null)', 'log(var(--a))']
  ])('writes the arguments it bound, in order: %s', async (written, out) => {
    await expect(value(written)).resolves.toBe(out);
  });

  it.each(['math.sqrt($foo: var(--x))', 'math.min(var(--a), null)', 'math.max(null, var(--a))'])('%s fails', async (written) => {
    await expect(value(written)).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it.each([
    ['math.sqrt($x)', 'sqrt(var(--x))'],
    ['math.abs($x)', 'abs(var(--x))'],
    ['math.pow($x, 2)', 'pow(var(--x), 2)'],
    ['math.pow(2, $x)', 'pow(2, var(--x))'],
    ['math.sin($x)', 'sin(var(--x))'],
    ['math.cos($x)', 'cos(var(--x))'],
    ['math.tan($x)', 'tan(var(--x))'],
    ['math.asin($x)', 'asin(var(--x))'],
    ['math.acos($x)', 'acos(var(--x))'],
    ['math.atan($x)', 'atan(var(--x))'],
    ['math.atan2($x, 1)', 'atan2(var(--x), 1)'],
    ['math.log($x)', 'log(var(--x))'],
    ['math.log($x, 2)', 'log(var(--x), 2)'],
    ['math.hypot($x, 1)', 'hypot(var(--x), 1)'],
    ['math.min($x, 1)', 'min(var(--x), 1)'],
    ['math.max($x, 1)', 'max(var(--x), 1)'],
    ['math.clamp(0, $x, 1)', 'clamp(0, var(--x), 1)'],
    ['math.sqrt(calc(1 + $x))', 'sqrt(calc(1 + var(--x)))']
  ])('%s is %s', async (written, out) => {
    await expect(value(written)).resolves.toBe(out);
  });

  it.each([
    ['math.sqrt(16px)', 'Expected 16px to have no units'],
    ['math.sqrt(foo)', 'sqrt: arg 0'],
    ['math.sqrt(rgb(0 0 0))', 'sqrt: arg 0'],
    ['math.sqrt($x, 2)', 'too many arguments'],
    ['math.pow($x)', 'missing required argument'],
    ['math.pow(foo, $x)', 'pow: arg 0'],
    ['math.hypot($x, foo)', 'hypot: arg 0'],
    ['math.min($x, foo)', 'is not a number'],
    ['math.clamp(foo, $x, 1)', 'clamp: arg 0'],
    ['math.sin(1px)', 'to have an angle unit'],
    ['math.abs(calc(1px + 1em))', 'abs: arg 0']
  ])('%s fails: %s', async (written, message) => {
    await expect(value(written)).rejects.toMatchObject({ code: 'eval/invalid-function', reason: expect.stringContaining(message) });
  });

  it.each([
    ['@less.sqrt(var(--x))', 'sqrt(var(--x))'],
    ['@less.abs(var(--x))', 'abs(var(--x))'],
    ['@less.pow(var(--x), 2)', 'pow(var(--x), 2)'],
    ['@less.sin(var(--x))', 'sin(var(--x))'],
    ['@less.cos(var(--x))', 'cos(var(--x))'],
    ['@less.tan(var(--x))', 'tan(var(--x))'],
    ['@less.asin(var(--x))', 'asin(var(--x))'],
    ['@less.acos(var(--x))', 'acos(var(--x))'],
    ['@less.atan(var(--x))', 'atan(var(--x))'],
    ['@less.min(var(--x), 1)', 'min(var(--x), 1)'],
    ['@less.max(var(--x), 1)', 'max(var(--x), 1)'],
    ['(@less.sqrt(var(--x)) * 2)', 'calc(sqrt(var(--x)) * 2)'],
    ['@less.sqrt(16)', '4']
  ])('Less %s is %s', async (written, out) => {
    await expect(value(written, '.less', '@use "#less"; ')).resolves.toBe(out);
  });

  it.each(['@less.sqrt(foo)', '@less.abs(foo)', '@less.pow(foo, var(--x))', '@less.min(foo, var(--x))'])('Less %s still fails', async (written) => {
    await expect(value(written, '.less', '@use "#less"; ')).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });
});
