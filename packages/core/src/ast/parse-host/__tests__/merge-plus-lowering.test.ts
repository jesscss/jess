/**
 * `+:` (comma-merge) / `+_:` (space-merge) declaration merge — ast/ engine.
 *
 * Faithful to less.js `_mergeRules` (to-css-visitor): merge declarations with the
 * same resolved name in ONE block combine into a SINGLE declaration anchored at the
 * FIRST occurrence. `+` starts a new comma group (only when the current space group
 * is non-empty); `+_` space-appends to the current comma group. `!important` on any
 * member promotes the whole combined line.
 */
import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

function render(src: string): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
  if (res.threw) throw res.threw;
  if (res.css === undefined) throw new Error(`no css; parseErrors=${JSON.stringify(res.parseErrors)}`);
  return res.css;
}

const CASES: Array<[name: string, src: string, expected: string]> = [
  [
    'comma-single',
    '.r {\n  transform+: scale(2,4);\n}\n',
    '.r {\n  transform: scale(2, 4);\n}\n',
  ],
  [
    'comma-chained',
    '.r {\n  transform+: rotate(90deg), skew(30deg);\n  transform+: scale(2,4);\n}\n',
    '.r {\n  transform: rotate(90deg), skew(30deg), scale(2, 4);\n}\n',
  ],
  [
    'space-single',
    '.r {\n  transform+_: t1;\n}\n',
    '.r {\n  transform: t1;\n}\n',
  ],
  [
    'space-chained',
    '.r {\n  transform+_: t1;\n  transform+_: t2;\n  transform+_: t3;\n}\n',
    '.r {\n  transform: t1 t2 t3;\n}\n',
  ],
  [
    'important-promote',
    '.r {\n  transform+: rotate(90deg), skew(30deg);\n  transform+: scale(2,4) !important;\n}\n',
    '.r {\n  transform: rotate(90deg), skew(30deg), scale(2, 4) !important;\n}\n',
  ],
  [
    // first occurrence anchors; interleaved names keep first-seen order.
    'interleaved-comma',
    '.r {\n  transform+: t1;\n  background+: b1;\n  transform+: t2;\n  background+: b2, b3;\n  transform+: t3;\n}\n',
    '.r {\n  transform: t1, t2, t3;\n  background: b1, b2, b3;\n}\n',
  ],
  [
    'interleaved-spaced',
    '.r {\n  transform+_: t1;\n  background+_: b1;\n  transform+_: t2;\n  background+_: b2, b3;\n  transform+_: t3;\n}\n',
    '.r {\n  transform: t1 t2 t3;\n  background: b1 b2, b3;\n}\n',
  ],
  [
    // mixed +/+_ — the golden's hardest case.
    'interleaved-with-spaced',
    '.r {\n  transform+_: t1s;\n  transform+: t2;\n  background+: b1;\n  transform+_: t3s;\n  transform+: t4 t5s;\n  background+_: b2s, b3;\n  transform+_: t6s;\n  background+: b4;\n}\n',
    '.r {\n  transform: t1s, t2 t3s, t4 t5s t6s;\n  background: b1 b2s, b3, b4;\n}\n',
  ],
];

describe('+:/+_: merge lowering (ast/) vs less.js _mergeRules', () => {
  for (const [name, src, expected] of CASES) {
    it(name, () => {
      expect(render(src)).toBe(expected);
    });
  }
});
