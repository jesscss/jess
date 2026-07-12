import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * Regression: Less `each(list, #(@a, @b){...})` must bind the pattern-bound
 * loop variables (`@value`/`@key`/`@index`, or their `#(...)` param aliases)
 * per iteration — including when they are read inside a NESTED ruleset or a
 * `& when (...)` guard within the loop body. The nested-ruleset frame was
 * prep-latched to the loop's source template (no per-iteration live slots),
 * so `@name`/`@width` came back unbound. See ruleset.ts `_prepareChildRulesRegistration`.
 */
describe('each pattern-bound loop variables', () => {
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin()] }
  });

  const render = (src: string) =>
    compiler.renderString(src, { language: 'less', suppressWarnings: true, breakOnError: false } as any);

  it('binds #(@v, @k) over a map at the body level', async () => {
    const css = await render(`
      @m: { a: 1; b: 2; };
      .x { each(@m, #(@v, @k) { @{k}: @v; }); }
    `);
    expect(css).toContain('a: 1');
    expect(css).toContain('b: 2');
  });

  it('binds #(@v, @k) over a list', async () => {
    const css = await render(`
      @list: red, green, blue;
      .x { each(@list, #(@v, @k) { prop-@{k}: @v; }); }
    `);
    expect(css).toContain('prop-1: red');
    expect(css).toContain('prop-3: blue');
  });

  it('binds loop vars used as VALUES inside a nested ruleset', async () => {
    const css = await render(`
      @grid-breakpoints: { xs: 0; sm: 576px; };
      .make {
        each(@grid-breakpoints, #(@width, @name) {
          .inner { the-name: @name; the-width: @width; }
        });
      }
    `);
    expect(css).toContain('the-name: xs');
    expect(css).toContain('the-width: 0');
    expect(css).toContain('the-name: sm');
    expect(css).toContain('the-width: 576px');
  });

  it('binds loop vars used as VALUES inside a & when guard (bootstrap _grid shape)', async () => {
    const css = await render(`
      @grid-breakpoints: { xs: 0; sm: 576px; };
      .make {
        each(@grid-breakpoints, #(@width, @name) {
          & when (@width = 0) {
            name: @name;
            width: @width;
          }
        });
      }
    `);
    // Only xs (width=0) passes the guard.
    expect(css).toContain('name: xs');
    expect(css).toContain('width: 0');
    expect(css).not.toContain('name: sm');
  });
});
