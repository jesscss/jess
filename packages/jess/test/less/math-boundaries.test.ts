import { describe, expect, it } from 'vitest';
import { parse as parseCss } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import { Compiler } from '../../src/index.js';

/*
 * Where Less math does and does not reach, now that every slash is the division
 * rule's and computed math lowers into an `Expression` (DESIGN-DECISIONS
 * P34/P35).
 */
async function render(source: string, compile: { mathMode?: 'always' | 'parens-division' | 'parens'; unitMode?: 'strict' | 'loose' | 'preserve' } = {}): Promise<string> {
  const css = await new Compiler({ compile }).renderString(source, { language: 'less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderJess(source: string): Promise<string> {
  const css = await new Compiler().renderString(source, { language: 'jess', extension: '.jess' });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderIn(extension: '.less' | '.scss' | '.jess', source: string, compress = false): Promise<string> {
  const css = await new Compiler({ output: { compress } }).renderString(source, { extension });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderCss(source: string, compress = false): Promise<string> {
  return (await serialize(parseCss(source), { collapseNesting: false, compress })).css.replace(/\s+/g, ' ').trim();
}

describe('Less math boundaries', () => {
  /*
   * Math inside a math function is kept as written, in every dialect — owner
   * 2026-09-24 (DESIGN-DECISIONS P35): its result is clamped to what the
   * property allows (css-values-4 §10.12), so folding changes the value.
   */
  it('keeps calc() math as written, substituting variables', async () => {
    expect(await render('@a: 10px; .x { w: calc(@a * 2); p: calc(1px - 5px); }'))
      .toBe('.x { w: calc(10px * 2); p: calc(1px - 5px); }');
    expect(await render('@v: 50vh/2; .x { w: calc(50% + (@v - 20px)); }', { unitMode: 'strict' }))
      .toBe('.x { w: calc(50% + (50vh / 2 - 20px)); }');
  });

  /*
   * Nothing computes inside a math function, so nothing consumes a paren written
   * there: every authored group is kept, redundant or not — owner 2026-10-06,
   * "no reason to drop parens. the user wanted to write it that way for a reason."
   */
  it('keeps every paren authored inside calc(), in .less and .jess', async () => {
    expect(await render('@v: 10px; .x { w: calc(100% - ((@v * 3) + (@v * 2))); h: calc(100% + (25vh - 20px)); }'))
      .toBe('.x { w: calc(100% - ((10px * 3) + (10px * 2))); h: calc(100% + (25vh - 20px)); }');
    expect(await render('@v: 10px; .x { a: calc((@v)); b: calc( (1px + 2px) ); c: calc(100% - (((@v + @v)))); }'))
      .toBe('.x { a: calc((10px)); b: calc((1px + 2px)); c: calc(100% - (((10px + 10px)))); }');
    expect(await renderJess('$v: 10px; .x { w: calc(100% - (($v * 3) + ($v * 2))); }'))
      .toBe('.x { w: calc(100% - ((10px * 3) + (10px * 2))); }');
    expect(await renderJess('.x { w: calc(10px / (2 * 5)); v: calc(((10vh)) + calc((5vh))); }'))
      .toBe('.x { w: calc(10px / (2 * 5)); v: calc(((10vh)) + calc((5vh))); }');
  });

  /*
   * The authored spelling is a property of the value, not of the path that
   * reached calc(): the same `calc((…))` prints the same bytes in every
   * position, while a typed consumer still reads its magnitude
   * (SEMANTIC-INVARIANTS 1 and 2).
   */
  it('spells a calc() paren group the same in every position', async () => {
    for (const v of ['calc((10px))', 'calc((1px + 2vw))', 'calc(100% - (10px))', 'calc(((5vh)))', 'calc((0.5px))']) {
      const out = await render(`@x: ${v}; @list: ${v}, 2px;
        .m(@a) { m: @a; } .d(@a: ${v}) { d: @a; } .r(@a...) { r: @a; }
        .x { decl: ${v}; var: @x; .m(${v}); .d(); .r(${v}); ext: extract(@list, 1); each(@list, { e: @value; }); }`);
      expect(out, v).toBe(`.x { decl: ${v}; var: ${v}; m: ${v}; d: ${v}; r: ${v}; ext: ${v}; e: ${v}; e: 2px; }`);
    }
    expect(await renderJess('$x: calc((10px)); .x { w: calc(min(calc((5vh)), 2px) * 2); v: $x; }'))
      .toBe('.x { w: calc(min(calc((5vh)), 2px) * 2); v: calc((10px)); }');
    expect(await render('@x: calc((10px)); .x when (@x = 10px) { a: unit(@x, em); b: @x * 2; c: percentage(calc((0.5))); }'))
      .toBe('.x { a: 10em; b: 20px; c: 50%; }');
  });

  /* A group around kept math or around raw bytes holds nothing that computes. */
  it('keeps a paren group written in a math function argument, as css does', async () => {
    for (const src of [
      '.x { w: calc(var(--a, (1px + 2px)) + (3px)); }',
      '.x { w: calc(var(--a, (1px + 2px))); }',
      '.x { w: var(--a, (1px + 2px)); }',
      '.x { w: min((10px + 5px), 20px); }',
      '.x { w: clamp(1px, (2vw + 1px), 3px); }',
      '.x { w: calc((1px + 2vw) * 2); v: calc(((1px + 2vw))); }'
    ]) {
      expect(await renderJess(src), src).toBe(await renderCss(src));
    }
    expect(await render('.x { w: calc(var(--a, (1px + 2px)) + (3px)); }'))
      .toBe('.x { w: calc(var(--a, (1px + 2px)) + (3px)); }');
  });

  /* A calc() group is valid CSS with one parse in all four grammars (SEMANTIC-INVARIANTS 4). */
  it('emits a calc() group around one value identically in every dialect', async () => {
    const src = '.x { a: calc((10px)); b: calc(((5vh))); }';
    const css = await renderCss(src);
    expect(css).toBe('.x { a: calc((10px)); b: calc(((5vh))); }');
    for (const extension of ['.less', '.scss', '.jess'] as const) {
      expect(await renderIn(extension, src), extension).toBe(css);
    }
  });

  /* The interior of a kept calc() is written as authored under compress, group or not. */
  it('does not compress inside a kept calc(), with or without a group', async () => {
    for (const extension of ['.less', '.jess'] as const) {
      expect(await renderIn(extension, '.x { a: calc((0.5px)); b: calc(1px + (0.5px)); c: calc((0.5px + 1px)); d: calc(0.5px + 1vw); }', true), extension)
        .toBe('.x{a:calc((0.5px));b:calc(1px + (0.5px));c:calc((0.5px + 1px));d:calc(0.5px + 1vw)}');
    }
  });

  /* A sign is not an operator the math mode governs (tests-config/math/strict/parens.css). */
  it('negates a variable or group in every math mode', async () => {
    for (const mathMode of ['always', 'parens-division', 'parens'] as const) {
      expect(await render('@var: 1; @w: 2px; .x { a: -@var; b: -(@var); c: -@w; d: -(@w * 2); }', { mathMode }), mathMode)
        .toBe('.x { a: -1; b: -1; c: -2px; d: -4px; }');
    }
  });

  /*
   * A group is consumed only by what computes in it; a group around one value
   * nothing computes keeps its parens, in every dialect (SEMANTIC-INVARIANTS 4;
   * orchestrator judgment under owner delegation 2026-10-06).
   */
  it('emits a paren group around one value identically in every dialect', async () => {
    const src = '.x { c: (10vh); d: var(--a, (10px)); e: calc(var(--a, ((5vh)))); f: (red) (1px); g: (10px) / 2; '
      + 'h: (var(--x)); i: (calc(1px + 1vw)); j: (foo(1)); k: var(--a, (rgb(1, 2, 3))); l: (rgb(1, 2, 3)); }';
    const css = await renderCss(src);
    expect(css).toBe('.x { c: (10vh); d: var(--a, (10px)); e: calc(var(--a, ((5vh)))); f: (red) (1px); g: (10px) / 2; '
      + 'h: (var(--x)); i: (calc(1px + 1vw)); j: (foo(1)); k: var(--a, (rgb(1, 2, 3))); l: (rgb(1, 2, 3)); }');
    for (const extension of ['.less', '.scss', '.jess'] as const) {
      expect(await renderIn(extension, src), extension).toBe(css);
    }
    expect(await renderJess('.x { w: min((10px), 1px); }')).toBe('.x { w: min((10px), 1px); }');
    expect(await render('@w: 10px; @c: foo(1); .x { a: (@w); b: ((10px)); c: (@c); d: (10px) * 2; e: percentage((0.5)); }'))
      .toBe('.x { a: (10px); b: ((10px)); c: (foo(1)); d: 20px; e: 50%; }');
  });

  /*
   * Once something computes, the parens do not survive (DESIGN-DECISIONS F4): a
   * call a callable computes, a `.jess` `$( … )`, and a variable or mixin
   * parameter bound to math, exactly as a group around the math itself.
   */
  it('consumes a paren group around anything that computes', async () => {
    expect(await render('.a { b: 1px solid (darken(red, 10%)); w: (percentage(0.5)); u: (unit(5, px)); e: (e("x")); f: (if(true, a, b)); }'))
      .toBe('.a { b: 1px solid #cc0000; w: 50%; u: 5px; e: x; f: a; }');
    expect(await renderIn('.scss', '.a { w: (percentage(0.5)); b: solid (darken(red, 10%)); }'))
      .toBe('.a { w: 50%; b: solid #cc0000; }');
    expect(await renderJess('.a { a: ($(1px + 2px)); b: ($(foo + 1)); }')).toBe('.a { a: 3px; b: (foo + 1); }');
    expect(await render('@a: 1px + 2px; .x { b: (@a); }')).toBe('.x { b: 3px; }');
    expect(await render('@a: 1px + 2px; .x { b: (@a); c: @a; }', { mathMode: 'parens' }))
      .toBe('.x { b: 3px; c: 1px + 2px; }');
    expect(await render('.m(@x) { b: (@x); } .x { .m(1px + 2px); } .y { .m(percentage(0.5)); }'))
      .toBe('.x { b: 3px; } .y { b: 50%; }');
  });

  /*
   * Math kept as written computes nothing, so a group written as one of its
   * operands keeps its parens (DESIGN-DECISIONS P35, unitless ± unit, owner
   * 2026-10-06), while math that computes reads the value inside.
   */
  it('keeps the parens of an operand of math kept as written', async () => {
    expect(await render('.x { a: (10px) + 1; c: 1 + (10px); d: ((10px)) + 1; e: foo + (1px); f: (1px) + foo; }'))
      .toBe('.x { a: (10px) + 1; c: 1 + (10px); d: ((10px)) + 1; e: foo + (1px); f: (1px) + foo; }');
    expect(await render('.x { a: (10px) + 1; }', { unitMode: 'loose' })).toBe('.x { a: 11px; }');
  });

  /* A parameter stands for its argument as written, as a variable does (SEMANTIC-INVARIANTS 2). */
  it('binds a mixin argument written as a group with its parens', async () => {
    expect(await render('@g: (10px); .m(@x) { a: @x; b: @x * 2; } .d(@x: (10px)) { a: @x; } .x { a: @g; .m((10px)); .d(); }'))
      .toBe('.x { a: (10px); a: (10px); b: 20px; a: (10px); }');
    expect(await renderIn('.scss', '@mixin m($x) { a: $x; } .x { @include m((10px)); }')).toBe('.x { a: (10px); }');
    expect(await renderIn('.less', '.m(@x) { b: @x; } .x { .m((0.5px)); c: (0.5px); }', true)).toBe('.x{b:(0.5px);c:(0.5px)}');
  });

  it('still consumes the parens of Less math outside a math function', async () => {
    expect(await render('@v: 1; .x { a: (1px + 2px) 3px; b: -(@v); c: ((1px + 2px)); }'))
      .toBe('.x { a: 3px 3px; b: -1; c: 3px; }');
    expect(await render('.x { w: 4px * (1 + 1) / 4 + 3px; v: 2 * (1px + 1em); }', { mathMode: 'parens' }))
      .toBe('.x { w: 4px * 2 / 4 + 3px; v: 2 * calc(1px + 1em); }');
  });

  /*
   * Division by zero is an evaluation error in every unit mode (owner
   * 2026-09-24, DESIGN-DECISIONS P35): the author opted into division and there
   * is no quotient to print. This is the case the `units/loose` and
   * `units/no-strict` fixtures used to carry as `ignores 0/0 rules`.
   */
  it('raises on division by zero under math: always, in every unit mode', async () => {
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      await expect(render('.x { font: ignores 0/0 rules; }', { mathMode: 'always', unitMode }), unitMode)
        .rejects.toMatchObject({ code: 'eval/division-by-zero' });
      await expect(render('.x { w: (1px / 0); }', { unitMode }), unitMode)
        .rejects.toMatchObject({ code: 'eval/division-by-zero' });
    }
    expect(await render('.x { font: ignores 0/0 rules; }')).toBe('.x { font: ignores 0 / 0 rules; }');
  });

  it('keeps calc() around a value that is not one number', async () => {
    expect(await render('@v: 50vh/2; .x { w: calc(@v); }')).toBe('.x { w: calc(50vh / 2); }');
  });

  it('keeps the parens of an authored group that a preserved call does not evaluate', async () => {
    expect(await render('.x { w: hsl(210, percentage((20 / 20)), 50%); }'))
      .toBe('.x { w: hsl(210, percentage((20 / 20)), 50%); }');
  });

  it('validates the units of every slash-list side, as it does a lone operation', async () => {
    await expect(render('.x { w: 2px*3px/1px; }', { unitMode: 'strict' })).rejects.toThrow('Invalid unit arithmetic');
    await expect(render('.x { w: 2px*3px; }', { unitMode: 'strict' })).rejects.toThrow('Invalid unit arithmetic');
  });

  it('gives an @import media postlude the same query value as @media', async () => {
    expect(await render('@import url(a.css) (min-width: 2*3px);')).toBe('@import url(a.css) (min-width: 6px);');
    expect(await render('@media (min-width: 2*3px) { .y { k: 1; } }')).toBe('@media (min-width: 6px) { .y { k: 1; } }');
  });

  it('leaves a <declaration-value> payload literal: style() and var() fallbacks', async () => {
    expect(await render('@a: 3; @container style(--x: @a * 2) { .y { k: 1; } }'))
      .toBe('@container style(--x: 3 * 2) { .y { k: 1; } }');
    expect(await render('@a: 3; .x { w: var(--y, @a * 2); v: var(--y, 4 / 2 + 5em); }'))
      .toBe('.x { w: var(--y, 3 * 2); v: var(--y, 4 / 2 + 5em); }');
    expect(await render('.x { w: var(--y, 1/2); }', { mathMode: 'always' })).toBe('.x { w: var(--y, 1/2); }');
  });
});
