import { describe, it, expect } from 'vitest';
import { lessGrammar, parseLessFn } from '@jesscss/less-parser';
import { serialize, Root } from '../../../index.js';
import { bridgeToAst } from '../../__tests__/bridge.js';
import { parseToAst } from '../../dispatch-host.js';

/**
 * F16 byte-identity: the registry host's charset / raw-at-STATEMENT
 * family (`AtRuleStatement`) serializes IDENTICALLY to the parse→legacy-tree→bridge
 * path. Covers `@charset "…";` (hoist-first / dedupe-rest, owned by the serializer)
 * and generic statement-form at-rules (`@namespace`, `@layer`), in single, mid-body,
 * and duplicate positions. Same differential template as the F0 gate.
 */
const g = lessGrammar as Record<string, unknown>;

function astDirect(src: string): Root {
  const { root } = parseToAst(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f16: no root produced');
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToAst(parseLessFn(src).tree, src) as unknown as Root;
}

const inputs: Array<[string, string]> = [
  // ── @charset ───────────────────────────────────────────────────────────────
  ['charset-single', '@charset "UTF-8";\n.a { color: red }\n'],
  ['charset-only', '@charset "UTF-8";\n'],
  ['charset-mid-body', '.a { color: red }\n@charset "UTF-8";\n.b { color: blue }\n'],
  ['charset-dedupe', '.a { color: red }\n@charset "utf-8";\n.b { color: blue }\n@charset "utf-8";\n'],
  ['charset-dedupe-different-value', '@charset "UTF-8";\n.a { color: red }\n@charset "ISO-8859-1";\n'],
  ['charset-lowercase-value', '@charset "iso-8859-1";\n.a { color: red }\n'],
  // ── generic statement-form at-rules (no block) ───────────────────────────────
  ['namespace-statement', '@namespace svg "http://example.com/svg";\n.a { color: red }\n'],
  ['namespace-prefixless', '@namespace "http://example.com/x";\n'],
  ['layer-statement', '@layer a, b, c;\n.a { color: red }\n'],
  ['at-statement-mid-body', '.a { color: red }\n@namespace svg "http://example.com/svg";\n.b { color: blue }\n'],
  ['at-statement-duplicate', '@layer a;\n@layer b;\n.a { color: red }\n'],
];

describe('charset / raw at-statement host byte-identity vs bridge', () => {
  for (const [name, src] of inputs) {
    it(name, () => {
      const direct = serialize(astDirect(src)).css;
      const bridged = serialize(viaBridge(src)).css;
      if (direct !== bridged) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${name} ---\nSRC:    ${JSON.stringify(src)}\nDIRECT: ${JSON.stringify(direct)}\nBRIDGE: ${JSON.stringify(bridged)}`);
      }
      expect(direct).toBe(bridged);
    });
  }
});
