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
 * COVERED by the COLOR batch: the Tier-A color group — hsl adjusters
 * (`darken`/`saturate`/`desaturate`/`spin`/`greyscale`), alpha adjusters
 * (`fade`/`fadein`/`fadeout`), mixers (`mix`/`tint`/`shade`), channel getters
 * (`red`/`green`/`blue`/`alpha`), hsl/hsv/luma readers, and `contrast` — plus
 * NAMED-COLOR operands (now materialized to a `Color` via the shared color-name
 * table) and CHAINED hsl ops (hsl source-of-truth carry, the drift guard).
 *
 * COVERED by the Tier-B batch (native ≡ adapter): the color CONSTRUCTORS
 * (`rgb`/`rgba`/`hsl`/`hsla`/`hsv`/`hsva`/`argb`) + `color()` on a color arg — they
 * thread the minimal eval-context seam (modes + a value→string host hook) through
 * `dispatchNative`. The STRING PRODUCERS (`replace`/`%`/`escape`) and `color("…")`
 * string parsing are asserted native = Less 4.x in their own block below (the
 * adapter is provably wrong on quoted args — see that block's header).
 *
 * SCOPED OUT (Tier-C — need file IO / a ruleset value-kind / lazy thunks):
 * `data-uri`, `image-size`/`image-width`/`image-height`, `svg-gradient`,
 * `isruleset`/`isdefined`/`iif`.
 */

async function render(src: string, native: boolean): Promise<string> {
  const tree = parseLessFn(src).tree;
  const evaluator = native ? buildNativeEvaluator() : buildEvaluator();
  const out = await serialize(bridgeToTree2(tree, src), { evaluator });
  return out.css;
}

const CORPUS: Array<[string, string]> = [
  // --- un-operated dimensions: SOURCE-VERBATIM (owner 2026-07-16, spec §0
  //     RESOLVED). Non-canonical source stays verbatim; both native and adapter
  //     emit the Word verbatim (never materialized), so they agree. ---
  ['verbatim-trailing-zero', '.a { width: 1.0px; }\n'],
  ['verbatim-upper-unit', '.a { width: 2PX; }\n'],
  ['verbatim-sci', '.a { width: 1e3px; }\n'],
  ['verbatim-leading-dot', '.a { width: .5em; }\n'],

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

  // --- converted MATH group (Tier-A) — rounding / sign / roots / powers ---
  ['fn-round-int', '.a { m: round(2.5); }\n'],
  ['fn-round-unit', '.a { m: round(2.4px); }\n'],
  ['fn-round-precision', '.a { m: round(3.14159, 2); }\n'],
  ['fn-round-neg', '.a { m: round(-1.5); }\n'],
  ['fn-ceil-unit', '.a { m: ceil(2.1px); }\n'],
  ['fn-ceil-num', '.a { m: ceil(4.001); }\n'],
  ['fn-floor-unit', '.a { m: floor(2.9px); }\n'],
  ['fn-floor-num', '.a { m: floor(4.999); }\n'],
  ['fn-abs-neg', '.a { m: abs(-5px); }\n'],
  ['fn-abs-pos', '.a { m: abs(7); }\n'],
  ['fn-sqrt-num', '.a { m: sqrt(9); }\n'],
  ['fn-sqrt-unit', '.a { m: sqrt(16px); }\n'],
  ['fn-pow-num', '.a { m: pow(2, 3); }\n'],
  ['fn-pow-unit', '.a { m: pow(3px, 2); }\n'],
  ['fn-mod-num', '.a { m: mod(7, 3); }\n'],
  ['fn-mod-unit', '.a { m: mod(10px, 3); }\n'],

  // --- constants / percentage / unit ---
  ['fn-pi', '.a { m: pi(); }\n'],
  ['fn-unit-set', '.a { m: unit(5, px); }\n'],
  ['fn-unit-strip', '.a { m: unit(5px); }\n'],
  ['fn-unit-replace', '.a { m: unit(3px, em); }\n'],
  ['fn-convert-length', '.a { m: convert(1cm, mm); }\n'],
  ['fn-convert-angle', '.a { m: convert(90deg, rad); }\n'],
  ['fn-convert-same', '.a { m: convert(5px, px); }\n'],
  ['fn-convert-incompat', '.a { m: convert(5px, s); }\n'],

  // --- trigonometry (deg/grad/turn → rad normalization) ---
  ['fn-sin-deg', '.a { m: sin(90deg); }\n'],
  ['fn-sin-num', '.a { m: sin(1); }\n'],
  ['fn-cos-deg', '.a { m: cos(0deg); }\n'],
  ['fn-cos-grad', '.a { m: cos(100grad); }\n'],
  ['fn-tan-deg', '.a { m: tan(45deg); }\n'],
  ['fn-tan-turn', '.a { m: tan(0.125turn); }\n'],
  ['fn-asin', '.a { m: asin(1); }\n'],
  ['fn-acos', '.a { m: acos(0.5); }\n'],
  ['fn-atan', '.a { m: atan(1); }\n'],

  // --- converted LIST group (Tier-A) — `range` constructs its own list, no ctx. ---
  ['fn-range-count', '.a { m: range(3); }\n'],
  ['fn-range-start-end', '.a { m: range(2, 5); }\n'],
  ['fn-range-step', '.a { m: range(1, 10, 3); }\n'],
  ['fn-range-unit', '.a { m: range(1px, 3px); }\n'],
  ['fn-range-neg-step', '.a { m: range(1, 5, 2); }\n'],

  // --- converted min / max (Tier-A, variadic) — CASES WHERE THE ADAPTER AGREES.
  //     `min`/`max` are genuinely variadic, so the adapter evaluates these
  //     compatible-unit inputs correctly (native ≡ adapter ≡ Less 4.x). The
  //     multi-INCOMPATIBLE-unit + list-arg cases (where the adapter's `@jesscss/fns`
  //     port DIVERGES from Less 4.x) are asserted directly below, not here. ---
  ['fn-min-nums', '.a { m: min(3, 1, 2); }\n'],
  ['fn-max-px', '.a { m: max(3px, 1px, 2px); }\n'],
  ['fn-min-incompat-pair', '.a { m: min(5px, 3em); }\n'], // both leave `min(5px, 3em)` verbatim
  ['fn-min-length-convert', '.a { m: min(1cm, 5mm); }\n'],
  ['fn-min-pct', '.a { m: min(2%, 1%); }\n'],
  ['fn-min-single', '.a { m: min(3); }\n'],
  ['fn-max-count', '.a { m: max(1, 2, 3, 4, 5); }\n'],
  ['fn-min-unitless-mix', '.a { m: min(1, 2px, 3); }\n'],

  // --- converted COLOR group (Tier-A) — hsl adjusters (hex + named operands) ---
  ['fn-darken-hex', '.a { color: darken(#ff0000, 10%); }\n'],
  ['fn-darken-named', '.a { color: darken(red, 10%); }\n'],
  ['fn-darken-relative', '.a { color: darken(#808080, 10%, relative); }\n'],
  ['fn-saturate-hex', '.a { color: saturate(#80a0c0, 20%); }\n'],
  ['fn-saturate-named', '.a { color: saturate(cornflowerblue, 20%); }\n'],
  ['fn-desaturate-hex', '.a { color: desaturate(#80a0c0, 20%); }\n'],
  ['fn-desaturate-named', '.a { color: desaturate(tomato, 30%); }\n'],
  ['fn-spin-pos', '.a { color: spin(#ff0000, 30); }\n'],
  ['fn-spin-neg', '.a { color: spin(#ff0000, -30); }\n'],
  ['fn-spin-named', '.a { color: spin(green, 90); }\n'],
  ['fn-greyscale-hex', '.a { color: greyscale(#80a0c0); }\n'],
  ['fn-greyscale-named', '.a { color: greyscale(orange); }\n'],

  // --- alpha adjusters (hex-format preserve + rgb output) ---
  ['fn-fade-hex', '.a { color: fade(#ff0000, 50%); }\n'],
  ['fn-fade-named', '.a { color: fade(blue, 25%); }\n'],
  ['fn-fadein-hex', '.a { color: fadein(#ff000033, 30%); }\n'],
  ['fn-fadeout-hex', '.a { color: fadeout(#ff0000, 40%); }\n'],
  ['fn-fadeout-named', '.a { color: fadeout(green, 10%); }\n'],

  // --- mixers ---
  ['fn-mix-default', '.a { color: mix(#ff0000, #0000ff); }\n'],
  ['fn-mix-weight', '.a { color: mix(#ff0000, #0000ff, 25%); }\n'],
  ['fn-mix-named', '.a { color: mix(red, white, 40%); }\n'],
  ['fn-tint-hex', '.a { color: tint(#ff0000, 30%); }\n'],
  ['fn-tint-named', '.a { color: tint(navy, 50%); }\n'],
  ['fn-shade-hex', '.a { color: shade(#ff0000, 30%); }\n'],
  ['fn-shade-named', '.a { color: shade(orange, 50%); }\n'],

  // --- channel getters ---
  ['fn-red-hex', '.a { m: red(#123456); }\n'],
  ['fn-red-named', '.a { m: red(red); }\n'],
  ['fn-green-hex', '.a { m: green(#123456); }\n'],
  ['fn-blue-hex', '.a { m: blue(#123456); }\n'],
  ['fn-alpha-hex', '.a { m: alpha(#00000066); }\n'],
  ['fn-alpha-named', '.a { m: alpha(transparent); }\n'],

  // --- hsl / hsv / luma readers ---
  ['fn-hue-hex', '.a { m: hue(#80a0c0); }\n'],
  ['fn-hue-named', '.a { m: hue(cornflowerblue); }\n'],
  ['fn-saturation-hex', '.a { m: saturation(#80a0c0); }\n'],
  ['fn-lightness-hex', '.a { m: lightness(#80a0c0); }\n'],
  ['fn-luma-hex', '.a { m: luma(#ffffff); }\n'],
  ['fn-luma-named', '.a { m: luma(red); }\n'],
  ['fn-luminance-hex', '.a { m: luminance(#808080); }\n'],
  ['fn-hsvhue-hex', '.a { m: hsvhue(#80a0c0); }\n'],
  ['fn-hsvsaturation-hex', '.a { m: hsvsaturation(#80a0c0); }\n'],
  ['fn-hsvvalue-hex', '.a { m: hsvvalue(#80a0c0); }\n'],

  // --- contrast (luma-threshold pick) ---
  ['fn-contrast-light', '.a { color: contrast(#ffffff); }\n'],
  ['fn-contrast-dark', '.a { color: contrast(#000000); }\n'],
  ['fn-contrast-custom', '.a { color: contrast(#333333, #111111, #eeeeee); }\n'],
  ['fn-contrast-threshold', '.a { color: contrast(#777777, black, white, 30%); }\n'],
  ['fn-contrast-named', '.a { color: contrast(darkslategray); }\n'],

  // --- CHAINED hsl ops (hsl source-of-truth carry; drift guard) ---
  ['fn-chain-lighten-desaturate', '.a { color: lighten(desaturate(#3498db, 20%), 10%); }\n'],
  ['fn-chain-darken-saturate', '.a { color: darken(saturate(#3498db, 20%), 10%); }\n'],
  ['fn-chain-spin-lighten', '.a { color: spin(lighten(#ff0000, 10%), 45); }\n'],
  ['fn-chain-greyscale-named', '.a { color: lighten(greyscale(tomato), 5%); }\n'],
  ['fn-chain-hue-of-spin', '.a { m: hue(spin(#ff0000, 40)); }\n'],

  // --- converted COLOR CONSTRUCTORS (Tier-B) — native ≡ adapter (v5 preserves the
  //     `rgb()`/`hsl()` output FORMAT rather than collapsing to hex like Less 4.x;
  //     that hex-vs-format divergence is the INTENDED v5 behavior the adapter also
  //     produces, so the differential holds native ≡ adapter here). ---
  ['fn-rgb-ints', '.a { color: rgb(255, 0, 0); }\n'],
  ['fn-rgb-modern', '.a { color: rgb(255 0 0); }\n'],
  ['fn-rgb-modern-alpha', '.a { color: rgb(255 0 0 / 0.5); }\n'], // modern `rgb( / )` syntax
  ['fn-rgba-ints', '.a { color: rgba(255, 0, 0, 0.5); }\n'],
  ['fn-rgb-from-color', '.a { color: rgb(#ff0000); }\n'],
  ['fn-rgb-from-named', '.a { color: rgb(red); }\n'], // named-color arg (4x → #ff0000)
  ['fn-rgba-from-color-alpha', '.a { color: rgba(#123456, 0.4); }\n'],
  ['fn-hsl', '.a { color: hsl(120, 50%, 50%); }\n'],
  ['fn-hsla', '.a { color: hsla(120, 50%, 50%, 0.5); }\n'],
  // FLAG: the GREY canonical branch — native ≡ adapter emit `hsl(0, 0%, 50.19607843%)`
  // (rounds 127.5→128 then recomputes hsl). Less 4.x emits `hsl(0, 0%, 50%)`; the
  // native path matches the v5 adapter (owner may want to reconcile the fns impl).
  ['fn-hsl-grey-canonical', '.a { color: hsl(120, 0%, 50%); }\n'],
  ['fn-hsl-from-color', '.a { color: hsl(#80a0c0); }\n'],
  ['fn-hsla-from-color-alpha', '.a { color: hsla(#80a0c0, 0.5); }\n'],
  ['fn-hsv-hex', '.a { color: hsv(90, 100%, 50%); }\n'], // hsv → HEX format
  ['fn-hsva-rgb', '.a { color: hsva(90, 100%, 50%, 0.5); }\n'],
  ['fn-argb', '.a { color: argb(rgba(90, 23, 148, 0.5)); }\n'],
  ['fn-color-named-arg', '.a { color: color(red); }\n'], // Color naming a CSS color → hex
  ['fn-color-hex-arg', '.a { color: color(#abc); }\n'], // verbatim hex passes through

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

  // Owner 2026-07-16 (VALUE-LITERAL-TAG-SPEC §0 RESOLVED): un-operated values are
  // SOURCE-VERBATIM; only COMPUTED values canonicalize. Confirm both sides.
  it('un-operated dimension emits source-verbatim (not canonicalized)', async () => {
    for (const [src, want] of [
      ['.a { width: 1.0px; }\n', 'width: 1.0px'],
      ['.a { width: 2PX; }\n', 'width: 2PX'],
      ['.a { width: 1e3px; }\n', 'width: 1e3px'],
    ] as const) {
      const css = await render(src, true);
      expect(css).toContain(want); // verbatim, NOT 1px / 2px / 1000px
    }
  });

  it('COMPUTED dimension canonicalizes via the number formatter', async () => {
    // 1.0px + 2.0px → operated → canonical 3px (not 3.0px).
    const css = await render('.a { width: (1.0px + 2.0px); }\n', true);
    expect(css).toContain('width: 3px');
  });
});

