import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { runFunctionalParse } from '@jesscss/css-parser/jess';
import { serialize, Root } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { PocTree2Host } from '../poc-tree2-host.js';

/**
 * [tree2-poc] Byte-identity: the parallel tree2-emitting host produces the SAME
 * serialized CSS as the current parse→legacy-tree→bridge path, for the
 * representative ruleset + static-declaration shape — while building only ONE
 * tree (no legacy AST, no bridge walk).
 */
const g = lessGrammar as Record<string, unknown>;

function tree2Direct(src: string): Root {
  const host = new PocTree2Host();
  runFunctionalParse(src, g['Stylesheet'] as never, host as never, { trivia: g['rw'] });
  if (!host.root) throw new Error('poc: no root produced');
  return host.root;
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

describe('[tree2-poc] parallel tree2 host byte-identity vs bridge', () => {
  for (const [name, src] of inputs) {
    it(name, () => {
      const direct = serialize(tree2Direct(src)).css;
      const bridged = serialize(viaBridge(src)).css;
      if (direct !== bridged) {
        console.log(`\n--- ${name} ---\nSRC:    ${JSON.stringify(src)}\nDIRECT: ${JSON.stringify(direct)}\nBRIDGE: ${JSON.stringify(bridged)}`);
      }
      expect(direct).toBe(bridged);
    });
  }
});
