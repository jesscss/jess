import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F1 (variables) byte-identity: the registry-driven tree2 host
 * (`VarDeclaration` + variable `Reference` actions in `actions/variables.ts`,
 * plus the ruleset / declaration / value-leaf seed families) produces the SAME
 * serialized CSS as the parse→legacy-tree→bridge path — the bridge is the oracle.
 *
 * Inputs are the variable shapes from `bridge-`/`nested-byte-identity`: a
 * top-level `@var` declaration bound and referenced, chained references, lazy /
 * last-wins / shadowing scope, and rule-local + nested-scope references. Each is a
 * WHOLE-value variable reference (a single `@name` in the declaration) — the shape
 * F1 owns; a MULTI-part value that mixes a `@var` with literals (`@w solid black`)
 * needs the value-assembly family and is intentionally not gated here.
 */
const g = lessGrammar as Record<string, unknown>;

function direct(src: string): string {
  const { root, errors } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error(`tree2 host produced no root (errors: ${JSON.stringify(errors)}) for: ${src.trim()}`);
  return serialize(root).css;
}

function bridged(src: string): string {
  return serialize(bridgeToTree2(parseLessFn(src).tree, src)).css;
}

const inputs: Array<[string, string]> = [
  // top-level declaration, bound + referenced
  ['var-simple', '@c: red;\n.a { color: @c; }\n'],
  // chained reference (`@b: @a`, then `color: @b`)
  ['var-chain', '@a: red;\n@b: @a;\n.a { color: @b; }\n'],
  // lazy: reference precedes the declaration textually
  ['var-lazy', '.a { color: @c; }\n@c: blue;\n'],
  // last-wins within a scope
  ['var-last-wins', '@c: red;\n@c: green;\n.a { color: @c; }\n'],
  // rule-local declaration
  ['var-rule-scope', '.a { @c: blue; color: @c; }\n'],
  // reference from a nested scope resolves the outer declaration
  ['var-nested-scope', '@c: red;\n.a { .b { color: @c; } }\n'],
  // inner declaration shadows the outer
  ['var-shadow', '@c: red;\n.a { @c: blue; color: @c; }\n'],
  // nested reference (from nested-byte-identity)
  ['var-in-nested', '@c: red; .a { .b { color: @c; } }\n'],
  // nested shadow (from nested-byte-identity)
  ['var-shadow-nested', '@c: red; .a { @c: blue; .b { color: @c; } }\n'],
  // several bindings, multiple references
  ['var-multi', '@c: red;\n@d: blue;\n.a { color: @c; background: @d; }\n'],
];

describe('[tree2-native] F1 variables host byte-identity vs bridge', () => {
  for (const [name, src] of inputs) {
    it(name, () => {
      const d = direct(src);
      const b = bridged(src);
      if (d !== b) {
        console.log(`\n--- ${name} ---\nSRC:    ${JSON.stringify(src)}\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      }
      expect(d).toBe(b);
    });
  }
});
