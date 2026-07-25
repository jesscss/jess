# Numeric precision policy

Status: design review. **Nothing in this document has been landed.** The current
behaviour (8 decimal places at `serializeDimension`) is unchanged on `dev`.

Scope: how jess turns a computed `number` into the digits it writes into a
stylesheet. Not in scope: the user-facing `round()` / `ceil()` / `floor()`
functions, which are language semantics, not output formatting.

---

## 1. The two jobs

The single "rounding policy" is really two jobs that today's `round(n, 8)` does
at once, and does badly at both.

**Job 1 — noise removal.** `0.1 + 0.2` is `0.30000000000000004`. Nobody authored
those digits; they are the residue of binary floating point. Removing them is
about *representing the computed value faithfully*, and the principled form is
not rounding at all — it is finding the shortest decimal that lies within the
floating-point uncertainty of the value.

**Job 2 — a compactness cap.** An honest product decision about output bytes.
`100% / 3` is `33.333333333333336`; every one of those digits is earned, so job 1
cannot shorten it much. Only a cap can.

They must stay separate because **noise removal does not bound output length**,
and a cap does not distinguish noise from signal. Conflating them is what makes
today's behaviour incoherent.

### Verified: `String(n)` alone does not do job 1

Claim checked, not assumed. JavaScript's number-to-string is shortest-round-trip
(Steele–White / Ryū class): `Number(String(n)) === n` for every finite double.
Measured over 2,000,000 random doubles plus the case set below: zero
counterexamples.

That is *precisely why* it cannot do job 1. `0.1 + 0.2` really is a different
double from `0.3` (they differ by exactly 1 ULP — verified: `(0.1+0.2) === 0.3`
is `false`). `"0.30000000000000004"` is the shortest string that round-trips to
*that* double, so shortest-round-trip is obligated to print it. What job 1 needs
is the **tolerance-aware** variant, which JS does not expose.

---

## 2. What the specs actually say

The owner's framing asked whether a spec floor exists that would replace the
rendering analysis. **It does — but not where he expected it, and it is a floor
on colors, not on lengths.** Three corrections follow in §5.

### A. There is no minimum precision requirement for CSS numbers generally

CSS Values and Units 4 §5:

> "The precision and supported range of numeric values in CSS is
> implementation-defined, and can vary based on the property or other context a
> value is used in. However, within the CSS specifications, infinite precision
> and range is assumed. When a value cannot be explicitly supported due to
> range/precision limitations, it must be converted to the closest value
> supported by the implementation, but how the implementation defines 'closest'
> is implementation-defined as well."

CSS Values and Units 4 §5.1 and Values 3 §4.1 carry the same advisory sentence:

> "CSS theoretically supports infinite precision and infinite ranges for all
> value types; however in reality implementations have finite capacity. UAs
> should support reasonably useful ranges and precisions."

Level 4's own change log lists, under *Additions Since Level 3*:

> "Explicitly undefined numeric precision/range."

CSS Values 4 §6 (Distance Units) confirms the same for lengths specifically:

> "While the exact supported precision of numeric values, and how they are
> rounded to match that precision, is generally implementation-defined,
> `<length>`s in `border-width` and a few other properties are rounded in a
> specific fashion to ensure reasonable visual display."

So: **no floor for lengths, angles, or bare numbers.** The only mandated
numeric rounding in Values 4 is a direction, §5.2.1:

> "Unless otherwise specified, in the CSS specifications rounding to the nearest
> integer requires rounding in the direction of +∞ when the fractional portion
> is exactly 0.5."

### B. Serialization *is* constrained — in two places, in two different units

**CSSOM §6.7.2, `<number>`:**

> "A base-ten number using digits 0-9 (U+0030 to U+0039) in the shortest form
> possible, using '.' to separate decimals (if any), rounding the value if
> necessary to not produce more than 6 decimals, preceded by '-' (U+002D) if it
> is negative."
>
> "Note: scientific notation is not used."

`<length>` and `<percentage>` are defined by reference to `<number>`, so this
reaches them. Two things to notice: the cap is **6 decimal places**, not
significant figures — CSSOM commits to the same magnitude-dependent axis we are
arguing against — and "shortest form possible" is the job-1 instinct, stated
normatively, without a tolerance rule to make it work.

That gap is a live spec issue, quoted in CSS Values 4 alongside `round()`:

