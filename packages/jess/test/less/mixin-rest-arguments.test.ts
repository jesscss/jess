import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('Less mixin rest arguments', () => {
  it('keeps a sole space-list as one argument while comma and semicolon calls remain separate', async () => {
    const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });
    const css = await compiler.renderString(`
.collect(@values...) {
  count: length(@values);
  first: extract(@values, 1);
  third: extract(@values, 3);
  args: @arguments;
}
.space { .collect(a b c); }
.comma { .collect(a, b, c); }
.semi { .collect(1; 2; 3); }
`, { language: 'less' });

    expect(css).toBe(
      '.space {\n  count: 1;\n  first: a b c;\n  third: extract(a b c, 3);\n  args: a b c;\n}\n'
      + '.comma {\n  count: 3;\n  first: a;\n  third: c;\n  args: a b c;\n}\n'
      + '.semi {\n  count: 3;\n  first: 1;\n  third: 3;\n  args: 1 2 3;\n}\n'
    );
  });
});
