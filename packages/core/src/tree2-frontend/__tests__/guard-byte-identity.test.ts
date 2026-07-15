import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2, UnsupportedShape } from '../bridge.js';
import { buildValueService } from '../value-service.js';
import { renderRealOracle } from '../oracle.js';

/**
 * Guards + pattern/overloaded mixins + named/default params, proven
 * BYTE-IDENTICAL against the REAL (function-evaluating) oracle.
 *
 * tree2 owns the overload-dispatch STRUCTURE (arity / literal pattern / named /
 * default params) and the guard boolean STRUCTURE (and/or/not/truth/default);
 * it delegates only leaf comparison/function truth to the injected value
 * service (same Less evaluator as the oracle => identity by construction).
 *
 * Census: guards (6) + pattern/named (3).
 */
const inputs: Array<[string, string]> = [
  // --- guards (6) ---
  // 1. comparison guards selecting between overloads
  ['guard-cmp', '.m(@a) when (@a > 0) { s: pos; }\n.m(@a) when (@a < 0) { s: neg; }\n.a { .m(5); }\n.b { .m(-3); }\n'],
  // 2. and / or logic
  ['guard-and-or', '.m(@a) when (@a > 0) and (@a < 10) { r: mid; }\n.m(@a) when (@a = 0), (@a = 100) { r: edge; }\n.a { .m(5); }\n.b { .m(100); }\n'],
  // 3. not negation
  ['guard-not', '.m(@a) when not (@a = 0) { r: nonzero; }\n.a { .m(1); }\n.b { .m(0); }\n'],
  // 4. type-check function guard (iscolor / isnumber)
  ['guard-type-fn', '.m(@a) when (iscolor(@a)) { kind: color; }\n.m(@a) when (isnumber(@a)) { kind: number; }\n.a { .m(red); }\n.b { .m(42); }\n'],
  // 5. truthiness (true / false keyword)
  ['guard-truth', '.m(@a) when (@a) { r: t; }\n.m(@a) when not (@a) { r: f; }\n.a { .m(true); }\n.b { .m(false); }\n'],
  // 6. default() fallback
  ['guard-default', '.m(1) { case: one; }\n.m(2) { case: two; }\n.m(@x) when (default()) { case: other; }\n.a { .m(1); }\n.b { .m(9); }\n'],
  // --- pattern / named (3) ---
  // 7. literal value pattern match
  ['pattern-literal', '.theme(dark) { bg: black; }\n.theme(light) { bg: white; }\n.a { .theme(dark); }\n.b { .theme(light); }\n'],
  // 8. named arguments (order-independent)
  ['named-args', '.box(@w; @h; @c) { width: @w; height: @h; color: @c; }\n.a { .box(@c: red; @w: 1px; @h: 2px); }\n'],
  // 9. default params (omitted args fall back)
  ['default-params', '.pad(@t: 1px; @b: 2px) { top: @t; bottom: @b; }\n.a { .pad(); }\n.b { .pad(9px); }\n'],
];

describe('guards + pattern/named/default mixins — byte-identity (vs REAL oracle)', () => {
  for (const [name, src] of inputs) {
    it(name, async () => {
      const parsed = parseLessFn(src);
      expect(parsed.errors.length, `parse errors: ${JSON.stringify(parsed.errors)}`).toBe(0);
      let bridged;
      try {
        bridged = bridgeToTree2(parsed.tree, src);
      } catch (e) {
        if (e instanceof UnsupportedShape) throw new Error(`UNSUPPORTED ${e.feature} (${e.detail}) for: ${src.trim()}`);
        throw e;
      }
      const service = await buildValueService(bridged);
      const t2css = serialize(bridged, { valueService: service }).css;
      const oracle = await renderRealOracle(parseLessFn(src).tree);
      if (t2css !== oracle) {
        console.log(`\n--- ${name} ---\nSRC:\n${src}\nT2 :\n${t2css}\nORC:\n${oracle}`);
      }
      expect(t2css).toBe(oracle);
    });
  }
});
