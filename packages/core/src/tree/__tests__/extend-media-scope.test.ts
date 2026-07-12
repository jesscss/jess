import { describe, it, expect } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';

/**
 * Regression: an `:extend` inside an `@media` block used to crash with
 * `selector.cloneForPlacement is not a function`. The extend is invisible to the
 * top-level root, so the "extend not accessible/not found" diagnostic probes
 * whether a protected root's ruleset *would* be changed. That probe passed the
 * raw, parser-shaped (string-backed) selector straight into the extend engine,
 * whose placement copy calls Node methods — hence the crash. The selector must be
 * materialized to a Selector node first (like every other classification path).
 *
 * Media-scoped extends do NOT reach selectors outside the media block (Less 4.x),
 * so `.b` stays unextended and `.a` gets its own rule inside the media block.
 */
async function render(source: string): Promise<string> {
  const context = new Context({ output: { collapseNesting: true }, leakyScope: true });
  const parser = new Parser();
  const { tree } = parser.parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return renderNodeToString(tree as unknown as RenderBufferNode, context, { context });
}

describe('extend inside @media (scope boundary)', () => {
  it('explicit `.a:extend(.b)` nested in @media does not crash and stays media-scoped', async () => {
    const css = await render(`
.b { color: red; }
@media (min-width: 100px) {
  .a:extend(.b) { color: blue; }
}
`);
    expect(css.trim()).toBe(`
.b {
  color: red;
}
@media (min-width: 100px) {
  .a {
    color: blue;
  }
}
`.trim());
  });

  it('`&:extend(.b)` nested in @media does not crash and stays media-scoped', async () => {
    const css = await render(`
.b { color: red; }
@media (min-width: 100px) {
  .a { &:extend(.b); color: blue; }
}
`);
    expect(css.trim()).toBe(`
.b {
  color: red;
}
@media (min-width: 100px) {
  .a {
    color: blue;
  }
}
`.trim());
  });

  /**
   * NEGATIVE-VISIBILITY OUTPUT ORACLE (A3 "inner can't reach out", partial `all` form).
   * ================================================================================
   * A partial `:extend(.shared all)` DECLARED INSIDE `@media print` must NOT reach the
   * root-level `.shared` (or the later root-level `.also-shared`): the inner extend root
   * cannot see out to the document root. The observable proof is the RENDERED CSS — the
   * root `.shared` header must stay bare (`.shared`), NEVER `.shared, .x`.
   *
   * Expected output derived from the real `less@4` oracle (less 4.6.7, standalone
   * `less.render`, NOT the jess-backed alpha): the `@media print` extend is dropped, `.x`
   * renders only inside the media block, and both root rules keep their bare headers.
   */
  it('A3 negative: `:extend(.shared all)` inside @media does NOT reach root-level targets', async () => {
    const css = await render(`
.shared { color: red; }
@media print {
  .x:extend(.shared all) { background: blue; }
}
.also-shared { color: green; }
`);
    // Positive control: the extender must NOT leak into any root header.
    expect(css).not.toContain('.shared,');
    expect(css).not.toContain('.x,');
    expect(css.trim()).toBe(`
.shared {
  color: red;
}
@media print {
  .x {
    background: blue;
  }
}
.also-shared {
  color: green;
}
`.trim());
  });
});
