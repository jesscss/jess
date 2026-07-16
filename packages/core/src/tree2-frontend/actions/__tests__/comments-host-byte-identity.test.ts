import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F17 byte-identity: the COMMENTS family (registered after the
 * ruleset family, overriding its `Stylesheet`/`Ruleset` body assembly) lifts
 * STANDALONE block comments into `Comment` body children — identical bytes to the
 * parse→legacy-tree→bridge path (`bridge.ts` `case 'Comment'`).
 *
 * Coverage: standalone (root + nested body), inline-before-declaration (lifted),
 * multi-line block comments, adjacent-to-declaration, trailing (before `}` / EOF),
 * consecutive comments, and line comments (`//`, always dropped by Less).
 */
const g = lessGrammar as Record<string, unknown>;

function tree2Direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) {
    throw new Error('f17: no root produced');
  }
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

const inputs: Array<[string, string]> = [
  // standalone at root
  ['root-standalone', '/* top */\n.a { color: red }\n'],
  ['root-consecutive', '/* c1 */\n/* c2 */\n.a { color: red }\n'],
  ['root-between-rules', '.a { color: red }\n/* mid */\n.b { color: blue }\n'],
  ['root-trailing-eof', '.a { color: red }\n/* end */\n'],
  // standalone inside a rule body
  ['body-standalone', '.a {\n  /* standalone */\n  color: red;\n}\n'],
  ['body-leading', '.a { /* inline */ color: red }\n'],
  ['body-between-decls', '.a {\n  /* c1 */\n  color: red;\n  /* c2 */\n  width: 1px;\n}\n'],
  ['body-trailing', '.a { color: red; /* trailing */ }\n'],
  ['body-after-decl-same-line', '.a {\n  color: red; /* same line */\n}\n'],
  // multi-line block
  ['multi-line', '/* multi\n   line\n   comment */\n.a { color: red }\n'],
  ['multi-line-body', '.a {\n  /* multi\n     line */\n  color: red;\n}\n'],
  // nested rule bodies
  ['nested-body-inline', '.a { .b { /* x */ color: red } }\n'],
  ['nested-body-standalone', '.a {\n  .b {\n    /* deep */\n    color: red;\n  }\n}\n'],
  // line comments (dropped by Less)
  ['line-after-rule', '.a { color: red } // line after\n'],
  ['line-only-root', '// only line\n.a { color: red }\n'],
  ['line-in-body', '.a { color: red; // trailing line\n}\n'],
  // mixed with plain rules (no comments) — override must not regress
  ['no-comment', '.a { color: red; width: 10px }\n']
];

describe('[tree2-native] F17 comments host byte-identity vs bridge', () => {
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
