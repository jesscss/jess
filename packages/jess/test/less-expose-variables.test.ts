import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Ledger A4 (owner 2026-11-01): a variable named by `@expose` publishes a
 * custom property (`@expose brand, gap;`, A20). Every CSS value that reads it is `var(--name, <its
 * compile-time value>)`; a read where a `var()` cannot stand in is an error,
 * and an exposed variable nothing reads is a no-op. Browser-runtime spec, slice 1.
 */
async function render(source: string, compress = false): Promise<string> {
  const compiler = new Compiler(compress ? { output: { compress: true } } : {});
  return String(await compiler.renderString(source, { filePath: 'entry.less', extension: '.less', suppressWarnings: true }));
}

async function result(source: string) {
  return new Compiler({}).renderToResult({ filePath: 'entry.less', source, language: 'less' });
}

async function runtime(source: string): Promise<unknown> {
  return (await new Compiler({}).renderToResult({ filePath: 'entry.less', source, language: 'less' })).runtime;
}

describe('Less @expose variables (A4)', () => {
  it.each([
    ['@r: 10; .x { v: @less.rgb(@r, 0, 0); }', 'v: rgb(var(--r, 10), 0, 0);'],
    ['@r: 10%; .x { v: @less.rgb(@r, 0, 0); }', 'v: rgb(calc(var(--r, 0.1) * 100%), 0, 0);'],
    ['@r: 2px; .x { v: @less.rgb(@r, 0, 0); }', 'v: rgb(calc(var(--r, 2px) / 1px), 0, 0);'],
    ['@h: 30; .x { v: @less.hsv(@h, 50%, 75%); }', 'v: hwb(var(--h, 30) 37.5% 25%);'],
    ['@h: 30deg; .x { v: @less.hsv(@h, 50%, 75%); }', 'v: hwb(var(--h, 30deg) 37.5% 25%);'],
    ['@h: 30px; .x { v: @less.hsv(@h, 50%, 75%); }', 'v: hwb(calc(var(--h, 30px) / 1px) 37.5% 25%);'],
    ['@a: 50%; .x { v: @less.rgba(#c00, @a); }', 'v: rgb(from #c00 r g b / calc(var(--a, 0.5) * 100%));'],
    ['@a: 2px; .x { v: @less.rgba(#c00, @a); }', 'v: rgb(from #c00 r g b / calc(var(--a, 2px) / 1px));'],
    ['@b: 5px; .x { v: @less.mod(10px, @b); }', 'v: rem(10px, var(--b, 5px));'],
    ['@b: 5px; .x { v: @less.mod(10em, @b); }', 'v: rem(10em, var(--b, 5px) / 1px * 1em);']
  ])('one slot field answers whether a form holds the value: %s', async (source, written) => {
    const name = /@(\w+):/.exec(source)?.[1];
    await expect(render(`@use "#less";\n@expose ${name};\n${source}`)).resolves.toContain(written);
  });

  it('a built-in reading an exposed slash list keeps its recipe', async () => {
    const css = await render('@use "#less";\n@expose a;\n@a: 1/2;\n.x { b: @less.percentage(@a); c: @less.ceil(@a); }');
    expect(css).toContain('b: var(--a-percentage, 50%);');
    expect(css).toContain('c: var(--a-ceil, 1);');
  });

  it.each([
    ['@expose brand;\n@brand: #c00;\n.btn { color: @brand; }', 'color: var(--brand, #c00);'],
    ['@-expose brand;\n@brand: #c00;\n.btn { color: @brand; }', 'color: var(--brand, #c00);'],
    ['@expose brand;\n@brand: #c00;\n.btn { border: 1px solid @brand; }', 'border: 1px solid var(--brand, #c00);'],
    ['@expose brand;\n@brand: #c00;\n@accent: @brand;\n.btn { color: @accent; }', 'color: var(--brand, #c00);'],
    ['.btn { color: @brand; }\n@expose brand;\n@brand: #c00;', 'color: var(--brand, #c00);'],
    ['@expose fonts;\n@fonts: Inter, sans-serif;\nbody { font-family: @fonts; }', 'font-family: var(--fonts, Inter, sans-serif);'],
    ['@expose gap;\n@gap: 8px;\n.grid { gap: calc(@gap * 2); }', 'gap: calc(var(--gap, 8px) * 2);'],
    ['@expose gap;\n@gap: 8px;\n.grid { gap: @gap * 2; }', 'gap: calc(var(--gap, 8px) * 2);'],
    ['@expose brand;\n@brand: #c00;\n.btn { background: color-mix(in srgb, @brand, white); }', 'background: color-mix(in srgb, var(--brand, #c00), white);'],
    ['@expose brand;\n@brand: #c00 !important;\n.btn { color: @brand; }', 'color: var(--brand, #c00) !important;'],
    ['@expose gap;\n@gap: 8px;\n.grid { gap: @{gap}; }', 'gap: var(--gap, 8px);'],
    ['@expose gap;\n@gap: 8px;\n.grid { gap: foo(@gap); }', 'gap: foo(var(--gap, 8px));'],
    ['@expose brand;\n@brand: #c00;\n.btn { color: isdefined(@brand); }', 'color: true;']
  ])('writes a read of the exposed variable as var(): %s', async (source, expected) => {
    await expect(render(source)).resolves.toContain(expected);
  });

  it('writes a compressed var() in compressed output', async () => {
    await expect(render('@expose brand;\n@brand: #c00;\n.btn { color: @brand; }', true)).resolves.toBe('.btn{color:var(--brand,#c00)}');
  });

  it('leaves a nested shadow of the name its own value', async () => {
    await expect(render('@expose brand;\n@brand: #c00;\n.btn { @brand: blue; color: @brand; }')).resolves.toContain('color: blue;');
  });

  /* jesscss/jess#568: the declaration behind a read's var() is excluded while it evaluates. */
  it('reads the earlier declaration when an exposed variable is redeclared in terms of itself', async () => {
    await expect(result('@brand: 1px;\n@expose brand;\n.a { c: @brand; }\n@brand: @brand + 1;'))
      .resolves.toMatchObject({ css: '.a {\n  c: var(--brand, 2px);\n}\n', errors: [] });
  });

  it('is a no-op when nothing reads the exposed variable', async () => {
    await expect(render('@expose brand;\n@brand: #c00;\n.btn { color: red; }')).resolves.toBe('.btn {\n  color: red;\n}\n');
  });

  it('puts the document in modern mode (P36)', async () => {
    await expect(render('@expose brand;\n@brand: #c00;\n.btn { width: round(1.5px); }')).resolves.toContain('width: round(1.5px);');
  });

  it.each([
    ['a selector', '@expose size;\n@size: lg;\n.btn-@{size} { padding: 0; }'],
    ['a media query', '@expose bp;\n@bp: 640px;\n@media (min-width: @bp) { .a { b: c; } }'],
    ['a guard', '@expose theme;\n@theme: dark;\n.a when (@theme = dark) { b: c; }'],
    ['a string', '@expose icon;\n@icon: star;\n.a { content: "@{icon}"; }'],
    ['a url', '@expose icon;\n@icon: star;\n.a { background: url("@{icon}.svg"); }'],
    ['a guard on a mixin argument', '@expose brand;\n@brand: #c00;\n.tint(@c) when (iscolor(@c)) { color: @c; }\n.btn { .tint(@brand); }'],
    ['a guard, computed', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a when (@less.lightness(@brand) > 10%) { b: c; }'],
    ['text spliced around it', '@expose n;\n@n: 2;\n.a { width: @{n}px; }'],
    ['a larger argument of a computed function', '@use "#less";\n@expose w;\n@w: 8px;\n@a: @w 2;\n.a { v: @less.length(@a); }'],
    ['a larger mixin argument a computed function reads', '@use "#less";\n@expose w;\n@w: 8px;\n.m(@a) { v: @less.length(@a); }\n.a { .m(@w 2); }'],
    ['a guard on a computed mixin argument', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@l) when (@l > 10%) { v: yes; }\n.a { .m(@less.lightness(@brand)); }'],
    ['a selector from a computed mixin argument', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@l) { .x-@{l} { v: 1; } }\n.a { .m(@less.lightness(@brand)); }'],
    ['a string from a computed mixin argument', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@l) { content: "@{l}"; }\n.a { .m(@less.lightness(@brand)); }'],
    ['a selector from a rest parameter', '@expose size;\n@size: lg;\n.m(@rest...) { .x-@{rest} { v: 1; } }\n.a { .m(@size); }'],
    ['a string from a rest parameter', '@expose icon;\n@icon: star;\n.m(@rest...) { content: "@{rest}"; }\n.a { .m(@icon); }'],
    ['a selector from @arguments', '@expose size;\n@size: lg;\n.m(@a) { .x-@{arguments} { v: 1; } }\n.a { .m(@size); }'],
    ['a guard on a rest parameter', '@expose w;\n@w: 8px;\n.m(@rest...) when (@rest > 10%) { v: yes; }\n.a { .m(@w); }'],
    ['a guard on @arguments', '@expose w;\n@w: 8px;\n.m(@a) when (@arguments > 10%) { v: yes; }\n.a { .m(@w); }'],
    ['a type guard on a rest parameter', '@expose brand;\n@brand: #c00;\n.m(@rest...) when (iscolor(@rest)) { v: yes; }\n.a { .m(@brand); }'],
    ['a computed function of a rest parameter among others', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@rest...) { v: @less.length(@rest); }\n.a { .m(@brand; 2); }']
  ])('rejects a read in %s', async (_where, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/expose-not-a-value' });
  });

  it.each([
    ['a mixin argument', '@expose brand;\n@brand: #c00;\n.tint(@c) { color: @c; }\n.btn { .tint(@brand); }', 'color: var(--brand, #c00);'],
    ['a mixin argument in a list', '@expose w;\n@w: 8px;\n.m(@a) { margin: @a; }\n.a { .m(@w 2px); }', 'margin: var(--w, 8px) 2px;'],
    ['a mixin default', '@expose brand;\n@brand: #c00;\n.tint(@c: @brand) { color: @c; }\n.btn { .tint(); }', 'color: var(--brand, #c00);'],
    ['a computed function', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.lightness(@brand); }', 'v: var(--brand-lightness, 40%);'],
    ['a computed function of a list', '@use "#less";\n@expose list;\n@list: a, b, c;\n.a { v: @less.length(@list); }', 'v: var(--list-length, 3);'],
    ['a computed function of a mixin argument', '@use "#less";\n@expose brand;\n@brand: #c00;\n.tint(@c) { color: @less.lightness(@c); }\n.btn { .tint(@brand); }', 'color: var(--brand-lightness, 40%);'],
    ['nested computed functions', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.luma(@less.multiply(@brand, #888)); }', 'v: var(--brand-luma, 3.2512099914%);'],
    ['a computed mixin argument a computed function reads', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@c) { v: @less.lightness(@c); }\n.a { .m(@less.darken(@brand, 10%)); }', 'v: var(--brand-lightness, 30%);'],
    ['a direct mixin argument', '@expose brand;\n@brand: #c00;\n.m(@c) { color: @c; }\n.a { .m(@brand); }', 'color: var(--brand, #c00);'],
    ['a rest parameter', '@expose w;\n@w: 8px;\n.m(@rest...) { margin: @rest; }\n.a { .m(@w); }', 'margin: var(--w, 8px);'],
    ['@arguments', '@expose w;\n@w: 8px;\n.m(@a) { margin: @arguments; }\n.a { .m(@w); }', 'margin: var(--w, 8px);'],
    ['a computed function of a rest parameter', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@rest...) { v: @less.lightness(@rest); }\n.a { .m(@brand); }', 'v: var(--brand-lightness, 40%);'],
    ['a computed function in calc()', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: calc(@less.lightness(@brand) * 2); }', 'v: calc(var(--brand-lightness, 40%) * 2);'],
    ['a function with a CSS form', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.darken(@brand, 10%); }', 'v: hsl(from var(--brand, #c00) h s clamp(0, l - 10, 100));'],
    ['nested CSS forms', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.lighten(@less.darken(@brand, 10%), 5%); }', 'v: hsl(from hsl(from var(--brand, #c00) h s clamp(0, l - 10, 100)) h s clamp(0, l + 5, 100));'],
    ['a CSS form as a mixin argument', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@c) { v: @c; }\n.a { .m(@less.darken(@brand, 10%)); }', 'v: hsl(from var(--brand, #c00) h s clamp(0, l - 10, 100));'],
    ['a CSS form of a mixin argument', '@use "#less";\n@expose brand;\n@brand: #c00;\n.m(@c) { v: @less.darken(@c, 10%); }\n.a { .m(@brand); }', 'v: hsl(from var(--brand, #c00) h s clamp(0, l - 10, 100));'],
    ['a unit, which picks no form', '@use "#less";\n@expose u;\n@u: em;\n.b { v: @less.unit(5px, @u); }', 'v: var(--u-unit, 5em);'],
    ['a method, which picks no form', '@use "#less";\n@expose m;\n@m: relative;\n.b { v: @less.darken(#c00, 10%, @m); }', 'v: var(--m-darken, #b80000);']
  ])('follows the exposed variable through %s', async (_what, source, expected) => {
    await expect(render(source)).resolves.toContain(expected);
  });

  it.each([
    ['an amount', '@use "#less";\n@expose a;\n@a: 10%;\n.b { v: @less.darken(#c00, @a); }', 'v: hsl(from #c00 h s clamp(0, l - var(--a, 0.1) * 100, 100));'],
    ['a percentage turned into a length', '@use "#less";\n@expose a;\n@a: 50%;\n.b { v: @less.unit(@a, px); }', 'v: calc(var(--a, 0.5) * 100 * 1px);'],
    ['a number', '@use "#less";\n@expose a;\n@a: 0.5;\n.b { v: @less.percentage(@a); }', 'v: calc(var(--a, 0.5) * 100%);'],
    ['a divisor in the dividend\'s unit', '@use "#less";\n@expose a;\n@a: 2px;\n.b { v: @less.mod(5px, @a); }', 'v: rem(5px, var(--a, 2px));'],
    ['a divisor in the dividend\'s unit, in any case', '@use "#less";\n@expose a;\n@a: 2px;\n.b { v: @less.mod(5PX, @a); }', 'v: rem(5PX, var(--a, 2px));'],
    ['decimal places on a length', '@use "#less";\n@expose a;\n@a: 2;\n.b { v: @less.round(1px, @a); }', 'v: calc(sign(1px) * round(abs(1px), pow(10, -1 * var(--a, 2)) * 1px));']
  ])('takes the exposed variable in a form that holds its value: %s', async (_what, source, expected) => {
    await expect(render(source)).resolves.toContain(expected);
  });

  it.each([
    ['a colour', '@expose c;\n@c: #c00;\n.a { v: (@c * 2); }'],
    ['a colour keyword', '@expose c;\n@c: red;\n.a { v: (@c * 2); }'],
    ['a keyword', '@expose c;\n@c: foo;\n.a { v: (@c * 2); }'],
    ['a string', '@expose c;\n@c: "s";\n.a { v: (@c * 2); }'],
    ['a list', '@expose c;\n@c: 1px 2px;\n.a { v: (@c * 2); }'],
    ['a colour bound as a mixin argument', '@expose c;\n@c: #c00;\n.m(@p) { v: (@p * 2); }\n.a { .m(@c); }']
  ])('fails math on an exposed variable of a known wrong type: %s', async (_what, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it.each([
    ['a number', '@expose g;\n@g: 8;\n.a { v: @g + 1; }', 'v: calc(var(--g, 8) + 1);'],
    ['what only the browser knows', '@expose g;\n@g: var(--z);\n.a { v: (@g * 2); }', 'v: calc(var(--g, var(--z)) * 2);'],
    ['a mixin argument', '@expose g;\n@g: 8px;\n.m(@p) { v: (@p * 2); }\n.a { .m(@g); }', 'v: calc(var(--g, 8px) * 2);']
  ])('keeps math on an exposed variable holding %s as calc()', async (_what, source, expected) => {
    await expect(render(source)).resolves.toContain(expected);
  });

  describe('through a function that reads a file', () => {
    /** A 17×9 PNG header beside the entry: enough for `image-width()`. */
    async function renderBesideImage(source: string): Promise<string> {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-expose-image-'));
      const png = Buffer.alloc(24);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
      png.write('IHDR', 12, 'ascii');
      png.writeUInt32BE(17, 16);
      png.writeUInt32BE(9, 20);
      fs.writeFileSync(path.join(dir, 'a.png'), png);
      try {
        return String(await new Compiler({}).renderString(source, { filePath: path.join(dir, 'entry.less'), extension: '.less', suppressWarnings: true }));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    /* The runtime cannot read files; these functions carry no marker yet (jesscss/jess#554). */
    it.fails('rejects an exposed variable it reads', async () => {
      await expect(renderBesideImage('@use "#less";\n@expose img;\n@img: "a.png";\n.a { v: @less.unit(@less.image-width(@img)); }'))
        .rejects.toMatchObject({ code: 'eval/expose-not-a-value' });
    });

    it.each([
      ['a selector', '.m(@l) { .x-@{l} { v: 1; } }'],
      ['a string', '.m(@l) { content: "@{l}"; }'],
      ['a guard', '.m(@l) when (@l > 1px) { v: yes; }']
    ])('rejects an exposed variable it computes with in a mixin argument read in %s', async (_where, mixin) => {
      await expect(renderBesideImage(`@use "#less";\n@expose w;\n@w: 8px;\n${mixin}\n.a { .m(@less.max(@w, @less.image-width("a.png"))); }`))
        .rejects.toMatchObject({ code: 'eval/expose-not-a-value' });
    });

    it('follows an exposed variable it computes with through a mixin argument', async () => {
      await expect(renderBesideImage('@use "#less";\n@expose w;\n@w: 8px;\n.m(@l) { v: @l; }\n.a { .m(@less.max(@w, @less.image-width("a.png"))); }'))
        .resolves.toContain('v: max(var(--w, 8px), 17px);');
    });

    it('follows an exposed variable beside it', async () => {
      await expect(renderBesideImage('@use "#less";\n@expose w;\n@w: 8px;\n.a { v: @less.max(@w, @less.image-width("a.png")); }'))
        .resolves.toContain('v: max(var(--w, 8px), 17px);');
    });
  });

  it('writes the compile-time value a computed function has without the exposed variable', async () => {
    await expect(render('@use "#less";\n.a { v: @less.luma(@less.multiply(#c00, #888)); }')).resolves.toContain('v: 3.2512099914%;');
  });

  it('names one generated property per computation', async () => {
    const css = await render('@use "#less";\n@expose brand;\n@brand: #c00;\n@l: @less.lightness(@brand);\n.a { v: @l; w: @less.lightness(@brand); x: @less.lightness(@less.multiply(@brand, #888)); }');
    expect(css).toContain('v: var(--brand-lightness, 40%);');
    expect(css).toContain('w: var(--brand-lightness, 40%);');
    expect(css).toContain('x: var(--brand-lightness-2, ');
  });

  it('names a generated property by the function as written', async () => {
    await expect(render('@use "#less";\n@expose w;\n@w: 8px;\n.a { v: @less.get-unit(@w); }')).resolves.toContain('v: var(--w-get-unit, px);');
  });

  it('names a computation once, however the call is spelled', async () => {
    const source = '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.lightness(@brand); w: @less.LIGHTNESS(@brand); x: @less.Lightness(@brand); }';
    const css = await render(source);
    expect(css).toContain('v: var(--brand-lightness, 40%);');
    expect(css).toContain('w: var(--brand-lightness, 40%);');
    expect(css).toContain('x: var(--brand-lightness, 40%);');
    // eslint-disable-next-line @typescript-eslint/naming-convention -- a custom property name
    await expect(runtime(source)).resolves.toMatchObject({ derived: { '--brand-lightness': { fn: { name: 'lightness' } } } });
  });

  it('names a generated property apart from every exposed variable', async () => {
    const css = await render('@use "#less";\n@expose brand;\n@brand: #c00;\n@expose brand-lightness;\n@brand-lightness: 99%;\n.a { v: @less.lightness(@brand); w: @brand-lightness; }');
    expect(css).toContain('v: var(--brand-lightness-2, 40%);');
    expect(css).toContain('w: calc(var(--brand-lightness, 0.99) * 100%);');
  });

  it('returns what the runtime is generated from', async () => {
    await expect(runtime('@use "#less";\n@expose brand;\n@brand: #c00;\n@expose gap;\n@gap: 8px;\n.a { color: @brand; v: @less.lightness(@less.multiply(@brand, #888)); }')).resolves.toEqual({
      exports: ['brand', 'gap'],
      keys: { brand: 'brand', gap: 'gap' },
      defaults: { brand: '#c00' },
      units: {},
      ratios: [],
      derived: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- a custom property name
        '--brand-lightness': {
          fn: { module: '@jesscss/fns/less', name: 'lightness' },
          args: [{ fn: { module: '@jesscss/fns/less', name: 'multiply' }, args: [{ export: 'brand' }, '#888'] }]
        }
      },
      colors: ['brand']
    });
  });

  it('returns no runtime for a document that exposes nothing', async () => {
    await expect(runtime('.a { color: red; }')).resolves.toBeUndefined();
  });

  it('exposes every variable a list names', async () => {
    await expect(render('@brand: #c00;\n@gap: 8px;\n@expose brand, gap;\n.a { color: @brand; margin: @gap; }'))
      .resolves.toBe('.a {\n  color: var(--brand, #c00);\n  margin: var(--gap, 8px);\n}\n');
  });

  it('rejects exposing a variable the top level does not declare, at its name', async () => {
    await expect(result('@gap: 1px;\n@expose gap, brand;\n.a { @brand: #c00; color: @brand; }')).resolves.toMatchObject({
      css: '',
      errors: [{ code: 'eval/expose-not-declared', message: expect.stringContaining('@brand'), line: 2, column: 14 }]
    });
  });

  describe.each(['@expose', '@-expose'])('%s', (keyword) => {
    it('reports the declaration form with the name-list spelling', async () => {
      await expect(result(`${keyword} @brand: red;\n.a { b: c; }`)).resolves.toMatchObject({
        css: '',
        errors: [{ code: 'parse/expose-declaration', fix: 'Declare the variable, then expose it by name: @brand: …; @expose brand;' }]
      });
    });

    it.each(['brand gap;', 'brand,;', 'brand: red;', 'brand !important;', ';', '{ a: b }'])('reports a malformed list and writes no CSS: %s', async (rest) => {
      await expect(result(`${keyword} ${rest}`.replace(' ;', ';') + '\n.a { b: c; }')).resolves.toMatchObject({
        css: '',
        errors: [{ code: 'parse/malformed-expose', line: 1, column: 1 }]
      });
    });
  });

  it('exposes a variable a mixin called at the top level declares, not another call\'s', async () => {
    await expect(render('.m(@c) { @brand: @c; }\n.m(#c00);\n@expose brand;\n.a { .m(#00f); color: @brand; }\n.b { color: @brand; }'))
      .resolves.toBe('.a {\n  color: #00f;\n}\n.b {\n  color: var(--brand, #c00);\n}\n');
  });

  /* Ledger A20 (owner 2026-11-02): an @expose outside a selector or other sub-frame exposes, in an imported or composed file too. */
  describe('across files', () => {
    /** Compiles `source` beside a `tokens.less` holding `tokens`, or beside each `[file, text]` of `tokens`. */
    async function resultBeside(tokens: string | ReadonlyArray<readonly [string, string]>, source: string) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-expose-import-'));
      for (const [file, text] of typeof tokens === 'string' ? [['tokens.less', tokens] as const] : tokens) {
        fs.writeFileSync(path.join(dir, file), text);
      }
      try {
        return await new Compiler({}).renderToResult({ filePath: path.join(dir, 'entry.less'), source, language: 'less' });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    const TOKENS = '@expose brand;\n@brand: #c00;\n.x { color: @brand; }\n';

    it('exposes what an imported file exposes, in its rules and the importer\'s', async () => {
      await expect(resultBeside(TOKENS, '@import "tokens.less";\n.a { color: @brand; }')).resolves.toMatchObject({
        css: '.x {\n  color: var(--brand, #c00);\n}\n.a {\n  color: var(--brand, #c00);\n}\n',
        runtime: { exports: ['brand'] }
      });
    });

    it('exposes the importer\'s override of an imported exposed variable', async () => {
      await expect(resultBeside(TOKENS, '@import "tokens.less";\n@brand: #00f;\n.a { color: @brand; }'))
        .resolves.toMatchObject({ css: '.x {\n  color: var(--brand, #00f);\n}\n.a {\n  color: var(--brand, #00f);\n}\n' });
    });

    it('exposes a variable an imported file declares', async () => {
      await expect(resultBeside('@brand: #c00;\n.x { color: @brand; }\n', '@import "tokens.less";\n@expose brand;\n.a { color: @brand; }'))
        .resolves.toMatchObject({ css: '.x {\n  color: var(--brand, #c00);\n}\n.a {\n  color: var(--brand, #c00);\n}\n' });
    });

    it('lets the importer expose what the imported file exposes', async () => {
      await expect(resultBeside(TOKENS, '@import "tokens.less";\n@expose brand;\n.a { color: @brand; }'))
        .resolves.toMatchObject({ errors: [], runtime: { exports: ['brand'] } });
    });

    it('follows a read written before the import', async () => {
      await expect(resultBeside(TOKENS, '.a { color: @brand; }\n@import "tokens.less";'))
        .resolves.toMatchObject({ css: '.a {\n  color: var(--brand, #c00);\n}\n.x {\n  color: var(--brand, #c00);\n}\n' });
    });

    /* Ledger A20 (owner 2026-11-02): a `(reference)` import's own @expose does nothing, without a message. */
    it('ignores what a (reference) import exposes', async () => {
      const result = await resultBeside(TOKENS, '@import (reference) "tokens.less";\n.a { color: @brand; }');
      expect(result).toMatchObject({ css: '.a {\n  color: #c00;\n}\n', errors: [] });
      expect(result.runtime).toBeUndefined();
    });

    it('exposes a (reference) import\'s variable the importer exposes', async () => {
      await expect(resultBeside(TOKENS, '@import (reference) "tokens.less";\n@expose brand;\n.a { color: @brand; }'))
        .resolves.toMatchObject({ css: '.a {\n  color: var(--brand, #c00);\n}\n', runtime: { exports: ['brand'] } });
    });

    it('rejects an @expose in a file imported into a ruleset', async () => {
      await expect(resultBeside(TOKENS, '.a { @import "tokens.less"; }'))
        .resolves.toMatchObject({ css: '', errors: [{ code: 'eval/expose-not-top-level' }] });
    });

    it('exposes what a composed module exposes, read as its member', async () => {
      await expect(resultBeside(TOKENS, '@compose "tokens.less" as tokens;\n.a { color: @tokens.brand; }'))
        .resolves.toMatchObject({ css: expect.stringContaining('.a {\n  color: var(--brand, #c00);\n}'), runtime: { exports: ['brand'] } });
    });

    it('rejects two @expose lists of one name that name different variables, naming both', async () => {
      await expect(resultBeside(TOKENS, '@compose "tokens.less" as tokens;\n@brand: #00f;\n@expose brand;\n.a { color: @brand; }'))
        .resolves.toMatchObject({
          css: '',
          errors: [{ code: 'eval/expose-conflict', message: expect.stringContaining('entry.less:3:9'), file: { name: 'tokens.less' }, line: 1, column: 9 }]
        });
    });

    /* Owner 2026-11-02: only dash-case is converted; letter case is the author's. */
    it('keeps letter case in the JavaScript key, so Brand and brand are two keys', async () => {
      await expect(result('@Brand: #c00;\n@brand: #00f;\n@expose Brand, brand;\n.a { color: @Brand; b: @brand; }'))
        .resolves.toMatchObject({ errors: [], runtime: { exports: ['Brand', 'brand'] } });
    });

    it('drops a trailing dash from the JavaScript key, so brand- and brand clash', async () => {
      await expect(result('@brand-: #c00;\n@brand: #00f;\n@expose brand-, brand;')).resolves.toMatchObject({
        errors: [{ code: 'eval/expose-key-conflict', message: expect.stringContaining('@expose brand- at entry.less:3:9') }]
      });
    });

    /* Owner 2026-11-02: two imported files that each declare and expose a name clash, as two composed ones do. */
    it('rejects two imported files that each declare and expose one name, naming both', async () => {
      await expect(resultBeside([['a.less', '@brand: red;\n@expose brand;\n'], ['b.less', '@brand: blue;\n@expose brand;\n']], '@import "a.less";\n@import "b.less";\n.x { color: @brand; }'))
        .resolves.toMatchObject({
          css: '',
          errors: [{ code: 'eval/expose-conflict', message: expect.stringContaining('a.less:2:9'), file: { name: 'b.less' }, line: 2, column: 9 }]
        });
    });

    it('rejects an importer that declares and exposes a name an imported file declares and exposes', async () => {
      await expect(resultBeside(TOKENS, '@import "tokens.less";\n@brand: #00f;\n@expose brand;'))
        .resolves.toMatchObject({ css: '', errors: [{ code: 'eval/expose-conflict' }] });
    });

    it('rejects two exposed names with one JavaScript key, naming both', async () => {
      await expect(resultBeside('@expose brand-color;\n@brand-color: #c00;\n', '@import "tokens.less";\n@brandColor: #00f;\n@expose brandColor;'))
        .resolves.toMatchObject({
          css: '',
          errors: [{ code: 'eval/expose-key-conflict', message: expect.stringContaining('entry.less:3:9'), file: { name: 'tokens.less' }, line: 1, column: 9 }]
        });
    });
  });

  it.each([
    '.a { @expose n;\n@n: x; }',
    '@media screen { @expose n;\n@n: x; }',
    '.m() { @expose n;\n@n: x; }\n.a { .m(); }',
    '@l: a, b;\neach(@l, { @expose n; });'
  ])('rejects an @expose below the top level: %s', async (source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/expose-not-top-level' });
  });
});
