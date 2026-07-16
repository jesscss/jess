import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { buildNativeEvaluator } from '../../tree2/native-evaluator.js';
import { bridgeToTree2 } from '../bridge.js';
import { buildEvaluator } from '../value-eval.js';

/**
 * DIFFERENTIAL byte-identity: the NATIVE value path (materialize + operate +
 * kind-dispatch + free serializer, all boundary-clean under `tree2/`) vs the
 * transitional ADAPTER (which delegates to the legacy value nodes + `@jesscss/fns`).
 * The adapter is the ORACLE. Each case renders through the SAME bridged tree2 AST
 * once with each evaluator; the emitted bytes MUST be identical.
 *
 * SCOPE (the foundation covers): arithmetic (dimension ⊕ dimension, unit
 * convert/cancel, unitless), the unit-clash / multiply-units → `calc()` fallback,
 * color hex literals + hex color ops, quoted strings, keywords + keyword-preserve
 * ops, lists, guards (comparison + kind type-predicates), and the 3 CONVERTED fns
 * (`lighten`/`percentage`/`e`) + genuinely-unknown fns (verbatim).
 *
 * SCOPED OUT (needs the ~50 unconverted fns — the NEXT wave): `rgb()`/`hsl()`/
 * `saturate()`/`mix()`/… and named-color operands as color-op inputs (the native
 * materialize keeps bare identifiers as keywords in the foundation; a shared
 * color-name table is a trivial later addition). Bare named-color LITERALS still
 * emit verbatim and are covered below.
 */

async function render(src: string, native: boolean): Promise<string> {
  const tree = parseLessFn(src).tree;
  const evaluator = native ? buildNativeEvaluator() : buildEvaluator();
  const out = await serialize(bridgeToTree2(tree, src), { evaluator });
  return out.css;
}

const CORPUS: Array<[string, string]> = [
  // --- dimensions / arithmetic ---
  ['add-px', '.a { width: 2px + 3px; }\n'],
  ['sub-px', '.a { width: 10px - 4px; }\n'],
  ['mul-num', '.a { width: (3 * 4); }\n'],
  ['div-united', '.a { width: (10px / 2); }\n'],
  ['div-cancel-unit', '.a { width: (8px / 2px); }\n'],
  ['add-unitless', '.a { width: 2px + 3; }\n'],
  ['add-num-px', '.a { width: 3 + 2px; }\n'],
  ['convert-length', '.a { width: (1cm + 5mm); }\n'],
  ['convert-angle', '.a { r: (90deg + 0.25turn); }\n'],
  ['chain', '.a { m: 5 * 2 + 1; }\n'],
  ['decimals', '.a { m: 0.1 + 0.2; }\n'],
  ['negatives', '.a { m: -3px + 1px; }\n'],

  // --- calc fallback (unit clash / multiply units) ---
  ['clash-pct-px', '.a { width: (100% - 10px); }\n'],
  ['mul-two-units', '.a { width: (2px * 3px); }\n'],
  ['div-two-diff', '.a { width: (2px / 3s); }\n'],

  // --- color hex literals + ops ---
  ['hex-literal', '.a { color: #ff0000; }\n'],
  ['hex-short', '.a { color: #abc; }\n'],
  ['hex-alpha', '.a { color: #11223344; }\n'],
  ['named-literal', '.a { color: red; }\n'],
  ['hex-add', '#o { color: (#110000 + #000011); }\n'],
  ['hex-add-chain', '#o { color: (#110000 + #000011 + #001100); }\n'],
  ['hex-mul-num', '#o { color: (#0a0a0a * 2); }\n'],
  ['hex-sub-num', '#o { color: (#101010 - 8); }\n'],
  ['num-plus-hex', '#o { color: (32 + #010101); }\n'],
  ['hex-overflow', '#o { color: (#f0f0f0 + #202020); }\n'],

  // --- quoted / escape ---
  ['quoted-dq', '.a { content: "hello world"; }\n'],
  ['quoted-sq', ".a { content: 'x'; }\n"],
  ['escape-e', '.a { width: ~"calc(100% - 5px)"; }\n'],
  // NOTE: `e("solid")` (quoted → bare string) is intentionally NOT differential:
  // the ADAPTER oracle cannot render it (legacy `e` returns a bare JS string and
  // the adapter's `fromLegacy` calls `.render` on it → throws). Native handles it;
  // covered by the native-direct assertion below.

  // --- keywords + keyword-preserve ops ---
  ['keyword', '.a { display: block; }\n'],
  ['keyword-op-preserve', '.a { m: (solid + 1); }\n'],

  // --- lists ---
  ['list-comma', '.a { font-family: Arial, sans-serif; }\n'],
  ['list-space', '.a { margin: 1px 2px 3px 4px; }\n'],
  ['list-space-op', '.a { margin: (1px + 1px) 2px; }\n'],

  // --- converted fns ---
  ['fn-lighten-hex', '.a { color: lighten(#ff0000, 10%); }\n'],
  ['fn-lighten-relative', '.a { color: lighten(#808080, 10%, relative); }\n'],
  ['fn-percentage', '.a { width: percentage(0.5); }\n'],
  ['fn-percentage-frac', '.a { width: percentage(0.375); }\n'],

  // --- unknown fn (verbatim) ---
  ['unknown-fn', '.a { filter: some-unknown(1px, 2px); }\n'],
  ['unknown-fn-solo', '.a { transform: rotate3d(1, 1, 1); }\n'],

  // --- guards: comparison ---
  ['guard-gt', '.m(@a) when (@a > 5) { x: big; }\n.m(@a) when (@a <= 5) { x: small; }\n.a { .m(10); }\n'],
  ['guard-eq', '.m(@a) when (@a = 3) { y: three; }\n.a { .m(3); }\n'],
  ['guard-lt', '.m(@a) when (@a < 0) { z: neg; }\n.m(@a) when (@a >= 0) { z: pos; }\n.a { .m(2px); }\n'],

  // --- guards: kind type-predicates ---
  ['guard-iscolor', '.m(@x) when (iscolor(@x)) { a: c; }\n.m(@x) when (isnumber(@x)) { a: n; }\n.a { .m(#fff); .m(5); }\n'],
  ['guard-ispixel', '.m(@x) when (ispixel(@x)) { a: px; }\n.a { .m(3px); }\n'],
  ['guard-ispercentage', '.m(@x) when (ispercentage(@x)) { a: pct; }\n.a { .m(50%); }\n'],
  ['guard-isstring', '.m(@x) when (isstring(@x)) { a: s; }\n.a { .m("hi"); }\n'],
];

describe('[tree2] native value path — differential byte-identity vs adapter', () => {
  for (const [name, src] of CORPUS) {
    it(`native ≡ adapter: ${name}`, async () => {
      const nativeCss = await render(src, true);
      const adapterCss = await render(src, false);
      expect(nativeCss).toBe(adapterCss);
    });
  }

  // `e("solid")` → bare `solid`: adapter-unrenderable (see note above), so assert
  // the native intended output directly (quotes stripped, not re-quoted).
  it('native e("solid") strips quotes to a bare keyword', async () => {
    const css = await render('.a { m: e("solid"); }\n', true);
    expect(css).toContain('m: solid');
    expect(css).not.toContain('"solid"');
  });
});
