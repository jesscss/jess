import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

// Minimal reduction of the bootstrap grid wall: a function call (`range`) inside
// a NESTED `each` body must still resolve. Before the fix, `range(3)` stayed an
// unevaluated Any inside the inner each, so `each` iterated once binding `@i` to
// `range(3)`, and `100% / @i` threw "Cannot operate on Any".
async function render(src: string): Promise<string> {
  const c = new Compiler({ compile: { plugins: [lessPlugin(), lessCompatPlugin()] } });
  return c.renderString(src, {
    language: 'less',
    extension: 'less',
    config: { suppressWarnings: true, breakOnError: false } as any
  });
}

describe('wall6: function calls inside nested control-flow bodies', () => {
  it('nested each iterates over range()', async () => {
    const css = await render(
      `.g { each(1, #(@x) { each(range(3), #(@i) { .r-@{i} { w: (100% / @i); } }); }); }`
    );
    expect(css).toContain('.r-1');
    expect(css).toContain('.r-3');
    expect(css).not.toContain('range(3)');
  });

  it('function call inside each body resolves', async () => {
    const css = await render(
      `.g { each(1 2, #(@x) { .c-@{x} { w: length(range(3)); } }); }`
    );
    expect(css).toContain('w: 3');
    expect(css).not.toContain('length(');
  });

  it('single-level each over range() still works', async () => {
    const css = await render(`.g { each(range(3), #(@i) { .r-@{i} { w: @i; } }); }`);
    expect(css).toContain('.r-1');
    expect(css).toContain('.r-3');
  });
});
