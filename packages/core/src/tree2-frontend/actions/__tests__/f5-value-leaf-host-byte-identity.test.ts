import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F5 byte-identity: the value-leaf family (numeric/color/keyword/
 * quoted/url) produces the SAME serialized CSS as the parse→legacy-tree→bridge
 * path. Includes multi-part values where only ONE part builds a leaf node
 * (`1px solid red` → only `red`) to gate the declaration's whole-value guard
 * against dropping the rest.
 */
const g = lessGrammar as Record<string, unknown>;

function tree2Direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f5: no root produced');
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

const values = [
  // numeric leaves (unit + unitless + signed + decimal + percent + uppercase)
  '10px', '1.0px', '100%', '0', '-3px', '.5s', '2.000rem', '10PX',
  // hex + named colors
  '#fff', '#AABBCC', '#abc123', 'red', 'transparent',
  // keyword-ish idents
  'block', 'solid', 'auto', 'inherit',
  // quoted strings
  '"hi"', "'yo'", '"a b c"',
  // url
  'url(a.png)', 'url("b.png")',
  // multi-part values (only some parts build a leaf node) — whole-value guard
  '1px solid red', '0 auto', '10px 20px', 'bold 14px sans-serif', '#fff 0',
];

describe('[tree2-native] F5 value-leaf host byte-identity vs bridge', () => {
  for (const v of values) {
    const src = `.a { m: ${v} }\n`;
    it(v, () => {
      const direct = serialize(tree2Direct(src)).css;
      const bridged = serialize(viaBridge(src)).css;
      if (direct !== bridged) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${v} ---\nDIRECT: ${JSON.stringify(direct)}\nBRIDGE: ${JSON.stringify(bridged)}`);
      }
      expect(direct).toBe(bridged);
    });
  }
});
