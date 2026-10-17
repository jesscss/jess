import { describe, expect, it } from 'vitest';
import lessPlugin from '@jesscss/plugin-less';
import { Compiler } from '../../src/index.js';

/*
 * A run of CSS component values holding a delim (ledger N18) is well-formed
 * wherever Less reads a value, so it parses there too (ledger P45): in a paren
 * group, and as an operand of a guard or of an `if()` / `boolean()` condition.
 * What the delim means is then the existing rules': in a value it is invalid
 * punctuation (ledger P48), and a condition is not a value, so its operand is
 * compared and never reported. A mixin argument reads one Less comparison as a
 * call argument does.
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

describe('a condition operand holding a delim run parses as that operand', () => {
  it('.a when (@v = a.b) {}', () => {
    expect(parseClean('.a when (@v = a.b) { x: y; }').rules[0]!.guard).toMatchObject({
      g: 'match',
      op: '=',
      right: run(keyword('a'), delim('.'), keyword('b'))
    });
  });

  it('if((@v = a.b), x, y)', () => {
    expect(parseClean('a { x: if((@v = a.b), x, y); }').rules[0]!.rules![0]!.value).toMatchObject({
      type: 'IfValue',
      branches: [{ guard: { g: 'cmp', op: '=', right: run(keyword('a'), delim('.'), keyword('b')) } }, { guard: null }]
    });
  });

  it('boolean(@v = a.b)', () => {
    expect(parseClean('a { x: boolean(@v = a.b); }').rules[0]!.rules![0]!.value).toMatchObject({
      type: 'Expression',
      value: { type: 'Condition', guard: { g: 'cmp', op: '=', right: run(keyword('a'), delim('.'), keyword('b')) } }
    });
  });
});

describe('a comparison as a mixin argument parses as a condition', () => {
  it('.m(1 < 2)', () => {
    expect(parseClean('.m(@a) { x: @a; }\na { .m(1 < 2); }').rules[1]!.rules![0]).toMatchObject({
      type: 'MixinCall',
      args: [{ value: { type: 'Condition', guard: { g: 'cmp', op: '<', left: dimension('1'), right: dimension('2') } } }]
    });
  });
});

/*
 * The paren groups' P48 errors are pinned with every dialect's in
 * `../invalid-value-punctuation.test.ts`.
 */
describe('the compile result', () => {
  it('a guard compares a delim-run operand, which does not match', async () => {
    expect(await clean('@v: a;\n.a when (@v = a.b) { x: y; }\n.b { z: w; }\n')).toBe('.b {\n  z: w;\n}\n');
  });

  it('if() and boolean() compare a delim-run operand', async () => {
    expect(await clean('@v: a;\na { x: if((@v = a.b), y, n); z: boolean(@v = a.b); }\n')).toBe('a {\n  x: n;\n  z: false;\n}\n');
  });

  it('a comparison passed to a mixin binds its truth value', async () => {
    expect(await clean('.m(@a) { x: @a; }\na { .m(1 < 2); }\n')).toBe('a {\n  x: true;\n}\n');
  });
});