> "CSSOM needs to specify how it rounds, and it's probably good for CSS
> functions to round the same way by default. What behavior should be used?
> [Issue #5689]"

**CSS Color 4 §16** — which states it "updates and replaces that part of CSS
Object Model, section Serializing CSS Values, which relates to serializing
`<color>` values" — is where an actual precision *floor* lives, and it is stated
in significant figures:

> "Note: contrary to CSS Color 3, the parameters of the `rgb()` function are of
> type `<number>`, not `<integer>`. Thus, any higher precision than eight bits
> is indicated with a fractional part.
>
> The precision with which sRGB component values are retained, and thus the
> number of significant figures in the serialized value, is not defined in this
> specification, but must at least be sufficient to round-trip eight bit values.
> Values must be rounded towards +∞, not truncated."

For modern alpha (§16.1.2):

> "For modern color syntax, the precision with which `<alpha-value>`s are
> retained, and thus the number of decimal places in the serialized value, is
> required to be sufficient to round-trip 16-bit decimal values. The serialized
> value must contain six decimal places (unless trailing zeroes have been
> removed). Values must be rounded towards +∞, not truncated."

For legacy alpha (§16.1.1): at least two decimal places, "no more than 6
figures, trailing zeroes omitted".

And §4.1.1 / §4.1.2 on the two color syntaxes:

> "minimum required precision when serializing is defined, and may be greater
> than 8 bits per component" (modern)
>
> "minimum required precision is lower, 8 bits per component" (legacy)

`color()` has a per-space table of minimum round-trip bits: srgb 10,
srgb-linear 12, display-p3 10, display-p3-linear 12, a98-rgb 10, prophoto-rgb
12, rec2020 12, xyz/xyz-d50/xyz-d65 16.

The strictest of these is 16 bits ≈ 4.8 decimal digits ≈ **6 significant
figures**, plus modern alpha's 6 decimal places. **8 significant figures clears
every stated spec floor with room to spare.** That is a real result: the cap is
now bounded from below by spec, not only by rendering intuition.

### C. The rendering floor, checked

- **sRGB 8-bit quantization** — confirmed, and better than confirmed: it is
  normative. Color 4 §4.1.2 fixes legacy `rgb()` at "8 bits per component", and
  §16.2.2 requires enough figures to round-trip 8-bit values. But §5.1 also
  says the ceiling is *not* 8 bits: "Implementations should honor the precision
  of the component as authored or calculated wherever possible. If this is not
  possible, the component should be rounded towards +∞." Wide-gamut `color()`
  spaces need 10–16 bits. So "sRGB quantizes at 1/255, therefore colors need
  little precision" is the wrong conclusion — the spec floor for `color(xyz …)`
  is ~5 significant figures, not ~3.
- **Subpixel granularity ~1/64 px** — supported for WebKit/Blink specifically.
  WebKit's `LayoutUnit` represents lengths as multiples of 1/64 of a logical
  pixel, fixed-point, chosen in 2012 (replacing a 1/60 scheme borrowed from
  Mozilla) to avoid precision loss converting to and from float `Length`s.
  Values are pixel-snapped at paint time. I did **not** verify Gecko's current
  `AppUnits` granularity (historically 1/60 px) and I did not verify anything
  about non-browser consumers, so treat "engines use ~1/64 px" as true of
  WebKit-lineage engines and plausible elsewhere.
- **`color-mix()` / relative color syntax re-computation** — I could find **no**
  text in CSS Color 5 imposing a higher precision requirement on stored or
  serialized components for `color-mix()` (§3.3) or relative color syntax (§4.2,
  §11) than Color 4 already imposes. This is a negative result from reading the
  spec, not a proof: these features re-compute *in the browser* from whatever
  digits we emit, so error can compound across a chain in a way no spec section
  needs to mention. I am not able to bound that from spec text, and I did not
  measure it.
- **Unitless multipliers as the widest-amplification case** — this is the one
  claim in the original reasoning I can neither confirm nor refute from spec or
  measurement. `scale(1.0000001)` on a 1000px box is a 0.0001px difference,
  which is below the 1/64px floor, so the "needs ~8 figures" intuition is not
  obviously right; but `scale()` composes through transform chains and its
  operand is dimensionless, so magnitude-invariance genuinely matters more here
  than for lengths. **Unverified.**

---

## 3. Where jess applies numeric precision today

Twelve sites spell `round(x, 8)` inline. There is no `precision` config knob
anywhere; `strictUnits` is the only numeric-adjacent option.

**The rounding kernel, duplicated.** `packages/core/src/ast/round.ts` is
byte-identical to `packages/core/src/tree/util/round.ts` (its own docblock says
so — deliberately inlined to keep the value-domain boundary clean). Both are
lodash's exponential-shift algorithm: two `` `${n}e`.split('e') `` string
round-trips, with a `Number.isInteger` fast path.

**Value domain (`ast/`).**

| Site | What it does |
|---|---|
| `ast/serialize-value.ts:15-21` `serializeDimension` | `` `${round(number, 8)}` `` + `NaN`/`infinity`/`-infinity` spelling. Reached from `makeDimension`/`makeCompoundDimension` (`ast/value-factory.ts:57,78`), so rounding happens at **value construction**, not at emit. |
| `ast/serialize-value.ts:34-40` `emitValueInterp` | **Bypasses the policy entirely** — see §4. |
| `ast/literal-tag.ts:104-114` `dimensionFromFields` | The only *source-literal* site that rewrites bytes. Two fused behaviours: denoise when the literal can't survive the 8dp floor, and leading-dot normalization (`.3s` → `0.3s`). The second is a spelling rule, not a precision rule, and should not be entangled with the first. |
| `ast/color.ts:95,103` | Integer channel quantization: `clamp(round(r), 255)`, `round(alpha * 255)`. |
| `ast/color.ts:118,137,149-151` | 8dp for `%` alpha, `%` channels, hue, s/l. Line 118's `else` branch emits a **decimal alpha completely unrounded** (`${a}`) — a second, unintentional bypass, safe today only because `fns/src/builtins/color-helper.ts:46` pre-rounds. |

**Legacy tree (still live).** `tree/dimension.ts:317-325`, `tree/negative.ts:50`
and `:121`, `tree/range.ts:59`, and the color mirror at `tree/color.ts:261,279,
298-300,524,607,616-623`. Note the legacy sites append `.toLowerCase()` (which
normalizes `1E5` → `1e5`) and `serializeDimension` does not — a live divergence
between the two serializers.

**Compress mode** touches numbers not at all. It affects only colors, only in
the legacy tree: alpha `0` shortening (`tree/color.ts:250-253`), dropping `deg`
when hue is 0 (`:608-611`), and forcing modern color syntax (`:589,613`).
`ast/color.ts` has no compress parameter, so the new serializer cannot currently
reproduce any of them.

**`packages/fns/**` (read-only, another agent's area).** `round()`/`ceil()`/
`floor()` are language semantics with user-supplied precision defaulting to 0 —
these must stay outside any output policy. Two things there are output-affecting
and do belong in the accounting: `builtins/color-helper.ts:46` (`round(a, 8)`,
explicitly to stop `0.7000000000000001`) and `less/fadein.ts:30`, which uses
`Math.round(a * 1e12) / 1e12` — **a twelfth decimal place, an orphaned constant
inconsistent with the 8 used everywhere else.**

**Out of band.** `packages/language-service/src/color-utils.ts` builds
`rgb()`/`hsl()`/`hwb()`/`lab()` strings with bare `Math.round` and inserts them
into the user's document from the color picker. That is CSS output produced by a
code path that never touches `round.ts`.

### Can one policy cover all of it?

Partly. Four groups, three of which unify:

1. **The display floor** — all twelve `round(x, 8)` sites are literally the same
   policy and collapse to one function. Two wrinkles it must absorb: the
   legacy/`ast` `.toLowerCase()` divergence, and the non-finite spelling.
2. **Integer channel quantization** — `clamp(round(r), 255)` and
   `round(alpha * 255)` are quantization to a 0-255 byte grid, a different axis.
   Shared helper, not shared policy. *And note §2C: Color 4 says these should
   not be integers at all where higher precision was authored or calculated.*
3. **User-facing `round`/`ceil`/`floor`** — must never be routed through an
   output policy.
4. **The bypasses** — `emitValueInterp`, `ast/color.ts:118`'s unrounded alpha,
   `argb`'s verbatim node, `svg-gradient`'s data-URI channels.

---

## 4. `emitValueInterp` — the bypass has to die

`ast/serialize-value.ts:34-40` emits `` `${v.number}${v.unit}` `` — raw double —
for interpolation splices. It is documented as intentional in
`packages/docs-content/docs/less/advanced/number-precision.md`, justified as
less.js parity: less.js serializes interpolations at eval time where the context
carries no `numPrecision`.

The result is that one value prints two ways in one stylesheet:

```less
@n: pi();
.a { width: @n * 1px; --raw: ~"@{n}"; }
```
```css
.a { width: 3.14159265px; --raw: 3.141592653589793; }
```

Under **either** job this is indefensible. Under job 1 it is a bug outright:
`3.141592653589793` is the full double, so the interpolation path emits noise
the declaration path removes. Under job 2 it is an unannounced escape from a cap
that exists for byte reasons. And the stated justification is exactly the one
the owner rejected — a less.js implementation accident, not a CSS argument.

Note the guard `v.bytes === serializeDimension(v)` already restricts the bypass
to machine-serialized dimensions, so verbatim source literals are unaffected.
Removing the bypass therefore does not endanger verbatim pass-through.

Under the recommendation in §6, job 1 makes the divergence mostly vanish on its
own: both paths would emit `3.1415926535898`.

---

## 5. Where the original reasoning was wrong

1. **"CSS Values and Units may state a minimum required precision."** It does
   not, and Level 4 went out of its way to say so — "Explicitly undefined
   numeric precision/range" is listed as a change *from* Level 3. The floor that
   does exist is in **CSS Color 4**, applies to color components only, and is
   stated in significant figures and bits, not decimal places.

2. **"Nothing outside Color 4 §16.2.2 constrains serialization precision."**
   CSSOM §6.7.2 does: shortest form, **no more than 6 decimals**, and "scientific
   notation is not used." It governs CSSOM API serialization rather than
   stylesheet authoring, so it does not bind a compiler — but it is the only
   normative "how to print a CSS number" text in existence, and it lands on the
   *opposite* axis from the one being proposed. That deserves to be argued with
   rather than ignored.

3. **The `rgba(178.5, 93.5, 51, 0.5)` example.** It is real and it is in the
   published Recommendation at `/TR/css-color-4/`. It is **not** in the current
   editor's draft at `drafts.csswg.org/css-color-4/`. Cite the `/TR/` version.
   The stronger citation for the same point is §16.2.2's own note: "contrary to
   CSS Color 3, the parameters of the `rgb()` function are of type `<number>`,
   not `<integer>`."

4. **"sRGB quantizes at 1/255, so the color floor is low."** True of legacy
   `rgb()` only. `color(xyz …)` requires 16 bits ≈ 6 significant figures, and
   modern alpha requires 6 decimal places. The color floor is the *highest* of
   the floors we found, not the lowest.

5. **Scientific notation.** Not mentioned in the original reasoning, and it
   bites. `String(1.23456789e-9)` is `"1.23456789e-9"`. CSS Syntax accepts that
   token, but CSSOM says notation of that form is not used, and today's 8dp path
   turns the value into `0` outright — so no variant that removes the 8dp floor
   can be adopted without deciding what to print here.

6. **"The naive job-1 loop is up to 17 round trips and may be too slow."**
   Backwards — see §6. Today's `round(n, 8)` is *itself* two string round trips
   plus two parses, and measured slower than the tolerance search.

7. **8 significant figures is not uniformly safer than 8 decimal places.** It is
   safer at small magnitudes and *worse* at large ones:
   `123456789.123456` → 8dp keeps it exactly, 8sf gives `123456790`, discarding
   0.87px. Irrelevant in practice, but the axis change is a trade, not a
   strict improvement, and should be stated as one.

Correct in the original reasoning: the purpose is noise suppression, not
precision limiting; decimal places is the wrong axis; `1.23456789e-9` → 8dp →
`0` is a real value-destroying case (verified); and 8 significant figures does
clear every floor the specs state.

---

## 6. Cost — measured

Micro-benchmark of full number→string serialization (which is what
`serializeDimension` does), 200,000 calls, warmup, median of 21, four
independent runs. Pool weighted toward what real stylesheets emit: 50% small
integers, 30% two-decimal values, 10% noisy sums, 10% long repeating quotients.
`round8` is an exact copy of `ast/round.ts` **including its `Number.isInteger`
fast path** — an earlier run omitted that and was unfair to it.

| variant | ns/call, four runs | vs today |
|---|---|---|
| `String(n)` only (floor) | 31, 35, 48, 32 | — |
| **today** — `` `${round(n,8)}` `` | 392, 247, 343, 248 | 1.0× |
| **job 1** — digit-gated tolerance trim | 144, 112, 225, 97 | **~2.2× faster** |
| **job 1 + 8sf cap** | 235, 122, 221, 121 | ~2.0× faster |

Spread is wide (allocation/GC dominated), so treat the absolute figures as
indicative. The *direction* is consistent across all four runs: **adopting job 1
is a performance win, not a cost.** Today's lodash exponential-shift round does
two `` `${n}e`.split('e') `` allocations and two `Number()` parses on every
non-integer; the tolerance search exits at `p` = 1–3 for almost everything.

Two implementation notes that make it cheap:

- **`serializeDimension` must produce a string anyway.** So make `String(n)` the
  first step rather than a cost, and gate on it.
- **A sound, free gate.** A relative tolerance of `1e-12` can only ever shorten
  a value carrying more than ~12 significant digits; below that the
  shortest-round-trip form is already the shortest form within tolerance. So:
  count significant digits in `String(n)` (a charCode scan, no allocation) and
  short-circuit when the count is under 13. Verified against the exhaustive
  search over 2,000,000 random doubles: **zero mismatches**. On the realistic
  pool the gate short-circuits **94.4%** of values.

  Two cheaper-looking gates were tried and are **unsound**: a pure-arithmetic
  `Math.round(n*1e6)/1e6 === n` test (17,103 mismatches / 2M) and a string-length
  test `String(n).length < 16` (3,000 mismatches / 2M). Do not use either.

Note also that the naive `toPrecision(8)` cap **on its own** — the literal 8-sig-figs
proposal with no gate — measured ~392 ns/call, i.e. *slower than today* and
slower than the full job-1 search, because it formats and reparses 8 digits for
every value including plain integers. Any adoption of a cap must be gated too.

---

## 7. Recommendation

**Adopt job 1. Do not adopt job 2 yet.**

Job 1, concretely: relative tolerance `1e-12`; significant-digit gate on
`String(n)`; exhaustive `toPrecision(p)` search for `p` = 1…17 on the ~5% that
fall through; take the first candidate within tolerance. Magnitude-invariant, no
arbitrary constant to defend, faster than today, and it removes exactly the
artifact and nothing else. `1.23456789e-9` survives, where today it becomes `0`.

Job 2 should be argued from bytes on a real stylesheet, and §8.2 measures that
argument at **−0.06% of output size**. That does not buy an arbitrary constant.
If a cap is adopted later anyway, **8 significant figures is the right value** —
it clears every floor the specs state (Color 4's 16-bit `color(xyz)` ≈ 6 sig
figs, modern alpha's 6 decimal places) with margin, and it is on the axis Color
4 itself uses ("the number of significant figures in the serialized value"). It
is *not* justified by the rendering analysis alone, and it should not be sold as
noise suppression.

Two things must be settled before any of this can land, independent of which
jobs are adopted:

- **Scientific notation.** Removing the 8dp floor lets `1.23456789e-9` reach the
  output as `"1.23456789e-9"`. Decide: emit it (legal per CSS Syntax, but
  contradicts CSSOM's note), expand it to positional decimal, or floor tiny
  magnitudes to `0` deliberately rather than as a side effect.
- **`emitValueInterp`.** Delete the bypass (§4). One value, one spelling.

And three cleanups the policy work should absorb: the duplicated `round.ts`, the
`.toLowerCase()` divergence between the two serializers, and `fadein.ts`'s
orphaned `1e12`.

---

## 8. Blast radius

### 8.1 What the corpus actually contains

Static scan of the 189 expected `.css` files in the Less v5 alpha corpus
(`packages/test-data`, 485,288 bytes). Significant-digit histogram of every
fractional numeric literal:

| sig digits | 1 | 2 | 3 | 4 | 5 | 8 | 9 | 10 | 16 |
|---|---|---|---|---|---|---|---|---|---|
| count | 120 | 90 | 17 | 24 | 5 | 6 | 18 | 115 | 4 |

**Nothing between 5 and 8 digits, and nothing between 10 and 16.** The
distribution is bimodal for a reason: everything at 9–10 digits is today's 8dp
output of a repeating fraction, and everything at 16 digits is the
`emitValueInterp` bypass. The policy touches exactly 143 literals across 8
files:

| literal | count | source |
|---|---|---|
| `66.66666667` / `33.33333333` / `8.33333333` / `16.66666667` / `41.66666667` / `58.33333333` / `83.33333333` / `91.66666667` | 125 | twelfths and thirds, mostly `bootstrap4.css` |
| `3.141592653589793` | 4 | **the interpolation bypass** — `property-name-interp.css` ×2, `plugin.css`, `import.css` |
| `23.89833349`, `36.40541176`, `3.14159265`, `0.90040404`, `0.17364818`, `0.84385396`, `42.85714286`, `6.28318531` | 14 | trig / `pi()` in `functions.css`, `rgba.css` |

Files affected: `tests-config/3rd-party/bootstrap4.css` (121),
`tests-unit/functions/{,legacy/}functions.css` (13),
`tests-unit/color-functions/{,legacy/}rgba.css` (4),
`tests-unit/plugin/plugin.css` (2),
`tests-unit/property-name-interp/property-name-interp.css` (2),
`tests-unit/import/import.css` (1).

That the bypass is *encoded in four expected fixtures* is worth stating plainly:
deleting it (§4) is a fixture change, not a silent internal fix.

### 8.2 Byte cost, computed per value

For the exact expressions behind those literals:

| value | today (8dp) | job 1 | job 1 + 8sf | Δ bytes job 1 | Δ bytes job 1+cap |
|---|---|---|---|---|---|
| `100/3` | `33.33333333` | `33.33333333333` | `33.333333` | +3 | −2 |
| `1000/12` | `83.33333333` | `83.3333333333` | `83.333333` | +2 | −2 |
| `pi()` | `3.14159265` | `3.14159265359` | `3.1415927` | +3 | −1 |
| `2*pi()` | `6.28318531` | `6.28318530718` | `6.2831853` | +3 | −1 |
| `300/7` | `42.85714286` | `42.8571428571` | `42.857143` | +2 | −2 |
| `sin(10deg)` | `0.17364818` | `0.173648177667` | `0.17364818` | +4 | 0 |

Extrapolated over all 143 literals: **job 1 alone costs roughly +400 bytes on
485 KB — about +0.08%.** Job 1 with an 8-sig-figure cap comes out roughly
**−280 bytes, about −0.06%**, i.e. marginally *smaller* than today.

**This is the answer to "do we want job 2 at all," and the answer is no.** The
cap's entire measured benefit is six hundredths of one percent of output size,
against the cost of an arbitrary constant that has to be defended forever and a
value-destroying edge at large magnitudes (§5.7). Job 1 alone is the simplest
correct answer and the corpus supports taking it.

The one thing job 1 alone does *not* bound is the pathological case — a value
whose digits are genuinely earned all the way out. The corpus's worst is 13
significant digits (`33.33333333333`). If a cap is ever wanted, that is the
number to watch, and 8 significant figures remains the right value for the
reasons in §7 — but nothing in this corpus asks for one.

### 8.3 Test-expectation churn

Every one of the 143 literals is a committed expectation, so **all 8 files change
under job 1** and the corpus goes red until the expectations are updated. Per
the repo's standing rule these `.css` files are the Less v5 alpha reference and
a diff is a jess bug by default — so this specific set of updates needs the
owner's sign-off as an intentional policy change before it lands, not a
mechanical snapshot refresh.

A full compile-and-diff of the corpus under all three variants was commissioned
alongside this document. The static scan above bounds the answer and is what §7
rests on; the compile run is corroboration, not a dependency.

---

## Sources

- CSS Values and Units Level 4 — https://www.w3.org/TR/css-values-4/ (§5, §5.1, §5.2.1, §6, Additions Since Level 3)
- CSS Values and Units Level 3 — https://www.w3.org/TR/css-values-3/ (§4.1)
- CSS Object Model — https://drafts.csswg.org/cssom-1/ (§6.7.2 Serializing CSS Values)
- CSS Color Level 4 — https://www.w3.org/TR/css-color-4/ (§4.1.1, §4.1.2, §5.1, §16, §16.1.1, §16.1.2, §16.2.2)
- CSS Color Level 5 — https://drafts.csswg.org/css-color-5/ (§3.3, §4.2, §11)
- WebKit `LayoutUnit` — https://trac.webkit.org/wiki/LayoutUnit
