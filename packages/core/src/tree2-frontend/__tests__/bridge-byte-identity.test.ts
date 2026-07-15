import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2, UnsupportedShape } from '../bridge.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../../tree/util/render-buffer.js';

const CN = { collapseNesting: true } as const;

async function renderLegacy(tree: unknown): Promise<string> {
  const ctx = new Context();
  (ctx as unknown as { root: unknown }).root = tree;
  return await renderNodeToString(tree as Parameters<typeof renderNodeToString>[0], ctx, CN);
}

/** Small synthetic-but-real-syntax .less inputs using only supported shapes. */
const inputs: Array<[string, string]> = [
  ['one-decl', '.test { color: red; }\n'],
  ['multi-decl', '.box { margin: 0; padding: 10px; color: red; }\n'],
  ['compound', '.a.b { color: red; }\n'],
  ['child-combinator', '.x > .y { color: red; }\n'],
  ['descendant', '.p .q { color: red; }\n'],
  ['list', '.m, .n { color: red; }\n'],
  ['nesting', '.a { .b { color: red; } }\n'],
  ['amp-hover', '.a { &:hover { color: blue; } }\n'],
  ['amp-class', '.a { &.b { color: red; } }\n'],
  ['deep-nest', '.a { .b { .c { color: red; } } }\n'],
  ['spaced-value', '.a { border: 1px solid black; }\n'],
  ['mixin-noparen-body', '.mix() { color: red; width: 10px; }\n.a { .mix(); }\n'],
  ['mixin-nested', '.box() { color: red; .inner { width: 1px; } }\n.a { .box(); }\n'],
  // rung 7: variables + real scope (reference substitution only)
  ['var-simple', '@c: red;\n.a { color: @c; }\n'],
  ['var-chain', '@a: red;\n@b: @a;\n.a { color: @b; }\n'],
  ['var-in-spaced', '@w: 1px;\n.a { border: @w solid black; }\n'],
  ['var-lazy', '.a { color: @c; }\n@c: blue;\n'],
  ['var-last-wins', '@c: red;\n@c: green;\n.a { color: @c; }\n'],
  ['var-rule-scope', '.a { @c: blue; color: @c; }\n'],
  ['var-nested-scope', '@c: red;\n.a { .b { color: @c; } }\n'],
  ['var-shadow', '@c: red;\n.a { @c: blue; color: @c; }\n'],
  ['var-mixin-arg', '.paint(@c) { color: @c; }\n@x: teal;\n.a { .paint(@x); }\n'],
  ['var-mixin-default', '.paint(@c: red) { color: @c; }\n.a { .paint(); }\n'],
];

describe('bridge byte-identity (constructed .less)', () => {
  for (const [name, src] of inputs) {
    it(name, async () => {
      const parsed = parseLessFn(src);
      let bridged;
      try {
        bridged = bridgeToTree2(parsed.tree, src);
      } catch (e) {
        if (e instanceof UnsupportedShape) {
          throw new Error(`UNSUPPORTED ${e.feature} (${e.detail}) for: ${src.trim()}`);
        }
        throw e;
      }
      const t2css = serialize(bridged).css;
      const legacy = await renderLegacy(parsed.tree);
      if (t2css !== legacy) {
        console.log(`\n--- ${name} ---\nSRC: ${JSON.stringify(src)}\nT2 : ${JSON.stringify(t2css)}\nLEG: ${JSON.stringify(legacy)}`);
      }
      expect(t2css).toBe(legacy);
    });
  }
});
