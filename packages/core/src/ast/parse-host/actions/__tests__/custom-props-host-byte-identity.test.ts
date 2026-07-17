import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../index.js';
import { bridgeToAst } from '../../__tests__/bridge.js';
import { parseToAst } from '../../dispatch-host.js';

/**
 * F2 byte-identity: the custom-property + merge declaration family
 * produces the SAME serialized CSS as the parse→legacy-tree→bridge path (the
 * oracle), driven through `parseToAst`. Covers:
 *   • `--x: <value>` custom properties — value kept VERBATIM (bare `@var`/fns/
 *     inline `!important` literal), only `@{…}` interpolation resolved;
 *   • `prop+:` / `prop+_:` merge declarations — per-member `,`/` ` joiner + any
 *     member's `!important` promoting the folded line (folding happens at
 *     serialize time, so the structured merge marker must match the bridge).
 * Also re-checks plain / important declarations to confirm the `Declaration`
 * override stays a byte-identical superset of the F0 seed.
 */
const g = lessGrammar as Record<string, unknown>;

function astDirect(src: string): Root {
  const { root } = parseToAst(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f2: no root produced');
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToAst(parseLessFn(src).tree, src) as unknown as Root;
}

const inputs: Array<[string, string]> = [
  // ── custom properties: value verbatim ────────────────────────────────────
  ['cp-keyword', '.a { --x: red }\n'],
  ['cp-dimension', '.a { --gap: 10px }\n'],
  ['cp-comma-list', '.a { --list: 1px, 2px, 3px }\n'],
  ['cp-space-list', '.a { --box: 1px solid black }\n'],
  ['cp-bare-var-literal', '.a { --v: @foo }\n'],
  ['cp-function-literal', '.a { --f: calc(1px + 2px) }\n'],
  ['cp-nested-parens', '.a { --g: min(10px, max(1px, 2px)) }\n'],
  ['cp-important-literal', '.a { --w: red !important }\n'],
  ['cp-url', '.a { --u: url(a.png) }\n'],
  ['cp-inner-spacing', '.a { --s:   spaced   out   }\n'],
  ['cp-string', '.a { --q: "hi there" }\n'],
  // ── `@{…}` interpolation construction (unbound refs: both paths fall back to
  //    the literal ref form — resolution itself is gated once the variable
  //    family registers, so this checks the Interp SHAPE is byte-identical). ──
  ['cp-name-interp', '.a { --@{k}: red }\n'],
  ['cp-value-interp', '.a { --n: @{base}px }\n'],
  // ── merge declarations ────────────────────────────────────────────────────
  ['merge-comma-single', '.r { a+: x }\n'],
  ['merge-space-single', '.r { b+_: p }\n'],
  ['merge-comma-multi', '.r {\n  a+: x;\n  a+: y;\n}\n'],
  ['merge-space-multi', '.r {\n  b+_: p;\n  b+_: q;\n}\n'],
  ['merge-important-promote', '.r {\n  c+: m !important;\n  c+: n;\n}\n'],
  ['merge-mixed-props', '.r {\n  a+: x;\n  b+_: p;\n  a+: y;\n  b+_: q;\n}\n'],
  ['merge-with-plain', '.r {\n  color: red;\n  a+: x;\n  a+: y;\n}\n'],
  // ── plain / important declarations (override stays a seed superset) ────────
  ['plain-decl', '.a { color: red }\n'],
  ['plain-two', '.a { color: red; width: 10px }\n'],
  ['plain-important', '.a { color: red !important }\n'],
  ['plain-spaced', '.a { border: 1px solid black }\n'],
];

describe('custom-props + merge host byte-identity vs bridge', () => {
  for (const [name, src] of inputs) {
    it(name, () => {
      // OPTIONAL mode: interpolated custom-prop names/values (`--@{k}`, `@{base}px`)
      // reference intentionally-unbound vars — this gate checks the Interp byte
      // SHAPE is identical across paths, not resolution, so an unbound ref passes
      // through instead of raising a strict eval error.
      const direct = serialize(astDirect(src), { optional: true }).css;
      const bridged = serialize(viaBridge(src), { optional: true }).css;
      if (direct !== bridged) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${name} ---\nSRC:    ${JSON.stringify(src)}\nDIRECT: ${JSON.stringify(direct)}\nBRIDGE: ${JSON.stringify(bridged)}`);
      }
      expect(direct).toBe(bridged);
    });
  }
});
