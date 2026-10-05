/**
 * `collapseNesting` flatten styles: `false` (nested, default), `'native'` (CSS
 * Nesting desugaring — parent `:is()`, child list distributed, specificity-
 * faithful), and `'compact'` (also folds same-combinator descendant runs into a
 * single `:is()`, group-max specificity).
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function render(src: string, collapseNesting: false | 'native' | 'compact'): Promise<string> {
  const c = new Compiler({ output: { collapseNesting } });
  return String(await c.renderString(src, { extension: '.less', suppressWarnings: true }));
}

describe('collapseNesting native vs compact', () => {
  it(`'native' distributes a child selector list (each branch keeps its own specificity)`, async () => {
    const out = await render('.a, .b { .c, .d { x: 1 } }', 'native');
    expect(out).toContain(':is(.a, .b) .c');
    expect(out).toContain(':is(.a, .b) .d');
    expect(out).not.toContain(':is(.c, .d)');
  });

  it(`'compact' folds the child list into one :is()`, async () => {
    const out = await render('.a, .b { .c, .d { x: 1 } }', 'compact');
    expect(out).toContain(':is(.a, .b) :is(.c, .d)');
  });

  it(`mixed-specificity child list (the bootstrap th/td case) stays per-branch under 'native'`, async () => {
    const out = await render('.tb { th, td, thead th { x: 1 } }', 'native');
    expect(out).toContain('.tb th');
    expect(out).toContain('.tb thead th');
    expect(out).not.toContain(':is(th');
  });

  it(`'compact' groups the mixed child list into one :is()`, async () => {
    const out = await render('.tb { th, td, thead th { x: 1 } }', 'compact');
    expect(out).toContain(':is(th, td, thead th)');
  });

  /*
   * A child under a NESTED multi-branch rule keeps every branch of that rule as
   * its ancestor. It used to keep only the first, silently dropping selectors
   * (bootstrap's `.btn-group-toggle > .btn-group > .btn input[type="radio"]`).
   */
  it('keeps every branch of a nested multi-branch rule as the ancestor of its children', async () => {
    await expect(render('.a { .b, .c { e { y: 2; } } }', 'native'))
      .resolves.toBe(':is(.a .b, .a .c) e {\n  y: 2;\n}\n');
    await expect(render('.a { .b, .c { e { y: 2; } } }', 'compact'))
      .resolves.toBe('.a :is(.b, .c) e {\n  y: 2;\n}\n');
    await expect(render('.t { > .b, > .g > .b { i, j { y: 2; } } }', 'native'))
      .resolves.toBe(':is(.t > .b, .t > .g > .b) i,\n:is(.t > .b, .t > .g > .b) j {\n  y: 2;\n}\n');

    // jess#357: relative children of a relative selector list keep every parent branch.
    await expect(render('.a { > .b, > .c { + .d, + .e { x: 1 } } }', 'native'))
      .resolves.toBe(':is(.a > .b, .a > .c) + .d,\n:is(.a > .b, .a > .c) + .e {\n  x: 1;\n}\n');
  });

  it(`'false' preserves authored nesting (no :is())`, async () => {
    const out = await render('.a, .b { .c, .d { x: 1 } }', false);
    expect(out).not.toContain(':is(');
    expect(out).toMatch(/\.a,\s*\.b/);
  });
});