/**
 * LIST / VARIADIC fns (`length`/`extract`/`min`/`max`) — the adapter is PROVABLY
 * WRONG here, so real Less 4.6.7 is the oracle (not the adapter). The value layer
 * flattens a list literal to bare `Word` bytes before a fn arg materializes, so
 * the adapter's `coerceListItems` sees a single node (`length(@l)` = 1, not 3) or
 * the legacy fn rejects the arity; the native path recovers the list structure at
 * consumption time (`native/list-helper.ts`) and matches Less 4.x. Each case below
 * notes what the (buggy) adapter does, so the divergence is explicit and audited.
 */
describe('[tree2] native list / variadic fns — vs Less 4.6.7 (adapter diverges)', () => {
  // want = the exact Less 4.6.7 output (verified against a local less-node build).
  const LESS4X: Array<[string, string, string]> = [
    // length — adapter returns 1 for every variable-held list (flattened to a Word)
    // and THROWS on a multi-arg call ("No matching function signature for 3 args").
    ['length-space-literal', '.a { m: length(a b c); }\n', 'm: 3'], // adapter: THROWS
    // NOTE (FLAG): Less 4.x `length(a, b, c)` = 1 — commas are ARGUMENT delimiters,
    // so length only sees its first arg `a`. (The batch brief's illustrative "=3"
    // is not what Less 4.x does; matched to the measured oracle. A comma list bound
    // to a VARIABLE is a real list → 3, asserted next.) adapter: THROWS.
    ['length-comma-literal', '.a { m: length(a, b, c); }\n', 'm: 1'],
    ['length-var-space', '@l: a b c;\n.a { m: length(@l); }\n', 'm: 3'], // adapter: 1
    ['length-var-comma', '@l: a, b, c;\n.a { m: length(@l); }\n', 'm: 3'], // adapter: 1
    ['length-single', '.a { m: length(a); }\n', 'm: 1'], // adapter also 1 (agrees)
    ['length-dims', '.a { m: length(1px 2px); }\n', 'm: 2'], // adapter: THROWS

    // extract — adapter THROWS / returns out-of-range (sees a 1-element list).
    ['extract-var', '@l: a b c;\n.a { m: extract(@l, 2); }\n', 'm: b'], // adapter: THROWS
    ['extract-dims', '.a { m: extract(1px 2px 3px, 3); }\n', 'm: 3px'], // adapter: THROWS
    ['extract-out-of-range', '@l: a b c;\n.a { m: extract(@l, 4); }\n', 'm: extract(a b c, 4)'],
    ['extract-bad-arity', '.a { m: extract(a, b, c); }\n', 'm: extract(a, b, c)'],

    // min / max — the adapter (`@jesscss/fns` port) added a `loose`-mode branch that
    // Less 4.x does NOT have: Less THROWS (→ verbatim) on ANY incompatible-unit
    // pairing. So native (correct) diverges from the adapter here.
    ['min-multi-incompat', '.a { m: min(2em, 3px, 1em); }\n', 'm: min(2em, 3px, 1em)'], // adapter: min(1em, 3px)
    ['min-pct-px', '.a { m: min(50%, 40px, 30%); }\n', 'm: min(50%, 40px, 30%)'], // adapter: min(30%, 40px)
    ['min-var-list', '@l: 1px 5px 3px;\n.a { m: min(@l); }\n', 'm: 1px'], // adapter: THROWS
    ['min-space-arg', '.a { m: min(1px 2px, 3px); }\n', 'm: 1px'], // adapter: THROWS
  ];

  for (const [name, src, want] of LESS4X) {
    it(`native = Less 4.x: ${name}`, async () => {
      const css = await render(src, true);
      expect(css).toContain(want);
    });
  }
});

