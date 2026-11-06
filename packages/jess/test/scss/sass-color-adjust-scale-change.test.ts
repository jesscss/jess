import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `color.adjust` / `color.scale` / `color.change` and the globals
 * `adjust-color` / `scale-color` / `change-color` in `.scss`, the way a design
 * system calls them: keyword channels on a theme colour.
 *
 * Oracle: Dart Sass 1.101.7 (`sass --no-source-map`). Where Dart Sass writes a
 * fractional channel as `rgb(…%)`, the expected bytes are that colour quantized
 * at the output boundary: Dart Sass's `color.adjust(#0d6efd, $lightness: -10%)`
 * is `rgb(0.6910961106%, 34.2092574735%, 83.6226293796%)`, which is `#0257d5`.
 * Channel-by-channel coverage is `packages/fns/src/sass/__tests__/color-update.test.ts`.
 */
const render = async (source: string, functionMode?: 'error'): Promise<string> =>
  new Compiler(functionMode === undefined ? {} : { compile: { functionMode } })
    .renderString(source, { filePath: 'theme.scss', extension: '.scss', suppressWarnings: true });

const value = async (call: string, compress = false): Promise<string> => {
  const css = await new Compiler({ output: { compress } }).renderString(`@use "sass:color";\na { b: ${call}; }`, { filePath: 'theme.scss', extension: '.scss', suppressWarnings: true });
  return css.trim().replace(/^a\s*\{\s*b:\s*/, '').replace(/;?\s*\}$/, '');
};

const THEME = '@use "sass:color";\n$primary: #0d6efd;\n$black: #000;\n$white: #fff;\n';

describe('colour updates by keyword in .scss', () => {
  it('computes a theme\'s hover, focus and disabled states', async () => {
    const source = `${THEME}.btn-primary {
  background-color: $primary;
  &:hover { background-color: color.adjust($primary, $lightness: -10%); }
  &:focus { box-shadow: 0 0 0 .25rem color.change($primary, $alpha: .5); }
  &:disabled { background-color: color.scale($primary, $alpha: -40%); }
}
.card { border: 1px solid color.change($black, $alpha: .175); }
.text-muted { color: color.scale($black, $lightness: 45%); }
`;
    await expect(render(source)).resolves.toBe(`.btn-primary {
  background-color: #0d6efd;
  &:hover {
    background-color: #0257d5;
  }
  &:focus {
    box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.5);
  }
  &:disabled {
    background-color: rgba(13, 110, 253, 0.6);
  }
}
.card {
  border: 1px solid rgba(0, 0, 0, 0.175);
}
.text-muted {
  color: #737373;
}
`);
  });

  it('answers the same through the global spellings', async () => {
    const source = `${THEME}.callout {
  border-left-color: scale-color(#1779ba, $lightness: -15%);
  background: adjust-color($white, $alpha: -0.9);
  color: change-color($primary, $blue: 200, $green: 80);
}
`;
    await expect(render(source)).resolves.toBe(`.callout {
  border-left-color: #14679e;
  background: rgba(255, 255, 255, 0.1);
  color: #0d50c8;
}
`);
  });

  it('binds each keyword to its own channel however many channels it skips', async () => {
    /* Seven declared parameters lie between `$color` and `$blackness`. */
    await expect(render(`${THEME}a { b: color.adjust($color: $primary, $blackness: 15%); }`))
      .resolves.toBe('a {\n  b: #0d5fd7;\n}\n');
  });
});

