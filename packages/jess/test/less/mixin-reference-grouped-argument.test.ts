/**
 * A mixin lookup call (`.m(args)[@r]`) whose argument is a parenthesized group
 * is well-formed Less, so it must evaluate (ledger P45). The group is a math
 * computation in every math mode — `parens`, `strict` and `parens-division`
 * compute an operator inside `( … )`, `always` computes everything — so the
 * mixin receives `3`.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type MathMode = 'always' | 'parens-division' | 'parens' | 'strict';

const MATH_MODES: readonly MathMode[] = ['always', 'parens-division', 'parens', 'strict'];

async function render(source: string, math: MathMode): Promise<string> {
  const compiler = new Compiler({ language: { less: { math } } });
  return String(await compiler.renderString(source, { filePath: 'entry.less', extension: '.less', suppressWarnings: true }));
}

describe.each(MATH_MODES)('mixin lookup call with a grouped argument (math: %s)', (math) => {
  it('evaluates a grouped argument', async () => {
    await expect(render('.m(@a) { @r: @a; }\n.x { v: .m((1 + 2))[@r]; }\n', math))
      .resolves.toBe('.x {\n  v: 3;\n}\n');
  });

  it('evaluates a nested grouped argument', async () => {
    await expect(render('.m(@a) { @r: @a; }\n.x { v: .m(((1 + 2)))[@r]; }\n', math))
      .resolves.toBe('.x {\n  v: 3;\n}\n');
  });

  it('evaluates a grouped argument beside a plain one', async () => {
    await expect(render('.m(@a, @b) { @r: @a @b; }\n.x { v: .m((1 + 2), 3)[@r]; }\n', math))
      .resolves.toBe('.x {\n  v: 3 3;\n}\n');
  });

  it('evaluates a grouped argument through a namespace', async () => {
    await expect(render('#ns { .m(@a) { @r: @a; } }\n.x { v: #ns > .m((1 + 2))[@r]; w: #ns.m((1 + 2))[@r]; }\n', math))
      .resolves.toBe('.x {\n  v: 3;\n  w: 3;\n}\n');
  });
});

describe('a bare operation as a mixin lookup argument follows the math mode', () => {
  it.each([
    ['always', '3'],
    ['parens-division', '3'],
    ['parens', '1 + 2'],
    ['strict', '1 + 2']
  ] as const)('math: %s gives %s', async (math, value) => {
    await expect(render('.m(@a) { @r: @a; }\n.x { v: .m(1 + 2)[@r]; }\n', math))
      .resolves.toBe(`.x {\n  v: ${value};\n}\n`);
  });
});

describe('other argument kinds a mixin lookup call re-spells', () => {
  it.each([
    ['url(x.png)', 'url(x.png)'],
    ['boolean(1 > 0)', 'true'],
    ['not(1)', 'true'],
    ['and(true, false)', 'false'],
    ['if(true, 1, 2)', '1'],
    ['-@b', '-2']
  ])('.m(%s)[@r] gives %s', async (argument, value) => {
    await expect(render(`@b: 2;\n.m(@a) { @r: @a; }\n.x { v: .m(${argument})[@r]; }\n`, 'parens-division'))
      .resolves.toBe(`.x {\n  v: ${value};\n}\n`);
  });
});

describe('a grouped value in an IE filter assignment argument', () => {
  it.each(MATH_MODES)('keeps the authored spelling (math: %s)', async (math) => {
    await expect(render('.x { v: alpha(opacity=(1 + 2)); }\n', math))
      .resolves.toBe('.x {\n  v: alpha(opacity=(1 + 2));\n}\n');
  });
});
