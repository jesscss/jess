/**
 * Less math built-ins and math operators over what only the browser knows are
 * their CSS forms (docs/design/CSS-NATIVE-BUILTINS.md §2, §3.2, §4 slice 5, Q2,
 * Q3, Q4, Q8; ledger V38). Known inputs compute as they did.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type Options = { readonly mathMode?: string; readonly unitMode?: string; readonly compress?: boolean; readonly functionMode?: string };

const options = { filePath: 'entry.less', language: 'less', extension: '.less', suppressWarnings: true } as const;

async function css(source: string, { compress, ...compile }: Options = {}): Promise<string> {
  const compiler = new Compiler({ output: { collapseNesting: true, compress }, compile });
  return String(await compiler.renderString(source, options));
}

/** `value` as a declaration's value. */
async function value(source: string, modes?: Options): Promise<string> {
  const out = await css(`.a { b: ${source}; }`, modes);
  return out.replace(/^\.a\s*\{\s*b:\s*/, '').replace(/;?\s*\}\s*$/, '');
}

const FORMS: ReadonlyArray<readonly [source: string, form: string]> = [
  ['percentage(var(--p))', 'calc(var(--p) * 100%)'],
  ['unit(var(--x), px)', 'calc(var(--x) * 1px)'],
  ['unit(var(--x))', 'calc(var(--x) * 1)'],
  ['convert(var(--x), px)', 'calc(var(--x))'],
  ['ceil(var(--x))', 'round(up, var(--x), 1)'],
  ['floor(var(--x))', 'round(down, var(--x), 1)'],
  ['round(var(--x))', 'calc(sign(var(--x)) * round(abs(var(--x)), 1))'],
  ['round(var(--x), 2)', 'calc(sign(var(--x)) * round(abs(var(--x)), 0.01))'],
  ['round(var(--x), var(--p))', 'calc(sign(var(--x)) * round(abs(var(--x)), pow(10, -1 * var(--p))))'],
  ['round(1.5px, var(--p))', 'calc(sign(1.5px) * round(abs(1.5px), pow(10, -1 * var(--p)) * 1px))'],
  ['mod(var(--x), 3)', 'rem(var(--x), 3)'],
  ['mod(5px, var(--x))', 'rem(5px, var(--x))'],
  ['darken(#c00, var(--a))', 'hsl(from #c00 h s clamp(0, l - var(--a) / 1%, 100))'],
  ['lighten(var(--c), var(--a))', 'hsl(from var(--c) h s clamp(0, l + var(--a) / 1%, 100))'],
  ['saturate(#c00, var(--a))', 'hsl(from #c00 h clamp(0, s + var(--a) / 1%, 100) l)'],
  ['desaturate(#c00, var(--a))', 'hsl(from #c00 h clamp(0, s - var(--a) / 1%, 100) l)'],
  ['darken(#c00, var(--a), relative)', 'hsl(from #c00 h s clamp(0, l - l * var(--a) / 1% / 100, 100))'],
  ['spin(#c00, var(--a))', 'hsl(from #c00 calc(h + var(--a)) s l)'],
  ['(var(--a) * 2)', 'calc(var(--a) * 2)'],
  ['((var(--a) + 1) * 2)', 'calc((var(--a) + 1) * 2)'],
  ['(var(--a) / 2)', 'calc(var(--a) / 2)']
];

