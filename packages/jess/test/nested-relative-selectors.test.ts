import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';
import { parse as parseCss } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';

/**
 * P29 (owner-settled): nested relative selectors (CSS Nesting leading
 * combinators) are accepted in ALL FOUR dialects. `.parent { > .child { … } }`
 * is valid CSS Nesting — the `>` relates to the implicit parent — so every
 * dialect must accept it and emit the nested rule with the combinator preserved
 * (the project default is collapseNesting:false, so the canonical output keeps
 * the nesting rather than flattening to `.parent > .child`).
 *
 * The complementary SETTLED ruling (root leading combinator) still holds: a
 * stylesheet-root `> .a { … }` has no parent to relate to and is REJECTED.
 *
 * css is exercised through the css parser + core serializer because the default
 * Compiler carries no `.css` plugin; less/scss/jess go through the Compiler.
 */

const NESTED = '.parent { > .child { color: red } }';
const ROOT = '> .a { color: red }';

// The canonical nested-preserved emit shared by all four dialects.
const NESTED_OUT = '.parent {\n  > .child {\n    color: red;\n  }\n}\n';

async function renderCss(source: string): Promise<string> {
  return (await serialize(parseCss(source), { collapseNesting: false })).css;
}

describe('P29 nested relative selectors', () => {
  it('css accepts a nested leading combinator and preserves it', async () => {
    expect(await renderCss(NESTED)).toBe(NESTED_OUT);
  });

  it('css rejects a stylesheet-root leading combinator', () => {
    expect(() => parseCss(ROOT)).toThrow();
  });

  for (const ext of ['.less', '.scss', '.jess'] as const) {
    it(`${ext} accepts a nested leading combinator and preserves it`, async () => {
      const compiler = new Compiler();
      const css = String(await compiler.renderString(NESTED, { extension: ext }));
      expect(css).toBe(NESTED_OUT);
    });

    it(`${ext} rejects a stylesheet-root leading combinator`, async () => {
      const compiler = new Compiler();
      await expect(compiler.renderString(ROOT, { extension: ext })).rejects.toThrow();
    });
  }

  it('css mixes relative and ordinary items in one nested list', async () => {
    const out = await renderCss('.parent { > .a, .b { color: red } }');
    expect(out).toBe('.parent {\n  > .a,\n  .b {\n    color: red;\n  }\n}\n');
  });
});
