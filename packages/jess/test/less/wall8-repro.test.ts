import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * Regression (bootstrap-wall8): a multi-slot interpolation like
 * `.d@{infix}-@{value}` must resolve every `@{...}` slot in ONE scope — the one
 * active when the interpolation starts. `context.rulesContext` is a single
 * mutable field; evaluating an earlier slot whose value descends through an
 * ASYNC plugin function (Bootstrap `breakpoint-infix`/`breakpoint-min`) leaves a
 * DEFERRED rulesContext save/restore that interleaves across the await and lands
 * a stale scope back on the context BETWEEN slots. The next slot's per-iteration
 * loop binding (`@value`) then resolves against that leaked scope and misses with
 * `'value' is not defined`. The interpolation re-asserts its own entry scope
 * before each slot. See interpolated.ts `_evalToInterpolated`.
 *
 * This mirrors Bootstrap's utilities/_display.less shape: an outer each drives a
 * `#(@content)` mixin whose body runs two sibling `& when` guards around an inner
 * each; the selector's `@infix` comes from an async public Less-plugin call.
 */
describe('wall8: multi-slot interpolation loop var after async plugin slot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wall8-repro-'));

  // Async compat functions (return promises) that must EVAL the passed ruleset —
  // the async + nested-scope descent that leaks rulesContext.
  const bpPlugin = {
    install(less: any) {
      const evalMap = function(this: any, map: any) {
        const rules = map?.ruleset?.rules ?? map?.rules ?? [];
        for (const r of rules) {
          if (typeof r?.eval === 'function') {
            try {
              r.eval(this);
            } catch { /* ignore */ }
          }
        }
      };
      less.functions.functionRegistry.add('bpmin', function(this: any, name: any, map: any) {
        evalMap.call(this, map);
        return new less.tree.Dimension(100, 'px');
      });
      less.functions.functionRegistry.add('bpinfix', async function(this: any, name: any, map: any) {
        await Promise.resolve();
        evalMap.call(this, map);
        const raw = String(name?.value ?? name?.valueOf?.() ?? name);
        return new less.tree.Quoted('"', `-${raw}`, true);
      });
    }
  };

  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin({ plugins: [bpPlugin] })] }
  });

  const render = async (src: string) => {
    const file = join(dir, `t${Math.random().toString(36).slice(2)}.less`);
    writeFileSync(file, src);
    const out = await compiler.render(file, { suppressWarnings: true, breakOnError: false });
    return typeof out === 'string' ? out : (out as any).css ?? String(out);
  };

  it('keeps a no-plugin selector on the synchronous selector fast path', async () => {
    const css = await render('.plain-selector { color: red; }');
    expect(css).toBe('.plain-selector {\n  color: red;\n}\n');
  });

  it('resolves @value after an async-plugin @{infix} slot, per iteration', async () => {
    const css = await render(`
@grid-breakpoints: { xs: 0; sm: 576px; };
@displays: none, block;
#bp-up(@name, @content, @breakpoints: @grid-breakpoints) {
  @min: bpmin(@name, @breakpoints);
  & when not (@min = ~"") {
    @media (min-width: @min) {
      @content();
    }
  }
  & when (@min = ~"") {
    @content();
  }
}
each(@grid-breakpoints, #(@bpval, @breakpoint) {
  #bp-up(@breakpoint, {
    @infix: bpinfix(@breakpoint, @grid-breakpoints);
    each(@displays, #(@value) {
      .d@{infix}-@{value} { display: @value; }
    });
  });
});`);
    // Both breakpoints AND both displays must appear — no iteration-1 latching,
    // and @value must resolve after the async @{infix} slot.
    expect(css).toContain('.d-xs-none');
    expect(css).toContain('.d-xs-block');
    expect(css).toContain('.d-sm-none');
    expect(css).toContain('.d-sm-block');
    expect(css).toContain('display: none');
    expect(css).toContain('display: block');
  });
});
