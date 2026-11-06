import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Sass's colour built-ins as CSS forms (docs/design/CSS-NATIVE-BUILTINS.md §4,
 * slice 8): known inputs compute through the form, an input only the browser
 * knows prints it. A lone `grayscale()`, `invert()` or `contrast()` over an
 * unknown goes by where it stands (Q13).
 */
const compile = (source: string, extension = '.scss', functionMode?: 'error'): Promise<string> =>
  new Compiler({ output: { collapseNesting: true }, ...(functionMode === undefined ? {} : { compile: { functionMode } }) })
    .renderString(source, { extension, suppressWarnings: true });
const value = async (call: string): Promise<string> => {
  const css = await compile(`a { b: ${call}; }`);
  return css.slice(css.indexOf('b: ') + 3, css.lastIndexOf(';'));
};
const GRAY = 'hsl(from var(--x) h 0 l)';
const INVERT = 'rgb(from var(--x) calc(255 - r) calc(255 - g) calc(255 - b))';

describe('an adjuster over an input only the browser knows prints its form', () => {
  it.each([
    ['lighten(var(--a), 10%)', 'hsl(from var(--a) h s clamp(0, l + 10, 100))'],
    ['darken(var(--a), 10%)', 'hsl(from var(--a) h s clamp(0, l - 10, 100))'],
    ['saturate(var(--a), 10%)', 'hsl(from var(--a) h clamp(0, s + 10, 100) l)'],
    ['desaturate(var(--a), 10%)', 'hsl(from var(--a) h clamp(0, s - 10, 100) l)'],
    ['adjust-hue(var(--a), 30deg)', 'hsl(from var(--a) calc(h + 30) s l)'],
    ['adjust-hue(var(--a), var(--d))', 'hsl(from var(--a) calc(h + var(--d)) s l)'],
    ['complement(var(--a))', 'hsl(from var(--a) calc(h + 180) s l)'],
    ['opacify(var(--a), .1)', 'rgb(from var(--a) r g b / calc(alpha + 0.1))'],
    ['fade-in(var(--a), .1)', 'rgb(from var(--a) r g b / calc(alpha + 0.1))'],
    ['transparentize(var(--a), .1)', 'rgb(from var(--a) r g b / calc(alpha - 0.1))'],
    ['fade-out(var(--a), .1)', 'rgb(from var(--a) r g b / calc(alpha - 0.1))'],
    ['lighten(#c00, var(--b))', 'hsl(from #c00 h s clamp(0, l + var(--b) / 1%, 100))'],
    ['mix(var(--a), #fff, 25%)', 'color-mix(in srgb, var(--a) 25%, #fff)'],
    ['mix(var(--a), #fff)', 'color-mix(in srgb, var(--a), #fff)'],
    ['rgba(currentcolor, .5)', 'rgb(from currentcolor r g b / 0.5)'],
    ['rgb(currentcolor, .5)', 'rgb(from currentcolor r g b / 0.5)'],
    ['invert(#f00, var(--w))', 'color-mix(in srgb, rgb(from #f00 calc(255 - r) calc(255 - g) calc(255 - b)) var(--w), #f00)']
  ])('%s', async (call, form) => {
    await expect(value(call)).resolves.toBe(form);
  });

  it('prints the same form through the module', async () => {
    await expect(compile('@use "sass:color";\na { b: color.lighten(var(--a), 10%); c: color.mix(var(--a), #fff); d: color.complement(var(--a)); }'))
      .resolves.toBe('a {\n  b: hsl(from var(--a) h s clamp(0, l + 10, 100));\n  c: color-mix(in srgb, var(--a), #fff);\n  d: hsl(from var(--a) calc(h + 180) s l);\n}\n');
  });

  it.each([
    ['transparentize(hsl(120,50%,50%), .1)', 'rgba(64, 191, 64, 0.9)'],
    ['mix(#f00,#00f)', '#800080'],
    ['invert(#f00, 50%)', '#808080'],
    ['mix(rgb(none 0 0), #fff, 25%)', 'color-mix(in srgb, rgb(none 0 0) 25%, #fff)'],
    ['grayscale(#800)', '#444444'],
    ['invert(#123456)', '#edcba9'],
    ['invert(#123456, 20%)', '#3e5267'],
    ['darken(#0d6efd, 7.5%)', '#025ce2'],
    ['adjust-hue(red, 60rad)', '#00b4ff']
  ])('a known input computes through the form: %s', async (call, css) => {
    await expect(value(call)).resolves.toBe(css);
  });
});

