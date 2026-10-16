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

/*
 * When the looked-up member is itself a mixin call, the reference writes its
 * fallback text: the call as stored, with a math group's parens kept exactly
 * where the author wrote them.
 */
describe('the fallback text of a mixin lookup call keeps grouped arguments', () => {
  it.each([
    ['(1 + 2)', '.m((1 + 2))[@r]'],
    ['((1 + 2))', '.m(((1 + 2)))[@r]'],
    ['1 + 2', '.m(1 + 2)[@r]'],
    ['url(x.png)', '.m(url(x.png))[@r]'],
    ['boolean(1 > 0)', '.m(boolean(1 > 0))[@r]']
  ])('.m(%s)[@r] writes %s', async (argument, text) => {
    for (const math of MATH_MODES) {
      await expect(render(`.n() { a: b; }\n.m(@a) { @r: .n(); }\n.x { v: .m(${argument})[@r]; }\n`, math))
        .resolves.toBe(`.x {\n  v: ${text};\n}\n`);
    }
  });
});

describe('a grouped value in a `name=value` function argument', () => {
  it.each(MATH_MODES)('does not stop the parse (math: %s)', async (math) => {
    await expect(render('.x { v: alpha(opacity=(1 + 2)); }\n', math)).resolves.toContain('alpha(opacity=');
  });
});

/*
 * P45: still stopped by the same fallback-text spelling, which has no spelling
 * for a detached ruleset or an interpolation. Each turns red when fixed.
 */
describe('argument kinds the fallback text still cannot spell', () => {
  it.fails.each(['{ a: b }', '@{b}x', 'url(@{b}.png)'])('.m(%s)[@r] evaluates', async (argument) => {
    await expect(render(`@b: 2;\n.m(@a) { @r: 1; }\n.x { v: .m(${argument})[@r]; }\n`, 'parens-division'))
      .resolves.toBe('.x {\n  v: 1;\n}\n');
  });
});
