import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

const less = (src: string): Promise<string> =>
  new Compiler({ output: { collapseNesting: true } }).renderString(src, { extension: '.less' });

/**
 * Less issue #4352: forwarding an EMPTY variadic (`@rest`) as an ordinary
 * argument must NOT fill the next parameter slot — the empty list passes no
 * argument, so a defaulted parameter keeps its default. A filled variadic still
 * forwards its members. Regression: the empty `@rest` byte-flattened to `''`
 * and overrode `@b`'s default, emitting `b: ` instead of `b: fallback`.
 */
describe('Less empty variadic forwarding keeps the callee default (#4352)', () => {
  it('an empty forwarded @rest keeps the target default', async () => {
    const css = await less(`.rest-forward(@a, @rest...) {
  .rest-target(@a, @rest);
}
.rest-target(@a, @b: fallback) {
  a: @a;
  b: @b;
}
.empty { .rest-forward(1); }
`);
    expect(css).toContain('a: 1');
    expect(css).toContain('b: fallback');
    expect(css).not.toMatch(/b:\s*;/);
  });

  it('a filled forwarded @rest still overrides the default', async () => {
    const css = await less(`.rest-forward(@a, @rest...) {
  .rest-target(@a, @rest);
}
.rest-target(@a, @b: fallback) {
  a: @a;
  b: @b;
}
.filled { .rest-forward(1, 2); }
`);
    expect(css).toContain('a: 1');
    expect(css).toContain('b: 2');
  });

  it('an explicitly-passed empty string is NOT dropped', async () => {
    const css = await less(`.m(@a, @b: fallback) { a: @a; b: @b; }
@empty: ~"";
.x { .m(1, @empty); }
`);
    expect(css).toMatch(/b:\s*;/);
  });
});
