import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F11 extend byte-identity: the extend family produces the SAME
 * serialized CSS as the parse→legacy-tree→bridge path for the `:extend()` shapes —
 * in-selector `:extend`, standalone `&:extend`, the `all` (partial) flag vs exact,
 * multi-target `:extend(.a, .b)`, and extend inside a selector group. The direct
 * host builds the `ExtendInstruction` faithfully; the `:is()` compaction is the R1
 * serialize-time engine (downstream), so both paths compact identically iff the
 * built instruction structure matches the bridge's.
 */
const g = lessGrammar as Record<string, unknown>;

function direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('extend: no root produced');
  return root;
}
function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

// In-selector extend (`.a:extend(.b)`), the `all` flag, exact vs partial, multi-target.
const inSelector = [
  '.a:extend(.b) { x: 1 }\n',
  '.a:extend(.b all) { x: 1 }\n',
  '.a:extend(.b !all) { x: 1 }\n',
  '.c:extend(.d, .e) { x: 1 }\n',
  '.c:extend(.d all, .e) { x: 1 }\n',
  '.a:extend(.b .c > .d) { x: 1 }\n',
  '.long-selector:extend(.short) { color: red }\n',
];

// Standalone `&:extend(...)` body statement.
const standalone = [
  '.a { &:extend(.b); }\n',
  '.a { &:extend(.b all); }\n',
  '.a { &:extend(.b, .c); }\n',
  '.a { color: red; &:extend(.b); }\n',
];

// Extend inside a selector group.
const groups = [
  '.a:extend(.b), .c { x: 1 }\n',
  '.a:extend(.b), .c:extend(.d) { x: 1 }\n',
  '.a, .b:extend(.c all) { x: 1 }\n',
];

// Extend that actually FIRES against a matching rule → exercises the R1 `:is()`
// compaction on both paths (the real end-to-end oracle).
const firing = [
  '.b { c: 1 }\n.a:extend(.b) { x: 1 }\n',
  '.b { c: 1 }\n.a { &:extend(.b); }\n',
  '.nav .item { c: 1 }\n.a:extend(.nav .item all) { x: 1 }\n',
  '.thing { c: 1 }\n.other { d: 2 }\n.a:extend(.thing, .other) { x: 1 }\n',
  '.box { c: 1 }\n.a { &:extend(.box all); color: red }\n',
];

const cases = [...inSelector, ...standalone, ...groups, ...firing];

describe('[tree2-native] F11 extend host byte-identity vs bridge', () => {
  for (const src of cases) {
    it(src.replace(/\n/g, ' ').trim(), () => {
      const d = serialize(direct(src)).css;
      const b = serialize(viaBridge(src)).css;
      if (d !== b) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${JSON.stringify(src)} ---\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      }
      expect(d).toBe(b);
    });
  }
});
