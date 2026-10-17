import { describe, expect, it } from 'vitest';
import lessPlugin from '@jesscss/plugin-less';
import { Compiler } from '../../src/index.js';

/*
 * A run of CSS component values holding a delim (ledger N18) is well-formed
 * wherever Less reads a value, so it parses there too (ledger P45): in a paren
 * group, and as an operand of a guard or of an `if()` / `boolean()` condition.
 * What the delim means is then the existing rules': in a value it is invalid
 * punctuation (ledger P48), and a comparison with a delim-run side is that run
 * (ledger N18), which a condition reads as not true and never reports. A mixin
 * argument reads one Less comparison of two plain values as a call argument
 * does.
 */
const plugin = lessPlugin();

function parseClean(source: string) {
  const result = plugin.safeParse!('/proj/delim-groups.less', source);
  expect(result.errors).toEqual([]);
  expect(result.document).toBeDefined();
  return result.document as unknown as { rules: Array<Record<string, unknown> & { rules?: Array<Record<string, unknown>> }> };
}

async function compile(source: string) {
  return new Compiler({}).renderToResult({ source, filePath: '/proj/delim-groups.less' }, { suppressWarnings: true });
}

async function clean(source: string): Promise<string> {
  const result = await compile(source);
  expect(result.errors).toEqual([]);
  return result.css;
}

const keyword = (src: string) => ({ type: 'Keyword', src });
const delim = (src: string) => ({ type: 'Any', src });
const dimension = (src: string) => ({ type: 'Dimension', src });
const run = (...parts: object[]) => ({ type: 'Sequence', parts });

describe('a paren group holding a delim run parses into its components', () => {
  it('x: (a.b)', () => {
    expect(parseClean('a { x: (a.b); }').rules[0]!.rules![0]!.value).toMatchObject({
      type: 'Block',
      delimiter: 'paren',
      value: [keyword('a'), delim('.'), keyword('b')]
    });
  });

  it('@v: (a.b)', () => {
    expect(parseClean('@v: (a.b);').rules[0]!.value).toMatchObject({
      type: 'Block',
      value: [keyword('a'), delim('.'), keyword('b')]
    });
  });

  it('x: (a=b=c)', () => {
    expect(parseClean('a { x: (a=b=c); }').rules[0]!.rules![0]!.value).toMatchObject({
      type: 'Block',
      value: [keyword('a'), delim('='), keyword('b'), delim('='), keyword('c')]
    });
  });
});

/*
 * A comparison one of whose sides is a delim run is not a Less comparison: it
 * is the CSS run it is, as a chain is (ledger N18), and a condition reads the
 * run's truth.
 */
describe('a condition operand holding a delim run parses, and the comparison is the run', () => {
  const comparisonRun = [{ type: 'Lookup', name: 'v' }, delim('='), keyword('a'), delim('.'), keyword('b')];

  it('.a when (@v = a.b) {}', () => {
    expect(parseClean('.a when (@v = a.b) { x: y; }').rules[0]!.guard).toMatchObject({
      left: run(...comparisonRun),
      right: keyword('true'),
      implied: true
    });
  });

  it('if((@v = a.b), x, y)', () => {
    expect(parseClean('a { x: if((@v = a.b), x, y); }').rules[0]!.rules![0]!.value).toMatchObject({
      type: 'IfValue',
      branches: [{ guard: { left: { type: 'Block', value: comparisonRun }, implied: true } }, { guard: null }]
    });
  });

  it('boolean(@v = a.b)', () => {
    expect(parseClean('a { x: boolean(@v = a.b); }').rules[0]!.rules![0]!.value).toMatchObject({
      type: 'Expression',
      value: { type: 'Condition', guard: { left: comparisonRun, implied: true } }
    });
  });
});

describe('a comparison as a mixin argument', () => {
  const callArgument = (argument: string) => parseClean(`.m(@a) { x: @a; }\na { .m(${argument}); }`).rules[1]!.rules![0];

  it('.m(1 < 2) is a condition', () => {
    expect(callArgument('1 < 2')).toMatchObject({
      type: 'MixinCall',
      args: [{ value: { type: 'Condition', guard: { g: 'cmp', op: '<', left: dimension('1'), right: dimension('2') } } }]
    });
  });

  /* What is no Less comparison is the CSS run it is (ledger N18), and its delims are P48's where it is written. */
  it.each([
    ['a =', [keyword('a'), delim('=')]],
    ['a=b=c', [keyword('a'), delim('='), keyword('b'), delim('='), keyword('c')]],
    ['a = b.c', [keyword('a'), delim('='), keyword('b'), delim('.'), keyword('c')]],
    ['a = b ~ c', [keyword('a'), delim('='), keyword('b'), delim('~'), keyword('c')]]
  ])('.m(%s) is the run', (argument, components) => {
    expect(callArgument(argument)).toMatchObject({ type: 'MixinCall', args: [{ value: components }] });
  });
});

/*
 * The paren groups' P48 errors are pinned with every dialect's in
 * `../invalid-value-punctuation.test.ts`.
 */
describe('the compile result', () => {
  it('a guard over a delim-run comparison does not match', async () => {
    expect(await clean('@v: a.b;\n.a when (@v = a.b) { x: y; }\n.b { z: w; }\n')).toBe('.b {\n  z: w;\n}\n');
  });

  it('if() and boolean() read a delim-run comparison as not true', async () => {
    expect(await clean('@v: a;\na { x: if((@v = a.b), y, n); z: boolean(@v = a.b); }\n')).toBe('a {\n  x: n;\n  z: false;\n}\n');
  });

  it('a comparison passed to a mixin binds its truth value', async () => {
    expect(await clean('.m(@a) { x: @a; }\na { .m(1 < 2); }\n')).toBe('a {\n  x: true;\n}\n');
  });

  it.each([
    ['a mixin argument that is the run', '.m(@a) {\n  x: @a;\n}\na { .m(a = b.c); }\n', '=', 2, 3],
    ['a written comparison with a delim-run side', 'a {\n  x: (a.b = c);\n}\n', '.', 2, 3]
  ])('%s fails the compile where it is written (P48)', async (_label, source, delimText, line, column) => {
    const result = await compile(source);
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.line, error.column, error.message])).toEqual([
      ['css/invalid-value-punctuation', line, column, `\`${delimText}\` is not valid in any CSS value`]
    ]);
  });
});
