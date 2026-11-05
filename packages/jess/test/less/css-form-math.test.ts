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

describe('a form over a value whose type its structure gives is valid CSS of that type', () => {
  it.each([
    ['ceil(var(--x) + 1px)', 'round(up, var(--x) + 1px, 1px)'],
    ['ceil(percentage(var(--x)))', 'round(up, var(--x) * 100%, 1%)'],
    ['floor(var(--x) * 1em)', 'round(down, var(--x) * 1em, 1em)'],
    ['round(var(--x) + 1px)', 'calc(sign(var(--x) + 1px) * round(abs(var(--x) + 1px), 1px))'],
    ['round(percentage(var(--x)), 1)', 'calc(sign(var(--x) * 100%) * round(abs(var(--x) * 100%), 0.1%))'],
    ['mod(var(--x) + 1px, 3)', 'rem(var(--x) + 1px, 3px)'],
    ['percentage(var(--x) + 1px)', 'calc((var(--x) + 1px) / 1px * 100%)'],
    ['percentage(var(--x) + 180deg)', 'calc((var(--x) + 180deg) / 1rad * 100%)'],
    ['unit(var(--x) + 1px, em)', 'calc((var(--x) + 1px) / 1px * 1em)'],
    ['spin(#c00, var(--a) + 10deg)', 'hsl(from #c00 calc(h + (var(--a) + 10deg) / 1deg) s l)'],
    ['darken(#c00, var(--a) + 5)', 'hsl(from #c00 h s clamp(0, l - (var(--a) + 5), 100))'],
    ['darken(#c00, var(--a) + 5%)', 'hsl(from #c00 h s clamp(0, l - (var(--a) + 5%) / 1%, 100))']
  ])('%s', async (source, form) => {
    await expect(value(source)).resolves.toBe(form);
  });

  it('stays a number form where structure does not give a type (Q3)', async () => {
    await expect(value('ceil(var(--x))')).resolves.toBe('round(up, var(--x), 1)');
    await expect(value('ceil(var(--x) * 2)')).resolves.toBe('round(up, var(--x) * 2, 1)');
    await expect(value('ceil(var(--x) + 1)')).resolves.toBe('round(up, var(--x) + 1, 1)');
  });
});

describe('an authored calc() a built-in takes', () => {
  it.each([
    ['percentage(calc(0.5 + 0.5))', '100%'],
    ['percentage(calc((1 + 1) * 2))', '400%'],
    ['ceil(calc(1px + 0.5px))', '2px'],
    ['round(calc(1.25 + 1), 1)', '2.3'],
    ['mod(calc(5px + 2px), 3)', '1px'],
    ['unit(calc(1px + 1px), em)', '2em'],
    ['convert(calc(1in + 1in), cm)', '5.08cm'],
    ['darken(#c00, calc(5% + 5%))', '#990000'],
    ['abs(calc(1px - 3px))', '2px']
  ])('computes %s where all its leaves are known', async (source, known) => {
    await expect(value(source)).resolves.toBe(known);
  });

  it('computes in every position', async () => {
    await expect(css('@x: calc(0.5 + 0.5);\n.a { b: percentage(@x); }')).resolves.toContain('b: 100%');
    await expect(css('.m(@x) { b: percentage(@x); }\n.a { .m(calc(0.5 + 0.5)); }')).resolves.toContain('b: 100%');
    await expect(value('1px solid percentage(calc(0.5 + 0.5))')).resolves.toBe('1px solid 100%');
    await expect(value('calc(percentage(calc(0.5 + 0.5)) - 1px)')).resolves.toBe('calc(100% - 1px)');
    await expect(value('percentage(calc(0.5 + 0.5))', { compress: true })).resolves.toBe('100%');
    for (const mathMode of ['always', 'parens-division', 'parens', 'strict']) {
      await expect(value('percentage(calc(0.5 + 0.5))', { mathMode })).resolves.toBe('100%');
    }
  });

  it('stays what it is where the compile cannot compute it', async () => {
    await expect(value('percentage(calc(1px + 1em))')).resolves.toBe('percentage(calc(1px + 1em))');
    await expect(value('percentage(calc(1 + 1px))')).resolves.toBe('percentage(calc(1 + 1px))');
    await expect(value('percentage(calc(1 / 0))')).resolves.toBe('percentage(calc(1 / 0))');
    await expect(value('percentage(calc(var(--a) + 1))')).resolves.toBe('calc((var(--a) + 1) * 100%)');
  });

  it('prints as written where nothing takes it', async () => {
    await expect(value('calc(0.5 + 0.5)')).resolves.toBe('calc(0.5 + 0.5)');
    await expect(value('rgb(calc(10 + 20), 0, 0)')).resolves.toBe('rgb(calc(10 + 20), 0, 0)');
  });
});

