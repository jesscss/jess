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

    /* Under the default `functionMode`, a call that cannot produce a value is written out as authored. */
    await expect(render(source)).resolves.toBe(`a {\n  b: ${call.replace('$primary', '#0d6efd')};\n}\n`);
  });
});