/**
 * STRING PRODUCERS + quoted `color()` (`replace`/`%`/`escape`/`color("…")`) — the
 * `@jesscss/fns` ADAPTER is PROVABLY WRONG here, so real Less 4.6.7 is the oracle.
 * The adapter reconstructs a legacy `Quoted` whose class identity differs across
 * the built-vs-source module boundary, so `serializeNodeValue`'s `instanceof Quoted`
 * misses → it renders WITH quotes (doubling / URL-encoding them), throws on a
 * quoted-`RegExp`-flag arg, and its `color()` rejects every quoted string. The
 * native path serializes through the injected `ctx.stringify` hook (a Quoted's
 * inner text) and matches Less 4.x. Each case notes the adapter's wrong output.
 *
 * NOTE: a `%("literal", …)` template is LOWERED to interpolation by the less-parser
 * (it never reaches the fn), so `%`'s fn body is exercised via a VARIABLE template
 * (`@t: "%d"; %(@t, …)`), the shape that actually dispatches.
 */
describe('[tree2] native string producers — vs Less 4.6.7 (adapter diverges)', () => {
  const LESS4X: Array<[string, string, string]> = [
    // color("…") — adapter THROWS on every quoted arg (see note); native parses it.
    ['color-named-string', '.a { m: color("red"); }\n', 'm: #ff0000'], // adapter: THROWS
    ['color-mixedcase-named', '.a { m: color("BlueViolet"); }\n', 'm: #8a2be2'], // adapter: THROWS
    ['color-hex3-string', '.a { m: color("#fff"); }\n', 'm: #fff'], // adapter: THROWS
    ['color-hex4-string', '.a { m: color("#abcd"); }\n', 'm: #abcd'], // adapter: THROWS

    // replace — adapter doubles the quotes / drops the match; throws on a flag arg.
    ['replace-quoted-escaped-pat', '.a { m: replace("Hello, Mars?", "Mars\\?", "Earth!"); }\n', 'm: "Hello, Earth!"'], // adapter: ""Hello, Mars?""
    ['replace-escaped-input-bare', '.a { m: replace(~"Hello", "H", "J"); }\n', 'm: Jello'], // adapter: Hello
    ['replace-global-flag', '.a { m: replace("hello", "l", "L", "g"); }\n', 'm: "heLLo"'], // adapter: THROWS
    ['replace-var-pattern', '@p: "l";\n.a { m: replace("hello", @p, "L"); }\n', 'm: "heLlo"'], // adapter: ""hello""

    // % / format — via a VARIABLE template (literal templates are parser-lowered).
    // adapter re-quotes the template (`""5 apples""`) or throws.
    ['format-d-number', '@t: "%d apples";\n.a { m: %(@t, 5); }\n', 'm: "5 apples"'], // adapter: ""5 apples""
    ['format-s-string', '@t: "val %s";\n.a { m: %(@t, "x"); }\n', 'm: "val x"'], // adapter: ""val "x"""
    ['format-d-quoted-keeps-quotes', '@t: "%d";\n.a { m: %(@t, "hi"); }\n', 'm: ""hi""'], // %d = CSS form
    ['format-leftover-token', '@t: "%s %s";\n.a { m: %(@t, "a"); }\n', 'm: "a %s"'],
    ['format-double-percent', '@t: "100%% x %s";\n.a { m: %(@t, "y"); }\n', 'm: "100% x y"'],

    // escape — adapter encodes the surrounding quotes too (`%22…%22`).
    ['escape-eq', '.a { m: escape("a=1"); }\n', 'm: a%3D1'], // adapter: %22a%3D1%22
    ['escape-space-amp', '.a { m: escape("a b&c"); }\n', 'm: a%20b&c'], // adapter: %22a%20b&c%22
  ];

  for (const [name, src, want] of LESS4X) {
    it(`native = Less 4.x: ${name}`, async () => {
      const css = await render(src, true);
      expect(css).toContain(want);
    });
  }
});
