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
    ['a mixin argument', '@export @brand: #c00;\n.tint(@c) { color: @c; }\n.btn { .tint(@brand); }'],
    ['text spliced around it', '@export @n: 2;\n.a { width: @{n}px; }'],
    ['the input of a computed function', '@use "#less";\n@export @list: a, b, c;\n.a { v: @less.length(@list); }'],
    ['the input of a computed function, through an alias', '@use "#less";\n@export @w: 8px;\n@a: @w 2;\n.a { v: @less.length(@a); }']
  ])('rejects a read in %s', async (_where, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/export-not-a-value' });
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
