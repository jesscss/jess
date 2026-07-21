import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('namespaced mixin-call variable values', () => {
  it('retains a nested map call and propagates its call-level importance through accessors', async () => {
    const css = await new Compiler({ compile: { plugins: [lessPlugin()] } }).renderString(`
      #theme.dark.navbar {
        .colors() { primary: rebeccapurple; secondary: lightblue; }
      }
      .card {
        @theme-colors: #theme.dark.navbar.colors() !important;
        background: @theme-colors[primary];
        border-color: @theme-colors[secondary];
      }
    `, { language: 'less' });

    expect(css).toBe(`.card {
  background: rebeccapurple !important;
  border-color: lightblue !important;
}
`);
  });
});