describe('what Sass rejects stays rejected', () => {
  it.each([
    'lighten(#c00, 200%)',
    'lighten(#c00, 10%, relative)',
    'opacify(rgba(255, 0, 0, 0.5), 10%)',
    'complement(#f00, oklch)',
    'mix(#f00, #00f, 200%)',
    'invert(#f00, 200%)'
  ])('%s', async (call) => {
    await expect(value(call)).resolves.toBe(call);
    await expect(compile(`a { b: ${call}; }`, '.scss', 'error')).rejects.toMatchObject({ code: 'eval/invalid-function' });
    await expect(compile(`@use "sass:color";\na { b: color.${call}; }`)).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });
});

describe('a lone grayscale(), invert() or contrast() over an unknown goes by where it stands', () => {
  it('is the filter directly in filter or backdrop-filter, in any case, prefixed, and as a list item', async () => {
    const source = 'a { filter: grayscale(var(--x)); -webkit-filter: invert(var(--x)); backdrop-filter: blur(1px) invert(var(--x)); -WEBKIT-BACKDROP-FILTER: grayscale(var(--x)); FILTER: blur(1px) grayscale(var(--x)) !important; }';
    await expect(compile(source)).resolves.toBe('a {\n  filter: grayscale(var(--x));\n  -webkit-filter: invert(var(--x));\n  backdrop-filter: blur(1px) invert(var(--x));\n  -WEBKIT-BACKDROP-FILTER: grayscale(var(--x));\n  FILTER: blur(1px) grayscale(var(--x)) !important;\n}\n');
  });

  it('reads the name in any case, as CSS and the registry do', async () => {
    await expect(compile('a { filter: GRAYSCALE(var(--x)); color: GRAYSCALE(var(--x)); }')).resolves.toBe(`a {\n  filter: GRAYSCALE(var(--x));\n  color: ${GRAY};\n}\n`);
  });

  it('is the colour form directly in any other declaration', async () => {
    await expect(compile('a { color: grayscale(var(--x)); background-color: invert(var(--x)); border: 1px solid grayscale(var(--x)); background: url(a.png), invert(var(--x)); }'))
      .resolves.toBe(`a {\n  color: ${GRAY};\n  background-color: ${INVERT};\n  border: 1px solid ${GRAY};\n  background: url(a.png), ${INVERT};\n}\n`);
    await expect(compile('.a { color: contrast(var(--x)); filter: contrast(var(--x)); backdrop-filter: blur(1px) contrast(var(--x)); }', '.less'))
      .resolves.toBe('.a {\n  color: contrast-color(var(--x));\n  filter: contrast(var(--x));\n  backdrop-filter: blur(1px) contrast(var(--x));\n}\n');
  });

  it('holds in a mixin body and a loop body, which know their declaration', async () => {
    await expect(compile('@mixin m { color: grayscale(var(--x)); filter: invert(var(--x)); }\na { @include m; }\n@each $n in 1 { b { color: invert(var(--x)); filter: invert(var(--x)); } }'))
      .resolves.toBe(`a {\n  color: ${GRAY};\n  filter: invert(var(--x));\n}\nb {\n  color: ${INVERT};\n  filter: invert(var(--x));\n}\n`);
  });

  it('goes by the declaration reading a variable, whichever read comes first', async () => {
    await expect(compile('$f: grayscale(var(--x));\na { filter: $f; color: $f; }')).resolves.toBe(`a {\n  filter: grayscale(var(--x));\n  color: ${GRAY};\n}\n`);
    await expect(compile('$f: grayscale(var(--x));\na { color: $f; filter: $f; }')).resolves.toBe(`a {\n  color: ${GRAY};\n  filter: grayscale(var(--x));\n}\n`);
    await expect(compile('@f: contrast(var(--x));\n.a { filter: @f; color: @f; }', '.less')).resolves.toBe('.a {\n  filter: contrast(var(--x));\n  color: contrast-color(var(--x));\n}\n');
    await expect(compile('@f: contrast(var(--x));\n.a { color: @f; filter: @f; }', '.less')).resolves.toBe('.a {\n  color: contrast-color(var(--x));\n  filter: contrast(var(--x));\n}\n');
  });

  it('is as written where no position is known', async () => {
    await expect(compile('@mixin m($p) { color: $p; filter: $p; }\na { @include m(invert(var(--x))); }')).resolves.toBe('a {\n  color: invert(var(--x));\n  filter: invert(var(--x));\n}\n');
    await expect(compile('.m(@p) { color: @p; }\n.a { .m(contrast(var(--x))); }', '.less')).resolves.toBe('.a {\n  color: contrast(var(--x));\n}\n');
    await expect(compile('@function f($c) { @return grayscale($c); }\na { color: f(var(--x)); }')).resolves.toBe('a {\n  color: grayscale(var(--x));\n}\n');
  });

  it('reads through a variable to the unknown at the call, where the call has a position', async () => {
    await expect(compile('$c: var(--x);\na { color: grayscale($c); filter: grayscale($c); }')).resolves.toBe(`a {\n  color: ${GRAY};\n  filter: grayscale(var(--x));\n}\n`);
  });

  it('stays as written inside another function, a known gap', async () => {
    await expect(compile('a { filter: drop-shadow(0 0 1px grayscale(var(--x))); background: linear-gradient(invert(var(--x)), red); }'))
      .resolves.toBe('a {\n  filter: drop-shadow(0 0 1px grayscale(var(--x)));\n  background: linear-gradient(invert(var(--x)), red);\n}\n');
  });

  it('keeps a number a filter everywhere', async () => {
    const source = 'a { filter: grayscale(50%); color: grayscale(50%); filter: invert(1); color: invert(calc(var(--x) * 2)); }';
    await expect(compile(source)).resolves.toBe('a {\n  filter: grayscale(50%);\n  color: grayscale(50%);\n  filter: invert(1);\n  color: invert(calc(var(--x) * 2));\n}\n');
    await expect(compile('.a { color: contrast(1.5); color: contrast(calc(var(--x) * 2)); filter: contrast(50%); }', '.less'))
      .resolves.toBe('.a {\n  color: contrast(1.5);\n  color: contrast(calc(var(--x) * 2));\n  filter: contrast(50%);\n}\n');
  });

  it('keeps a lone saturate a filter, whose built-in takes two arguments', async () => {
    await expect(compile('a { color: saturate(var(--x)); filter: saturate(50%); }')).resolves.toBe('a {\n  color: saturate(var(--x));\n  filter: saturate(50%);\n}\n');
  });

  it('takes the form where the call is a colour by arity or type', async () => {
    await expect(compile('a { filter: invert(var(--x), 50%); }')).resolves.toContain('color-mix(in srgb');
    await expect(compile('a { filter: grayscale(darken(var(--x), 10%)); }')).resolves.toContain('hsl(from hsl(from var(--x)');
    await expect(compile('a { filter: grayscale(#800); }')).resolves.toBe('a {\n  filter: #444444;\n}\n');
  });

  it('takes the form through a module, under any property', async () => {
    await expect(compile('@use "sass:color";\na { filter: color.grayscale(var(--x)); color: color.invert(var(--x)); }')).resolves.toBe(`a {\n  filter: ${GRAY};\n  color: ${INVERT};\n}\n`);
    await expect(compile('@use "#less";\n.a { filter: @less.contrast(var(--x)); }', '.less')).resolves.toBe('.a {\n  filter: contrast-color(var(--x));\n}\n');
    await expect(compile('@-from "#sass" import (grayscale);\n.a { filter: $grayscale(var(--x)); }', '.jess')).resolves.toBe(`.a {\n  filter: ${GRAY};\n}\n`);
  });

  it('fails a number through a module, as J1 has it', async () => {
    for (const call of ['invert(1)', 'grayscale(50%)', 'opacity(50%)', 'grayscale(calc(1 * var(--x)))']) {
      await expect(compile(`@use "sass:color";\na { b: color.${call}; }`)).rejects.toMatchObject({ code: 'eval/invalid-function' });
    }
  });

  it('goes by position for a bare name under @use … as *, which stays ambient', async () => {
    await expect(compile('@use "sass:color" as *;\na { filter: grayscale(var(--x)); color: invert(var(--x)); backdrop-filter: invert(50%); }'))
      .resolves.toBe(`a {\n  filter: grayscale(var(--x));\n  color: ${INVERT};\n  backdrop-filter: invert(50%);\n}\n`);
  });
});
