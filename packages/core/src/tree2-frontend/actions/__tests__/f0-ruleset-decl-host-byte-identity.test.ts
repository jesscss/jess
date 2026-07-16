import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F0 byte-identity: the registry-driven dispatch host
 * (`ACTION_LIST` seeded with the ruleset + static-declaration families) produces
 * the SAME serialized CSS as the parse→legacy-tree→bridge path, driven through
 * `runFunctionalParseT2` (the tree2 driver that returns the root directly). This
 * is the template every family's byte-identity gate copies.
 */
const g = lessGrammar as Record<string, unknown>;

function tree2Direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f0: no root produced');
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

const inputs: Array<[string, string]> = [
  ['single-decl', '.a { color: red }\n'],
  ['two-decls', '.a { color: red; width: 10px }\n'],
  ['trailing-semi', '.a { color: red; width: 10px; }\n'],
  ['id-selector', '#main { display: block }\n'],
  ['compound', '.a.b { margin: 0 }\n'],
  ['multi-rule', '.a { color: red }\n.b { color: blue }\n'],
  ['dimension', '.box { width: 100px; height: 2rem }\n'],
];

describe('[tree2-native] F0 registry host byte-identity vs bridge', () => {
  for (const [name, src] of inputs) {
    it(name, () => {
      const direct = serialize(tree2Direct(src)).css;
      const bridged = serialize(viaBridge(src)).css;
      if (direct !== bridged) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${name} ---\nSRC:    ${JSON.stringify(src)}\nDIRECT: ${JSON.stringify(direct)}\nBRIDGE: ${JSON.stringify(bridged)}`);
      }
      expect(direct).toBe(bridged);
    });
  }
});