describe('a math built-in or operator over what only the browser knows is its CSS form', () => {
  it.each(FORMS)('%s', async (source, form) => {
    for (const mathMode of ['always', 'parens-division', 'parens', 'strict']) {
      await expect(value(source, { mathMode }), mathMode).resolves.toBe(form);
    }
    for (const unitMode of ['strict', 'preserve', 'loose']) {
      await expect(value(source, { unitMode }), unitMode).resolves.toBe(form);
    }
    await expect(value(source, { functionMode: 'error' })).resolves.toBe(form);
  });

  it('writes no calc() of its own inside a math function', async () => {
    await expect(value('calc(percentage(var(--p)))')).resolves.toBe('calc(var(--p) * 100%)');
    await expect(value('calc(1px + percentage(var(--p)))')).resolves.toBe('calc(1px + var(--p) * 100%)');
    await expect(value('min(percentage(var(--p)), 10%)')).resolves.toBe('min(var(--p) * 100%, 10%)');
    await expect(value('calc(1px + (var(--a) * 2))')).resolves.toBe('calc(1px + (var(--a) * 2))');
  });

  it('nests in another form', async () => {
    await expect(value('darken(#c00, (var(--a) * 2))')).resolves.toBe('hsl(from #c00 h s clamp(0, l - (var(--a) * 2) / 1%, 100))');
    await expect(value('percentage(ceil(var(--x)))')).resolves.toBe('calc(round(up, var(--x), 1) * 100%)');
    await expect(value('unit(var(--x) + 1, px)')).resolves.toBe('calc((var(--x) + 1) * 1px)');
  });

  it('writes an operator where the math mode reads it as math', async () => {
    await expect(value('var(--a) * 2', { mathMode: 'always' })).resolves.toBe('calc(var(--a) * 2)');
    await expect(value('var(--a) * 2', { mathMode: 'parens-division' })).resolves.toBe('calc(var(--a) * 2)');
    await expect(value('var(--a) * 2', { mathMode: 'parens' })).resolves.toBe('var(--a) * 2');
    await expect(value('var(--a) / 2', { mathMode: 'always' })).resolves.toBe('calc(var(--a) / 2)');
    await expect(value('var(--a) / 2', { mathMode: 'parens-division' })).resolves.toBe('var(--a) / 2');
  });

  it('holds in every position', async () => {
    await expect(css('@p: percentage(var(--x));\n.a { b: @p; c: @p * 2; d: 1 @p 2; }'))
      .resolves.toBe('.a {\n  b: calc(var(--x) * 100%);\n  c: calc(var(--x) * 100% * 2);\n  d: 1 calc(var(--x) * 100%) 2;\n}\n');
    await expect(css('.m(@a: ceil(var(--x))) { b: @a; }\n.a { .m(); }')).resolves.toBe('.a {\n  b: round(up, var(--x), 1);\n}\n');
    await expect(css('.m(@a) { b: @a; }\n.a { .m(var(--x) * 2); }')).resolves.toBe('.a {\n  b: calc(var(--x) * 2);\n}\n');
    await expect(css('@p: (var(--x) * 2);\n.a-@{p} { b: "@{p}"; }')).resolves.toBe('.a-calc(var(--x) * 2) {\n  b: "calc(var(--x) * 2)";\n}\n');
    await expect(css('@media (min-width: percentage(var(--a))) { .a { b: c; } }')).resolves.toBe('@media (min-width: calc(var(--a) * 100%)) {\n  .a {\n    b: c;\n  }\n}\n');
  });

  it('spells a form compressed', async () => {
    await expect(value('round(var(--x), 2)', { compress: true })).resolves.toBe('calc(sign(var(--x)) * round(abs(var(--x)),.01))');
    await expect(value('(var(--a) * 2)', { compress: true })).resolves.toBe('calc(var(--a) * 2)');
  });

  it('reads as what it computes to (Q10)', async () => {
    const guard = (test: string, input: string) => css(`.m(@a) when (${test}(@a)) { b: y; }\n.m(@a) when (default()) { b: n; }\n.a { .m(${input}); }`);
    await expect(guard('isnumber', 'percentage(var(--x))')).resolves.toContain('b: y');
    await expect(guard('iskeyword', 'percentage(var(--x))')).resolves.toContain('b: n');
    await expect(guard('isnumber', 'var(--x)')).resolves.toContain('b: n');
    await expect(guard('iscolor', 'darken(var(--c), var(--a))')).resolves.toContain('b: y');
  });
});

describe('a math built-in over a known input', () => {
  it.each([
    ['percentage(0.07)', '7%'],
    ['percentage(10px)', '1000%'],
    ['percentage(180deg)', '314.15926536%'],
    ['unit(5px, em)', '5em'],
    ['unit(5px)', '5'],
    ['convert(1in, px)', '96px'],
    ['convert(1in, em)', '1in'],
    ['ceil(1.5px)', '2px'],
    ['ceil(-0.5)', '0'],
    ['floor(-1.1em)', '-2em'],
    ['round(-0.4)', '0'],
    ['round(-2.5)', '-3'],
    ['round(1.005, 2)', '1.01'],
    ['mod(5px, 2)', '1px'],
    ['mod(-5, 3)', '-2'],
    ['mod(5.5, 0.1)', '0.1']
  ])('%s is %s', async (source, resolved) => {
    await expect(value(source)).resolves.toBe(resolved);
  });

  it('writes the call out where a number cannot be spelled or a type is known and wrong', async () => {
    await expect(value('mod(5, 0)')).resolves.toBe('mod(5, 0)');
    await expect(value('percentage(solid)')).resolves.toBe('percentage(solid)');
    await expect(value('ceil(#fff)')).resolves.toBe('ceil(#fff)');
    await expect(value('percentage(#fff)', { functionMode: 'error' })).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });

  it('keeps an argument only the browser knows where no form takes it', async () => {
    await expect(value('unit(5px, var(--u))')).resolves.toBe('unit(5px, var(--u))');
    await expect(value('convert(5px, var(--u))')).resolves.toBe('convert(5px, var(--u))');
    await expect(value('darken(#c00, var(--a), var(--m))')).resolves.toBe('darken(#c00, var(--a), var(--m))');
  });

  it('keeps math it cannot compute where a built-in cannot read it (V18)', async () => {
    await expect(value('percentage(1px + 1em)')).resolves.toBe('percentage(calc(1px + 1em))');
    await expect(value('(1px + 1em)')).resolves.toBe('calc(1px + 1em)');
    await expect(value('(1px + 1em) * 2')).resolves.toBe('calc((1px + 1em) * 2)');
  });

  it('fails an operand of a known wrong type (V36)', async () => {
    await expect(value('(#111 + var(--x))')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
    await expect(value('(foo + var(--x))')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
    await expect(value('("a" + var(--x))')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });
});

describe('other dialects', () => {
  it('.scss still rejects math on what only the browser knows outside a calculation', async () => {
    const compiler = new Compiler({});
    await expect(compiler.renderString('.a { b: (var(--a) * 2); }', { filePath: 'entry.scss', extension: '.scss' }))
      .rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('.scss keeps its own math functions', async () => {
    const compiler = new Compiler({});
    await expect(compiler.renderString('.a { b: ceil(var(--a)); c: percentage(var(--a)); }', { filePath: 'entry.scss', extension: '.scss' }))
      .resolves.toBe('.a {\n  b: ceil(var(--a));\n  c: percentage(var(--a));\n}\n');
  });
});
