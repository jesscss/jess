import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../tree2/index.js';
import { bridgeToTree2 } from '../../bridge.js';
import { runFunctionalParseT2 } from '../../dispatch-host.js';

/**
 * [tree2-native] F6 (Operation / Paren) + F7 (FunctionCall) byte-identity.
 *
 * The value-expressions family builds structured `Operation` / `Paren` /
 * `FunctionCall` value nodes directly from the grammar `build` children (no legacy
 * tree, no bridge walk). CLEAN shapes are gated byte-identical against the bridge
 * oracle. Three shapes diverge ON PURPOSE — the bridge is provably buggy and the
 * direct path matches real Less 4.x (verified with less@4.6.3):
 *   • modern `/` in a call: bridge's `flattenSpaceGroup` DROPS the `/`
 *     (`rgb(0 128 255 / 50%)` → `rgb(0 128 255 50%)`); real Less keeps it.
 *   • a space-list call arg: bridge re-slices with a leading-space defect
 *     (`foo(1px solid red)` → `foo(1px  solid red)`); real Less single-spaces.
 * These are gated against the CORRECT golden and asserted to differ from the
 * (buggy) bridge, so the divergence is documented and cannot silently regress.
 */
const g = lessGrammar as Record<string, unknown>;

function tree2Direct(src: string): Root {
  const { root } = runFunctionalParseT2(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('value-expr: no root produced');
  return root;
}

function viaBridge(src: string): Root {
  return bridgeToTree2(parseLessFn(src).tree, src) as unknown as Root;
}

function direct(v: string): string {
  return serialize(tree2Direct(`.a { m: ${v} }\n`)).css;
}
function bridge(v: string): string {
  return serialize(viaBridge(`.a { m: ${v} }\n`)).css;
}

// ── Clean shapes: byte-identical to the bridge ──────────────────────────────
const clean = [
  // top-level arithmetic (bridge keeps these as raw declaration bytes; the direct
  // path likewise leaves a top-level Operation as bytes — both byte-identical)
  '1 + 2', '1+2', '2 * 3 + 4', '10 - 3', '100 / 4', '7 % 3',
  // slash lists (default math: `/` is a list, not division → raw bytes both)
  '12px/1.5', '16px / 1.5', '1fr / 2fr',
  // parenthesised expressions (structured Paren both)
  '(1 + 2)', '(1+2)', '(1 + 2) * 3', '((1 + 2))', '(100% - 10px)',
  // function calls — comma args (structured FunctionCall both)
  'rgb(1, 2, 3)', 'rgb(1,2,3)', 'lighten(#000, 10%)', 'translate(1px, 2px)',
  'min(1px, 2px)', 'foo(bar(1), 2)', 'foo(bar(baz(1)))', 'rgba(0, 0, 0, 0.5)',
  // calc (structured FunctionCall wrapping an Operation)
  'calc(100% - 10px)', 'calc((100% - 10px) / 2)', 'calc(1px + 2px)',
  'calc(100%/3)', 'calc(2 * (1px + 3px))',
  // space-list call arg WITHOUT a slash (bridge modern-flatten == direct spaced)
  'rgb(1 2 3)',
  // F5 regressions: plain leaves + multi-part static value (raw bytes both)
  '10px', 'red', '#fff', '1px solid red', '0 auto', 'url(a.png)', '"hi"',
];

describe('[tree2-native] F6/F7 value-expr host byte-identity vs bridge', () => {
  for (const v of clean) {
    it(v, () => {
      const d = direct(v);
      const b = bridge(v);
      if (d !== b) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${v} ---\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      }
      expect(d).toBe(b);
    });
  }
});

// ── Bridge-bug shapes: direct is CORRECT and diverges from the bridge ────────
describe('[tree2-native] F6/F7 value-expr — documented bridge-bug divergences', () => {
  // Correct goldens = the real Less 4.x spelling (structural, no-eval):
  //   rgb(0 128 255 / 50%)  → rgba(0, 128, 255, 0.5)      (the `/` is the alpha sep)
  //   hsl(200 50% 50% / .5) → hsla(200, 50%, 50%, 0.5)
  //   foo(1px solid red)    → foo(1px solid red)          (unknown-fn passthrough)
  // The no-evaluator serialization keeps the authored spelling, so the structural
  // golden preserves the `/` / single spaces.
  const bugCases: Array<{ v: string; correct: string; buggyBridge: string }> = [
    {
      v: 'rgb(0 128 255 / 50%)',
      correct: '.a {\n  m: rgb(0 128 255 / 50%);\n}\n',
      buggyBridge: '.a {\n  m: rgb(0 128 255 50%);\n}\n',
    },
    {
      v: 'hsl(200 50% 50% / 0.5)',
      correct: '.a {\n  m: hsl(200 50% 50% / 0.5);\n}\n',
      buggyBridge: '.a {\n  m: hsl(200 50% 50% 0.5);\n}\n',
    },
    {
      v: 'foo(1px solid red)',
      correct: '.a {\n  m: foo(1px solid red);\n}\n',
      buggyBridge: '.a {\n  m: foo(1px  solid red);\n}\n',
    },
  ];
  for (const { v, correct, buggyBridge } of bugCases) {
    it(v, () => {
      expect(direct(v)).toBe(correct);
      // The bridge is wrong here — assert the divergence is real & documented.
      expect(bridge(v)).toBe(buggyBridge);
      expect(direct(v)).not.toBe(bridge(v));
    });
  }
});
