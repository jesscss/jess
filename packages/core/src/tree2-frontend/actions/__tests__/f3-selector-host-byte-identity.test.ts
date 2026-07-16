import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F3 byte-identity: the selector family produces the SAME
 * serialized CSS as the parse→legacy-tree→bridge path, incl. combinator
 * NORMALIZATION (`.a>.b` → `.a > .b`), multi-selector lists (one complex per
 * line), descendant vs concatenation, pseudo/attribute/`&` tokens, and nesting.
 */
const g = lessGrammar as Record<string, unknown>;

function direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f3: no root produced');
  return root;
}
function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

// full-source cases (selector head varies; body fixed)
const heads = [
  '.a', '#main', '.a.b', 'div.a#b.c', 'h1', '*',
  '.a > .b', '.a>.b', '.a > .b > .c', '.a + .b', '.a~.b', '.a .b', '.a   .b', '.a.b .c',
  '* > .a', '.a > *',
  '.a:hover', '.a::before', '.a:hover::before', '.a:not(.b)', '.a:nth-child(2n+1)',
  '.a[data-x]', '.a[data-x="y"]', '.a[data-x~="y" i]', 'a[href^="http"]', 'input[type="text"]:focus',
  '.a, .b', '.a, .b, .c', '.a.b, .c > .d', '.a>.b, .c',
  '.a:hover > .b', '.a > .b:focus', '.a.b:hover .c[x]',
];
const nesting = [
  '.a { &:hover { x: 1 } }', '.a { & .b { x: 1 } }', '.a { .b & { x: 1 } }',
  '.a { > .b { x: 1 } }', '.a { &.b { x: 1 } }', '.a { &-suffix { x: 1 } }',
  '.a, .b { .c { x: 1 } }',
];

describe('[tree2-native] F3 selector host byte-identity vs bridge', () => {
  for (const h of heads) {
    const src = `${h} { x: 1 }\n`;
    it(h, () => {
      const d = serialize(direct(src)).css;
      const b = serialize(viaBridge(src)).css;
      if (d !== b) console.log(`\n--- ${h} ---\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      expect(d).toBe(b);
    });
  }
  for (const src of nesting) {
    it(src.replace(/\n/g, ' '), () => {
      const d = serialize(direct(src)).css;
      const b = serialize(viaBridge(src)).css;
      if (d !== b) console.log(`\n--- ${src} ---\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      expect(d).toBe(b);
    });
  }
});
