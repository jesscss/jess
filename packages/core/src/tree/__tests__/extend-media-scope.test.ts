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
});