describe('one relative colour, each channel a slot', () => {
  it.each([
    ['color.adjust(var(--c), $red: 10, $green: 20)', 'rgb(from var(--c) clamp(0, r + 10, 255) clamp(0, g + 20, 255) b)'],
    ['color.adjust(var(--c), $hue: 30)', 'hsl(from var(--c) calc(h + 30) s l)'],
    ['color.adjust(var(--c), $saturation: 10%, $lightness: -10%)', 'hsl(from var(--c) h clamp(0, s + 10, 100) clamp(0, l + -10, 100))'],
    ['color.adjust(var(--c), $whiteness: 10%, $blackness: 5%)', 'hwb(from var(--c) h calc(w + 10) calc(b + 5))'],
    ['color.adjust(var(--c), $alpha: -.2)', 'rgb(from var(--c) r g b / calc(alpha + -0.2))'],
    ['color.adjust(var(--c), $lightness: -10%, $alpha: -.2)', 'hsl(from var(--c) h s clamp(0, l + -10, 100) / calc(alpha + -0.2))'],
    ['color.scale(var(--c), $red: 20%, $blue: -20%)', 'rgb(from var(--c) calc(r + (255 - r) * 0.2) g calc(b + b * -0.2))'],
    ['color.scale(var(--c), $lightness: 45%, $alpha: -40%)', 'hsl(from var(--c) h s calc(l + (100 - l) * 0.45) / calc(alpha + alpha * -0.4))'],
    ['color.scale(var(--c), $whiteness: 30%)', 'hwb(from var(--c) h calc(w + (100 - w) * 0.3) b)'],
    ['color.change(var(--c), $lightness: 50%)', 'hsl(from var(--c) h s 50)'],
    ['color.change(var(--c), $red: 10%, $blue: 3)', 'rgb(from var(--c) 25.5 g 3)'],
    ['color.change(var(--c), $blackness: 20%, $alpha: 50%)', 'hwb(from var(--c) h w 20 / 0.5)'],
    ['adjust-color(var(--c), $red: 10)', 'rgb(from var(--c) clamp(0, r + 10, 255) g b)'],
    ['scale-color(var(--c), $alpha: 40%)', 'rgb(from var(--c) r g b / calc(alpha + (1 - alpha) * 0.4))'],
    ['change-color(var(--c), $alpha: var(--a))', 'rgb(from var(--c) r g b / var(--a))']
  ])('%s', async (call, form) => {
    await expect(value(call)).resolves.toBe(form);
  });

  it('takes an amount only the browser knows, on a 0–100 channel as holding a percentage', async () => {
    await expect(value('color.adjust(#0d6efd, $red: var(--x))')).resolves.toBe('rgb(from #0d6efd clamp(0, r + var(--x), 255) g b)');
    await expect(value('color.adjust(#0d6efd, $lightness: var(--x))')).resolves.toBe('hsl(from #0d6efd h s clamp(0, l + var(--x) / 1%, 100))');
    await expect(value('color.adjust(#0d6efd, $whiteness: var(--x))')).resolves.toBe('hwb(from #0d6efd h calc(w + var(--x) / 1%) b)');
    await expect(value('color.change(#0d6efd, $lightness: var(--x))')).resolves.toBe('hsl(from #0d6efd h s calc(var(--x) / 1%))');
  });

  it('spells what it prints under compress', async () => {
    await expect(value('color.scale(var(--c), $lightness: 45%)', true)).resolves.toBe('hsl(from var(--c) h s calc(l + (100 - l) * .45))');
  });

  it('computes what the form computes on a known colour, in the colour\'s own format', async () => {
    await expect(value('color.adjust(hsl(120, 50%, 50%), $lightness: 10%)')).resolves.toBe('hsl(120, 50%, 60%)');
    await expect(value('color.adjust(#000, $hue: 12, $saturation: 24%, $lightness: 48%, $alpha: -.7)')).resolves.toBe('rgba(152, 105, 93, 0.3)');
    await expect(value('color.adjust(#0000, $lightness: 50%)')).resolves.toBe('#80808000');
    await expect(value('color.adjust(rgba(red, .5), $alpha: .5)')).resolves.toBe('rgb(255, 0, 0)');
    await expect(value('color.adjust(#f00)')).resolves.toBe('#f00');
  });

  it('clamps saturation and lightness, so the channels stay what CSS reads', async () => {
    await expect(value('color.adjust(#0d6efd, $saturation: 10%)')).resolves.toBe('#0b6eff');
    await expect(value('color.adjust(plum, $saturation: 200%)')).resolves.toBe('#ff7eff');
    await expect(value('color.adjust(#c00, $lightness: 200%)')).resolves.toBe('#ffffff');
  });

  it('prints what only the browser gamut-maps', async () => {
    await expect(value('color.change(#c00, $lightness: 120%)')).resolves.toBe('hsl(from #c00 h s 120)');
    await expect(value('color.change(#c00, $red: 300)')).resolves.toBe('rgb(from #c00 300 g b)');
    await expect(value('color.adjust(#0d6efd, $whiteness: -80%)')).resolves.toBe('hwb(from #0d6efd h calc(w + -80) b)');
  });

  it('normalizes a whiteness and blackness past 100%', async () => {
    await expect(value('color.adjust(#0d6efd, $whiteness: 80%, $blackness: 40%)')).resolves.toBe('#acacac');
  });

  it.each([
    ['a percentage only the browser knows, whose sign picks the formula', 'color.scale(#0d6efd, $red: var(--x))', 'its sign picks how a channel scales'],
    ['the same for alpha', 'color.scale(var(--c), $alpha: var(--x))', 'its sign picks how a channel scales'],
    ['a colour in a space it has no channels for', 'color.adjust(lab(50% 30 -50), $lightness: 3%)', '$color: The lab color space is not supported yet.'],
    ['a channel of another space, over an unknown colour', 'color.adjust(var(--c), $red: 1, $lightness: 1%)', '$lightness: Color space rgb doesn\'t have a channel with this name.'],
    ['an amount that is a colour', 'color.adjust(var(--c), $red: rgb(from var(--d) r g b))', 'is not a number']
  ])('fails on %s', async (_, call, reason) => {
    await expect(value(call)).rejects.toMatchObject({ code: 'eval/invalid-function', reason: expect.stringContaining(reason) });
  });

  it('writes a global call that fails', async () => {
    await expect(value('scale-color(#0d6efd, $red: var(--x))')).resolves.toBe('scale-color(#0d6efd, $red: var(--x))');
  });
});

describe('the errors Dart Sass raises are coded diagnostics', () => {
  it.each([
    ['mixing rgb and hsl channels', 'color.adjust($primary, $red: 10, $lightness: 10%)', '$lightness: Color space rgb doesn\'t have a channel with this name.'],
    ['an out-of-range alpha in change', 'color.change($primary, $alpha: 1.5)', '$alpha: Expected 1.5 to be within 0 and 1.'],
    ['scale with a non-percent value', 'color.scale($primary, $lightness: 10)', '$lightness: Expected 10 to have unit "%".']
  ])('%s', async (_, call, reason) => {
    const source = `${THEME}a { b: ${call}; }`;
    await expect(render(source, 'error')).rejects.toMatchObject({
      code: 'eval/invalid-function',
      reason: expect.stringContaining(reason)
    });

    /* A module's function is never a CSS function, so the default `functionMode` has nothing to write out (ruling J1). */
    await expect(render(source)).rejects.toMatchObject({
      code: 'eval/invalid-function',
      reason: expect.stringContaining(reason)
    });
  });
});