describe('other dialects', () => {
  it('.scss still rejects math on what only the browser knows outside a calculation', async () => {
    const compiler = new Compiler({});
    await expect(compiler.renderString('.a { b: (var(--a) * 2); }', { filePath: 'entry.scss', extension: '.scss' }))
      .rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it.each([
    ['.css', '.a { b: calc(var(--a) % 3); }', '.a {\n  b: calc(var(--a) % 3);\n}\n'],
    ['.scss', '.a { b: calc(var(--a) % 3); }', '.a {\n  b: calc(var(--a) % 3);\n}\n'],
    ['.css', '.a { b: translate((var(--a) * 2), 1px); }', '.a {\n  b: translate((var(--a) * 2), 1px);\n}\n'],
    ['.scss', '.a { b: translate((var(--a) * 2), 1px); }', '.a {\n  b: translate((var(--a) * 2), 1px);\n}\n']
  ])('%s keeps %s', async (extension, source, out) => {
    const compiler = new Compiler({});
    await expect(compiler.renderString(source, { filePath: `entry${extension}`, extension })).resolves.toBe(out);
  });

  it('.scss keeps its own math functions', async () => {
    const compiler = new Compiler({});
    await expect(compiler.renderString('.a { b: ceil(var(--a)); c: percentage(var(--a)); }', { filePath: 'entry.scss', extension: '.scss' }))
      .resolves.toBe('.a {\n  b: ceil(var(--a));\n  c: percentage(var(--a));\n}\n');
  });
});

describe('what only the browser knows, whatever its shape', () => {
  it('an unknown precision behaves as `var()` does', async () => {
    await expect(value('round(1.5, (var(--p) + 1))')).resolves.toBe('calc(sign(1.5) * round(abs(1.5), pow(10, -1 * (var(--p) + 1))))');
    await expect(value('round(1.5, var(--p))')).resolves.toBe('calc(sign(1.5) * round(abs(1.5), pow(10, -1 * var(--p))))');
  });

  it('`%` is `rem()`, as `mod()` is, and never `calc(... % ...)`', async () => {
    await expect(css('@a: var(--a); .x { y: (@a % 3); }')).resolves.toContain('y: rem(var(--a), 3);');
    await expect(value('(var(--a) % 3)')).resolves.toBe('rem(var(--a), 3)');
    await expect(value('(var(--a) % 3 * 2)')).resolves.toBe('calc(rem(var(--a), 3) * 2)');
    await expect(value('calc(var(--a) % 3)')).resolves.toBe('calc(rem(var(--a), 3))');
    await expect(value('max(var(--a) % 3, 1)')).resolves.toBe('max(rem(var(--a), 3), 1)');
  });

  it.each([
    ['(-var(--x) + 1)', 'calc(-1 * var(--x) + 1)'],
    ['(2 * -var(--x))', 'calc(2 * -1 * var(--x))'],
    ['-percentage(var(--x))', 'calc(-1 * var(--x) * 100%)'],
    ['(-percentage(var(--x)) + 1)', 'calc(-1 * var(--x) * 100% + 1)']
  ])('a glued minus is `-1 *` inside a form: %s', async (source, form) => {
    await expect(value(source)).resolves.toBe(form);
  });

  it.each([
    ['ceil(asin(var(--x)))', 'round(up, asin(var(--x)), 1)'],
    ['percentage(asin(var(--x)))', 'calc(asin(var(--x)) * 100%)'],
    ['ceil(hypot(var(--x),1px))', 'round(up, hypot(var(--x), 1px), 1)'],
    ['ceil(attr(x px))', 'round(up, attr(x px), 1)'],
    ['ceil((1px * var(--x) * 1px))', 'round(up, (1px * var(--x) * 1px), 1)'],
    ['percentage((1px / 1em * var(--x)))', 'calc((1px / 1em * var(--x)) * 100%)'],
    ['ceil((var(--x) + 1px))', 'round(up, (var(--x) + 1px), 1px)'],
    ['ceil((var(--x) * 2px / 2))', 'round(up, (var(--x) * 2px / 2), 1px)']
  ])('a unit is claimed only where the expression proves it: %s', async (source, form) => {
    await expect(value(source)).resolves.toBe(form);
  });

  it.each(['unit(var(--x), foo)', 'convert(var(--x), foo)'])('a unit CSS does not define has no form: %s', async (source) => {
    await expect(value(source)).resolves.toBe(source);
  });
});

describe('an operand math has no meaning for fails', () => {
  it('units a strict compile rejects, before the unknown part takes them', async () => {
    await expect(value('(1px * 1em * var(--x))', { unitMode: 'strict' })).rejects.toMatchObject({ code: 'eval/invalid-unit-arithmetic' });
    await expect(value('(1px * 1em * var(--x))')).resolves.toBe('calc(1px * 1em * var(--x))');
  });

  it.each([
    '@d: 1 / var(--x); .x { y: (@d + 1); }',
    '.x { y: ((1, 2) * var(--x)); }',
    '@l: 1, 2; .x { y: (@l * var(--x)); }'
  ])('a list: %s', async (source) => {
    await expect(css(source)).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('a slash list stays a list where nothing asks for its quotient', async () => {
    await expect(value('percentage(1 / var(--x))')).resolves.toBe('percentage(1 / var(--x))');
  });
});

describe('a `calc()` inside math or a form splices by structure', () => {
  it.each([
    ['((var(--b) + 1) / calc(var(--a) * 3))', 'calc((var(--b) + 1) / (var(--a) * 3))'],
    ['(2 / calc(var(--a) * 3))', 'calc(2 / (var(--a) * 3))'],
    ['(2px / calc(2px / 3))', 'calc(2px / (2px / 3))'],
    ['(2 - calc(var(--a) - 3))', 'calc(2 - (var(--a) - 3))'],
    ['(2 - calc(var(--a) + 3))', 'calc(2 - (var(--a) + 3))'],
    ['(2 * calc(var(--a) + 3))', 'calc(2 * (var(--a) + 3))'],
    ['(calc(var(--a) + 3) * 2)', 'calc((var(--a) + 3) * 2)'],
    ['(calc(var(--a) - 3) - 2)', 'calc((var(--a) - 3) - 2)'],
    ['(2 / calc(1px + 1em))', 'calc(2 / (1px + 1em))'],
    ['(calc(1px + 1em) + var(--x))', 'calc((1px + 1em) + var(--x))'],
    ['percentage(calc(var(--x) * 2))', 'calc(var(--x) * 2 * 100%)'],
    ['calc(convert(var(--a), px) / 2)', 'calc(var(--a) / 2)']
  ])('%s', async (source, form) => {
    await expect(value(source)).resolves.toBe(form);
  });

  it('a reference holding a `calc()` too', async () => {
    await expect(css('@x: var(--x); .y { z: percentage(calc(@x * 2)); }')).resolves.toContain('z: calc(var(--x) * 2 * 100%);');
  });
});

describe('a `calc()` resolves for a built-in only where CSS math types it', () => {
  it.each([
    'percentage(calc(1px * 2px))',
    'percentage(calc(10 % 3))',
    'ceil(calc(1px * 1em))',
    'ceil(calc(4px / 2em))',
    'floor(calc(1px * 1px))',
    'percentage(calc(1px * 1em))'
  ])('%s stays as written', async (source) => {
    await expect(value(source)).resolves.toBe(source);
  });

  it('`min()` reads a resolved `calc()` as it reads the number', async () => {
    await expect(value('min(calc(3px),3px)')).resolves.toBe('3px');
    await expect(value('min(calc(1px + 1px),3px)')).resolves.toBe('2px');
  });
});

describe('a bare slash under `math: always`', () => {
  it.each([
    ['background: url(a.png) center / var(--s) no-repeat;', 'background: url(a.png) center / var(--s) no-repeat;'],
    ['grid-column: var(--a) / span 2;', 'grid-column: var(--a) / span 2;'],
    ['grid: @x / auto-flow;', 'grid: var(--x) / auto-flow;'],
    ['content: "a" / @x;', 'content: "a" / var(--x);'],
    ['grid-row: 1 / var(--x);', 'grid-row: calc(1 / var(--x));'],
    ['grid-row: var(--y) / var(--x);', 'grid-row: calc(var(--y) / var(--x));']
  ])('%s', async (source, written) => {
    await expect(css(`@x: var(--x); .a { ${source} }`, { mathMode: 'always' })).resolves.toContain(written);
  });

  it.each(['parens-division', 'parens', 'strict'])('stays a separator under %s', async (mathMode) => {
    await expect(css('.a { grid-row: 1 / var(--x); }', { mathMode })).resolves.toContain('grid-row: 1 / var(--x);');
  });
});

describe('a group of math in a call written out', () => {
  it('is a `calc()`, there being no `(...)` in CSS', async () => {
    await expect(value('translate((var(--a)*2),1px)')).resolves.toBe('translate(calc(var(--a) * 2), 1px)');
    await expect(css('@v: (var(--x) * 2); .a { y: foo(@v); }')).resolves.toContain('y: foo(calc(var(--x) * 2));');
  });

  it('in a space or slash list too', async () => {
    await expect(value('image-set((var(--a) * 2) 1x)')).resolves.toBe('image-set(calc(var(--a) * 2) 1x)');
    await expect(value('foo(1px / (var(--a) * 2))')).resolves.toBe('foo(1px / calc(var(--a) * 2))');
    await expect(value('lch(50% 20 (var(--h) + 1))')).resolves.toBe('lch(50% 20 calc(var(--h) + 1))');
  });

  it.each([
    ['darken', ', 5%', 'hsl(from hsl(calc(var(--h, 10) + 1) 50% 50%) h s clamp(0, l - 5, 100))'],
    ['spin', ', 5', 'hsl(from hsl(calc(var(--h, 10) + 1) 50% 50%) calc(h + 5) s l)'],
    ['greyscale', '', 'hsl(from hsl(calc(var(--h, 10) + 1) 50% 50%) h 0 l)']
  ])('in a colour channel an exposed variable reaches: %s', async (name, rest, form) => {
    await expect(css(`@use "#less"; @expose h; @h: 10; .x { v: @less.${name}(hsl((@h + 1) 50% 50%)${rest}); }`)).resolves.toContain(`v: ${form};`);
  });

  it('in a colour channel `fade` reads', async () => {
    await expect(css('@use "#less"; @expose h; @h: 10; .x { v: @less.fade(hsl((@h + 1) 50% 50%), 50%); }')).resolves.toContain('v: rgb(from hsl(calc(var(--h, 10) + 1) 50% 50%) r g b / 0.5);');
    await expect(css('@use "#less"; .x { v: @less.fade(hsl((var(--h) + 1) 50% 50%), 50%); }')).resolves.toContain('v: rgb(from hsl(calc(var(--h) + 1) 50% 50%) r g b / 0.5);');
  });

  it('an alpha amount only the browser knows has no form yet', async () => {
    await expect(value('fade(#333, var(--a))')).resolves.toBe('fade(#333, var(--a))');
  });

  it('math the author wrote bare, or in a prefixed `calc()`, stays as written', async () => {
    await expect(value('foo(var(--a) * 2)')).resolves.toBe('foo(var(--a) * 2)');
    await expect(value('-webkit-calc((var(--x) + 1) * 2)')).resolves.toBe('-webkit-calc((var(--x) + 1) * 2)');
    await expect(value('-webkit-calc((var(--x) + 1))')).resolves.toBe('-webkit-calc((var(--x) + 1))');
  });
});

describe('compress and type reads over kept math', () => {
  it('kept math writes its numbers compressed', async () => {
    await expect(value('(var(--x) * 0.5)', { compress: true })).resolves.toBe('calc(var(--x) * .5)');
    await expect(value('(var(--a) % 0.5)', { compress: true })).resolves.toBe('rem(var(--a),.5)');
  });

  it('`isnumber` answers math and its form alike', async () => {
    await expect(value('isnumber((var(--a) * 100%))')).resolves.toBe('true');
    await expect(value('isnumber(percentage(var(--a)))')).resolves.toBe('true');
  });
});

describe('`%` over a list', () => {
  const lists = ['(@l % var(--x))', '(var(--x) % @l)', '(var(--x) % (1, 2))', '((1, 2) % var(--x))'];
  it.each(['always', 'parens-division', 'parens', 'strict'].flatMap(mathMode => lists.map(source => [mathMode, source])))('under %s: %s fails as `*` does', async (mathMode, source) => {
    await expect(css(`@l: 1, 2; .a { b: ${source}; }`, { mathMode })).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });
});

describe('a glued minus in a slot of a form is the math it means', () => {
  it.each([
    ['ceil(-var(--x))', 'round(up, -1 * var(--x), 1)'],
    ['percentage(-var(--x))', 'calc(-1 * var(--x) * 100%)'],
    ['unit(-var(--x), px)', 'calc(-1 * var(--x) * 1px)'],
    ['mod(-var(--x), 3)', 'rem(-1 * var(--x), 3)'],
    ['darken(#c00, -var(--a))', 'hsl(from #c00 h s clamp(0, l - -1 * var(--a) / 1%, 100))'],
    ['spin(#c00, -var(--a))', 'hsl(from #c00 calc(h + -1 * var(--a)) s l)'],
    ['mix(#c00, #fff, -var(--a))', 'color-mix(in srgb, #c00 calc(-1 * var(--a)), #fff)']
  ])('%s', async (source, form) => {
    await expect(value(source)).resolves.toBe(form);
  });
});

describe('an export inside a larger argument, by what the slot holds at compile time', () => {
  const exposed = (held: string, source: string): string => `@use "#less"; @expose a; @a: ${held}; .x { v: ${source}; }`;

  it.each([
    ['5px', '@less.ceil((@a * 2))'],
    ['5px', '@less.percentage((@a * 2))'],
    ['5px', '@less.unit((@a * 2), em)'],
    ['5px', '@less.round((@a * 2))'],
    ['5', '@less.darken(#c00, (@a * 2))'],
    ['5px', '@less.spin(#c00, (@a * 2))'],
    ['5px', '@less.ceil(calc(@a * 2))']
  ])('@a: %s; %s has no form that holds it and no recipe', async (held, source) => {
    await expect(css(exposed(held, source))).rejects.toMatchObject({ code: 'eval/expose-not-a-value' });
  });

  it.each([
    ['5px', '@less.mod((@a * 2), 3px)', 'rem((var(--a, 5px) * 2), 3px)'],
    ['5', '@less.ceil((@a * 2))', 'round(up, (var(--a, 5) * 2), 1)'],
    ['5%', '@less.darken(#c00, (@a * 2))', 'hsl(from #c00 h s clamp(0, l - (var(--a, 5%) * 2) / 1%, 100))']
  ])('@a: %s; %s is its form', async (held, source, form) => {
    await expect(css(exposed(held, source))).resolves.toContain(`v: ${form};`);
  });

  it('a bare dividend beside a divisor of its unit is the form too', async () => {
    await expect(css(exposed('5px', '@less.mod(@a, 3px)'))).resolves.toContain('v: rem(var(--a, 5px), 3px);');
  });

  it('a dividend with no unit beside a divisor with one keeps its recipe', async () => {
    const result = await new Compiler({}).renderToResult({ ...options, source: exposed('5', '@less.mod(@a, 3px)') });
    expect(result.css).toContain('v: var(--a-mod, 2);');
    expect(Object.keys(result.runtime?.derived ?? {})).toEqual(['--a-mod']);
  });
});

describe('known gap: an all-known math function written out under `@use`', () => {
  it.each([
    '@a: min(.1, .2); .x { v: @less.rgba(#c00, @a); }',
    '@a: min(1, 2); .x { v: @less.hsv(@a, 50%, 50%); }',
    '@a: min(1px, 2px); .x { v: @less.tint(#c00, @a); }',
    '@a: min(1px, 2px); .x { v: @less.ceil(@a); }',
    '.x { v: @less.rgba(#c00, min(.1, .2)); }',
    '.x { v: @less.rgba(#c00, min(1%, 2vw)); }',
    '.x { v: @less.darken(#c00, clamp(1%, 2vw, 3%)); }'
  ])('is neither a number the compile reads nor a value a form takes: %s', async (source) => {
    await expect(css(`@use "#less"; @expose a; ${source}`)).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });
});

describe('a slash under `math: always` is math only over numbers', () => {
  it.each([
    '1 / var(--c) / span 2 / span 3',
    'var(--r) / var(--c) / span 2 / span 3',
    'var(--a) / 2 / span 2',
    'repeat(2, 1fr) / var(--x)',
    'var(--x) / repeat(2, 1fr)',
    'minmax(1px, 2px) / var(--x)',
    'fit-content(10px) / var(--x)',
    'linear-gradient(red, blue) / var(--x)'
  ])('%s stays as written', async (source) => {
    await expect(value(source, { mathMode: 'always' })).resolves.toBe(source);
  });

  it('two known numbers beside a chain still divide, as in `span 2 / 3`', async () => {
    await expect(value('1 / var(--c) / span 2 / 3', { mathMode: 'always' })).resolves.toBe('1 / var(--c) / span 0.6666666667');
  });

  it.each([
    ['1 / var(--x) / 2', 'calc(1 / var(--x) / 2)'],
    ['var(--x) / env(--y)', 'calc(var(--x) / env(--y))'],
    ['attr(a) / 2', 'calc(attr(a) / 2)'],
    ['ceil(var(--x)) / 2', 'calc(round(up, var(--x), 1) / 2)']
  ])('%s is math', async (source, math) => {
    await expect(value(source, { mathMode: 'always' })).resolves.toBe(math);
  });
});

describe('a `%` in a math function under compress', () => {
  it('writes its numbers as `%` anywhere does', async () => {
    await expect(css('.a{b:calc(var(--x) % 0.5)}', { compress: true })).resolves.toContain('calc(rem(var(--x),.5))');
    await expect(css('.a{b:max(var(--x) % 0.5,0.25)}', { compress: true })).resolves.toContain('max(rem(var(--x),.5),.25)');
  });
});
