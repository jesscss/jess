import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Ledger A4 (owner 2026-11-01): a root variable marked `@export` publishes a
 * custom property. Every CSS value that reads it is `var(--name, <its
 * compile-time value>)`; a read where a `var()` cannot stand in is an error,
 * and an export nothing reads is a no-op. Browser-runtime spec, slice 1.
 */
async function render(source: string, compress = false): Promise<string> {
  const compiler = new Compiler(compress ? { output: { compress: true } } : {});
  return String(await compiler.renderString(source, { filePath: 'entry.less', extension: '.less', suppressWarnings: true }));
}

async function runtime(source: string): Promise<unknown> {
  return (await new Compiler({}).renderToResult({ filePath: 'entry.less', source, language: 'less' })).runtime;
}

describe('Less @export variables (A4)', () => {
  it.each([
    ['@export @brand: #c00;\n.btn { color: @brand; }', 'color: var(--brand, #c00);'],
    ['@-export @brand: #c00;\n.btn { color: @brand; }', 'color: var(--brand, #c00);'],
    ['@export @brand: #c00;\n.btn { border: 1px solid @brand; }', 'border: 1px solid var(--brand, #c00);'],
    ['@export @brand: #c00;\n@accent: @brand;\n.btn { color: @accent; }', 'color: var(--brand, #c00);'],
    ['.btn { color: @brand; }\n@export @brand: #c00;', 'color: var(--brand, #c00);'],
    ['@export @fonts: Inter, sans-serif;\nbody { font-family: @fonts; }', 'font-family: var(--fonts, Inter, sans-serif);'],
    ['@export @gap: 8px;\n.grid { gap: calc(@gap * 2); }', 'gap: calc(var(--gap, 8px) * 2);'],
    ['@export @brand: #c00;\n.btn { background: color-mix(in srgb, @brand, white); }', 'background: color-mix(in srgb, var(--brand, #c00), white);'],
    ['@export @brand: #c00 !important;\n.btn { color: @brand; }', 'color: var(--brand, #c00) !important;'],
    ['@export @gap: 8px;\n.grid { gap: @{gap}; }', 'gap: var(--gap, 8px);'],
    ['@export @gap: 8px;\n.grid { gap: foo(@gap); }', 'gap: foo(var(--gap, 8px));'],
    ['@export @brand: #c00;\n.btn { color: isdefined(@brand); }', 'color: true;']
  ])('writes a read of the export as var(): %s', async (source, expected) => {
    await expect(render(source)).resolves.toContain(expected);
  });

  it('writes a compressed var() in compressed output', async () => {
    await expect(render('@export @brand: #c00;\n.btn { color: @brand; }', true)).resolves.toBe('.btn{color:var(--brand,#c00)}');
  });

  it('leaves a nested shadow of the name its own value', async () => {
    await expect(render('@export @brand: #c00;\n.btn { @brand: blue; color: @brand; }')).resolves.toContain('color: blue;');
  });

  it('is a no-op when nothing reads the export', async () => {
    await expect(render('@export @brand: #c00;\n.btn { color: red; }')).resolves.toBe('.btn {\n  color: red;\n}\n');
  });

  it('puts the document in modern mode (P36)', async () => {
    await expect(render('@export @brand: #c00;\n.btn { width: round(1.5px); }')).resolves.toContain('width: round(1.5px);');
  });

  it('keeps math on the export outside a calculation an operand error, as for an authored var()', async () => {
    await expect(render('@export @gap: 8px;\n.grid { gap: @gap * 2; }')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it.each([
    ['a selector', '@export @size: lg;\n.btn-@{size} { padding: 0; }'],
    ['a media query', '@export @bp: 640px;\n@media (min-width: @bp) { .a { b: c; } }'],
    ['a guard', '@export @theme: dark;\n.a when (@theme = dark) { b: c; }'],
    ['a string', '@export @icon: star;\n.a { content: "@{icon}"; }'],
    ['a url', '@export @icon: star;\n.a { background: url("@{icon}.svg"); }'],
    ['a guard on a mixin argument', '@export @brand: #c00;\n.tint(@c) when (iscolor(@c)) { color: @c; }\n.btn { .tint(@brand); }'],
    ['a guard, computed', '@use "#less";\n@export @brand: #c00;\n.a when (@less.lightness(@brand) > 10%) { b: c; }'],
    ['text spliced around it', '@export @n: 2;\n.a { width: @{n}px; }'],
    ['a larger argument of a computed function', '@use "#less";\n@export @w: 8px;\n@a: @w 2;\n.a { v: @less.length(@a); }'],
    ['a larger mixin argument a computed function reads', '@use "#less";\n@export @w: 8px;\n.m(@a) { v: @less.length(@a); }\n.a { .m(@w 2); }'],
    ['a guard on a computed mixin argument', '@use "#less";\n@export @brand: #c00;\n.m(@l) when (@l > 10%) { v: yes; }\n.a { .m(@less.lightness(@brand)); }'],
    ['a selector from a computed mixin argument', '@use "#less";\n@export @brand: #c00;\n.m(@l) { .x-@{l} { v: 1; } }\n.a { .m(@less.lightness(@brand)); }'],
    ['a string from a computed mixin argument', '@use "#less";\n@export @brand: #c00;\n.m(@l) { content: "@{l}"; }\n.a { .m(@less.lightness(@brand)); }'],
    ['a selector from a rest parameter', '@export @size: lg;\n.m(@rest...) { .x-@{rest} { v: 1; } }\n.a { .m(@size); }'],
    ['a string from a rest parameter', '@export @icon: star;\n.m(@rest...) { content: "@{rest}"; }\n.a { .m(@icon); }'],
    ['a selector from @arguments', '@export @size: lg;\n.m(@a) { .x-@{arguments} { v: 1; } }\n.a { .m(@size); }'],
    ['a guard on a rest parameter', '@export @w: 8px;\n.m(@rest...) when (@rest > 10%) { v: yes; }\n.a { .m(@w); }'],
    ['a guard on @arguments', '@export @w: 8px;\n.m(@a) when (@arguments > 10%) { v: yes; }\n.a { .m(@w); }'],
    ['a type guard on a rest parameter', '@export @brand: #c00;\n.m(@rest...) when (iscolor(@rest)) { v: yes; }\n.a { .m(@brand); }'],
    ['a computed function of a rest parameter among others', '@use "#less";\n@export @brand: #c00;\n.m(@rest...) { v: @less.length(@rest); }\n.a { .m(@brand; 2); }']
  ])('rejects a read in %s', async (_where, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/export-not-a-value' });
  });

  it.each([
    ['a mixin argument', '@export @brand: #c00;\n.tint(@c) { color: @c; }\n.btn { .tint(@brand); }', 'color: var(--brand, #c00);'],
    ['a mixin argument in a list', '@export @w: 8px;\n.m(@a) { margin: @a; }\n.a { .m(@w 2px); }', 'margin: var(--w, 8px) 2px;'],
    ['a mixin default', '@export @brand: #c00;\n.tint(@c: @brand) { color: @c; }\n.btn { .tint(); }', 'color: var(--brand, #c00);'],
    ['a computed function', '@use "#less";\n@export @brand: #c00;\n.a { v: @less.lightness(@brand); }', 'v: var(--brand-lightness, 40%);'],
    ['a computed function of a list', '@use "#less";\n@export @list: a, b, c;\n.a { v: @less.length(@list); }', 'v: var(--list-length, 3);'],
    ['a computed function of a mixin argument', '@use "#less";\n@export @brand: #c00;\n.tint(@c) { color: @less.lightness(@c); }\n.btn { .tint(@brand); }', 'color: var(--brand-lightness, 40%);'],
    ['nested computed functions', '@use "#less";\n@export @brand: #c00;\n.a { v: @less.luma(@less.multiply(@brand, #888)); }', 'v: var(--brand-luma, 3.2512099914%);'],
    ['a computed mixin argument a computed function reads', '@use "#less";\n@export @brand: #c00;\n.m(@c) { v: @less.lightness(@c); }\n.a { .m(@less.darken(@brand, 10%)); }', 'v: var(--brand-lightness, 30%);'],
    ['a direct mixin argument', '@export @brand: #c00;\n.m(@c) { color: @c; }\n.a { .m(@brand); }', 'color: var(--brand, #c00);'],
    ['a rest parameter', '@export @w: 8px;\n.m(@rest...) { margin: @rest; }\n.a { .m(@w); }', 'margin: var(--w, 8px);'],
    ['@arguments', '@export @w: 8px;\n.m(@a) { margin: @arguments; }\n.a { .m(@w); }', 'margin: var(--w, 8px);'],
    ['a computed function of a rest parameter', '@use "#less";\n@export @brand: #c00;\n.m(@rest...) { v: @less.lightness(@rest); }\n.a { .m(@brand); }', 'v: var(--brand-lightness, 40%);'],
    ['a computed function in calc()', '@use "#less";\n@export @brand: #c00;\n.a { v: calc(@less.lightness(@brand) * 2); }', 'v: calc(var(--brand-lightness, 40%) * 2);']
  ])('follows the export through %s', async (_what, source, expected) => {
    await expect(render(source)).resolves.toContain(expected);
  });

  describe('through a function that reads a file', () => {
    /** A 17×9 PNG header beside the entry: enough for `image-width()`. */
    async function renderBesideImage(source: string): Promise<string> {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-export-image-'));
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
    it.fails('rejects an export it reads', async () => {
      await expect(renderBesideImage('@use "#less";\n@export @img: "a.png";\n.a { v: @less.unit(@less.image-width(@img)); }'))
        .rejects.toMatchObject({ code: 'eval/export-not-a-value' });
    });

    it('follows an export beside it', async () => {
      await expect(renderBesideImage('@use "#less";\n@export @w: 8px;\n.a { v: @less.max(@w, @less.image-width("a.png")); }'))
        .resolves.toContain('v: var(--w-max, 17px);');
    });
  });

  it('writes the compile-time value a computed function has without the export', async () => {
    await expect(render('@use "#less";\n.a { v: @less.luma(@less.multiply(#c00, #888)); }')).resolves.toContain('v: 3.2512099914%;');
  });

  it('names one generated property per computation', async () => {
    const css = await render('@use "#less";\n@export @brand: #c00;\n@l: @less.lightness(@brand);\n.a { v: @l; w: @less.lightness(@brand); x: @less.lightness(@less.multiply(@brand, #888)); }');
    expect(css).toContain('v: var(--brand-lightness, 40%);');
    expect(css).toContain('w: var(--brand-lightness, 40%);');
    expect(css).toContain('x: var(--brand-lightness-2, ');
  });

  it('names a generated property apart from every export', async () => {
    const css = await render('@use "#less";\n@export @brand: #c00;\n@export @brand-lightness: 99%;\n.a { v: @less.lightness(@brand); w: @brand-lightness; }');
    expect(css).toContain('v: var(--brand-lightness-2, 40%);');
    expect(css).toContain('w: var(--brand-lightness, 99%);');
  });

  it('returns what the runtime is generated from', async () => {
    await expect(runtime('@use "#less";\n@export @brand: #c00;\n@export @gap: 8px;\n.a { color: @brand; v: @less.lightness(@less.multiply(@brand, #888)); }')).resolves.toEqual({
      exports: ['brand', 'gap'],
      defaults: { brand: '#c00' },
      derived: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- a custom property name
        '--brand-lightness': {
          fn: { module: '#less', name: 'lightness' },
          args: [{ fn: { module: '#less', name: 'multiply' }, args: [{ export: 'brand' }, '#888'] }]
        }
      }
    });
  });

  it('returns no runtime for a document that exports nothing', async () => {
    await expect(runtime('.a { color: red; }')).resolves.toBeUndefined();
  });

  it('writes any other @export as the at-rule it is', async () => {
    await expect(render('@export foo;\n.a { b: c; }')).resolves.toBe('@export foo;\n.a {\n  b: c;\n}\n');
  });

  it.each([
    '.a { @export @n: x; }',
    '@media screen { @export @n: x; }',
    '.m() { @export @n: x; }\n.a { .m(); }'
  ])('rejects an @export below the top level: %s', async (source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/export-not-top-level' });
  });
});
