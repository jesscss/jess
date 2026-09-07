import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';

const scss = (src: string): Promise<string> =>
  new Compiler({ output: { collapseNesting: true } }).renderString(src, { extension: '.scss' });

/**
 * Sass `@content(args)` passes arguments to the `using (…)` parameters of the
 * block the caller assigned to an `@include`. The block lowers to a
 * `content`-bound anonymous mixin with params; `@content(x)` is a call on it.
 * Regression: an arg-carrying call was routed through the value-lambda path,
 * which requires a `result:` the content block never has, so it threw
 * "Invalid function call". Block-less `@content` was unaffected.
 */
describe('SCSS @content passes arguments to using(...) params', () => {
  it('binds a single content argument to the block param', async () => {
    const css = await scss(`@mixin m { @content(red); }
.a { @include m using ($t) { color: $t; } }
`);
    expect(css).toContain('color: red');
  });

  it('binds multiple content arguments in order', async () => {
    const css = await scss(`@mixin m { @content(red, blue); }
.a { @include m using ($x, $y) { color: $x; background: $y; } }
`);
    expect(css).toContain('color: red');
    expect(css).toContain('background: blue');
  });

  it('resolves the content argument in the mixin (call-site) scope', async () => {
    const css = await scss(`$t: outer;
@mixin m { $type: inner; @content($type); }
.a { @include m using ($t) { color: $t; } }
.b { color: $t; }
`);
    expect(css).toContain('color: inner');

    // the content-block param must NOT leak past the block: outer $t survives.
    expect(css).toContain('color: outer');
  });

  it('fills a using(...) param default when @content passes fewer args', async () => {
    const css = await scss(`@mixin m { @content(red); }
.a { @include m using ($x, $y: blue) { color: $x; background: $y; } }
`);
    expect(css).toContain('color: red');
    expect(css).toContain('background: blue');
  });

  it('block-less @content still splices with no arguments', async () => {
    const css = await scss(`@mixin m { @content; }
.a { @include m { color: red; } }
`);
    expect(css).toContain('color: red');
  });
});
