import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst, UnsupportedShape } from './bridge.js';
import { buildNativeEvaluator } from '../../native-evaluator.js';
import { renderRealOracle } from './oracle.js';

/**
 * Rung 8: value operations + function calls, proven BYTE-IDENTICAL against the
 * REAL (function-evaluating) oracle. tree2 owns the Operation/FunctionCall
 * structure and byte emission; the injected value service does the math.
 */
const inputs: Array<[string, string]> = [
  // arithmetic (numbers/dimensions) — evaluate under the real oracle
  ['op-add-px', '.a { width: (1px + 2px); }\n'],
  ['op-mul', '.a { width: (2 * 3px); }\n'],
  // color operations
  ['op-color-sub', '#o { color: (#111111 - #444444); }\n'],
  ['op-color-add', '#o { color: (#eee + #fff); }\n'],
  ['op-color-mul', '#o { color: (#aaa * 3); }\n'],
  // chained / nested operations (precedence carried by the tree shape)
  ['op-chain-color', '#o { color: (#110000 + #000011 + #001100); }\n'],
  ['op-chain-mixed', '#o { height: (10px / 2px + 6px - 1px * 2); }\n'],
  ['op-chain-em', '#o { width: (2 * 4 - 5em); }\n'],
  // color functions
  ['fn-lighten', '.a { color: lighten(blue, 10%); }\n'],
  ['fn-darken', '.a { color: darken(blue, 10%); }\n'],
  ['fn-rgba', '.a { color: rgba(255, 238, 170, 0.1); }\n'],
  ['fn-argb', '.a { color: argb(rgba(255, 238, 170, 0.1)); }\n'],
  ['fn-hsla', '.a { color: hsla(11, 20%, 20%, 0.6); }\n'],
  ['fn-nested-red', '.a { color: red(rgb(100%, 0, 0)); }\n'],
  ['fn-modern-slash', 'foo { color: rgb(0 128 255 / 50%); }\n'],
  ['fn-percentage', '.a { color: rgba(100%, 0, 0, 50%); }\n'],
  ['fn-fade', '.a { color: fade(#ff0000, 50%); }\n'],
  ['fn-mix', '.a { color: mix(#ff0000, #0000ff, 50%); }\n'],
  ['fn-saturate', '.a { color: saturate(#808080, 20%); }\n'],
];

describe('rung 8 — computed value byte-identity (vs REAL oracle)', () => {
  for (const [name, src] of inputs) {
    it(name, async () => {
      const parsed = parseLessFn(src);
      let bridged;
      try {
        bridged = bridgeToAst(parsed.tree, src);
      } catch (e) {
        if (e instanceof UnsupportedShape) throw new Error(`UNSUPPORTED ${e.feature} (${e.detail}) for: ${src.trim()}`);
        throw e;
      }
      const evaluator = buildNativeEvaluator();
      const t2css = (await serialize(bridged, { evaluator })).css;
      const oracle = await renderRealOracle(parseLessFn(src).tree);
      if (t2css !== oracle) {
        console.log(`\n--- ${name} ---\nSRC: ${JSON.stringify(src)}\nT2 : ${JSON.stringify(t2css)}\nORC: ${JSON.stringify(oracle)}`);
      }
      expect(t2css).toBe(oracle);
    });
  }
});
