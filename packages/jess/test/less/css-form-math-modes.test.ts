import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A built-in's CSS form is the same value under every math mode: its math is
 * CSS's, written in a math function in a colour's channel
 * (docs/design/CSS-NATIVE-BUILTINS.md §2, §3.3).
 */
const MODES = ['always', 'parens-division', 'parens', 'strict'] as const;

describe.each(MODES)('a CSS form under math: %s', (mathMode) => {
  const value = async (source: string): Promise<string | undefined> =>
    (await new Compiler({ compile: { mathMode } }).renderString(`@use "#less";\n.x { a: ${source}; }`, { language: 'less', extension: '.less' })).match(/a: (.*);/)?.[1];

  it.each([
    ['@less.darken(#336699, 10%)', '#264c73'],
    ['@less.darken(#336699, 10%, relative)', '#2e5c8a'],
    ['@less.spin(#336699, 30)', '#333399'],
    ['@less.greyscale(#336699)', '#666666'],
    ['@less.darken(var(--c), 10%)', 'hsl(from var(--c) h s clamp(0, l - 10, 100))'],
    ['@less.darken(var(--c), 10%, relative)', 'hsl(from var(--c) h s clamp(0, l - l * 10 / 100, 100))'],
    ['@less.spin(var(--c), 30)', 'hsl(from var(--c) calc(h + 30) s l)'],
    ['@less.lighten(hsl(from #336699 h s clamp(0, l - 10, 100)), 10%)', 'hsl(210, 50%, 40%)']
  ])('%s is %s', async (source, expected) => {
    await expect(value(source)).resolves.toBe(expected);
  });
});
