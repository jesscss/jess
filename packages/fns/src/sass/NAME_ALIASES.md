# Sass Function Name Aliases

Sass functions whose name differs from the Less function of the same purpose.

**Only a PURE RENAME may be a re-export.** A name match is not a behaviour match:
where the bodies disagree on scale, arity, or output format, Sass needs its own
implementation, and re-exporting the Less body produces a function that errors on
correct Sass calls. Each entry below is graded, with the divergences proved by
running dart-sass 1.101.0 and lessc 4.8.0 side by side (see
`docs/state/fns-dialect-classification-audit.md` §6).

## Color Functions

### ie-hex-str (Sass) ≠ argb (Less) — DIVERGENT, not an alias
- **Sass**: `ie-hex-str($color)` → `#80FF0000` (UPPER case)
- **Less**: `argb($color)` → `#80ff0000` (lower case)
- **Functionality**: same `#AARRGGBB` layout, different output case
- **Status**: LANDED — `sass/color/ie-hex-str.ts` is a Sass-owned body.

### grayscale (Sass) = greyscale (Less) — SAME COMPUTATION, still a separate definition
- **Sass**: `grayscale($color)`
- **Less**: `greyscale($color)`
- **Functionality**: Remove all saturation from a color (same as `desaturate($color, 100%)`)
- **Implementation**: `sass/color/grayscale.ts` — a Sass-owned body, NOT a re-export.
  A fn IS its dispatch name, so re-exporting the Less callable would publish a
  Less built-in under a Sass module. The computation is restated; nothing else.

### fade-in / opacify (Sass) ≠ fadein (Less) — DIVERGENT, not an alias
### fade-out / transparentize (Sass) ≠ fadeout (Less) — DIVERGENT, not an alias
- The AMOUNT is on a different scale. Less takes a percentage; Sass takes a 0-1
  fraction and **rejects** a percentage outright:

  ```
  fadein(rgba(255,0,0,0.5), 10%)    Less → rgba(255, 0, 0, 0.6)
  fade-in(rgba(255,0,0,0.5), 10%)   Sass → Error: $amount: Expected 10% to be within 0 and 1
  fade-in(rgba(255,0,0,0.5), 0.1)   Sass → rgba(255, 0, 0, 0.6)
  ```
- **Status**: LANDED — `sass/color/fade-in.ts`, `fade-out.ts`, `opacify.ts` and
  `transparentize.ts` are Sass-owned bodies on the 0-1 scale.

### adjust-hue (Sass) ≠ spin (Less) — DIVERGENT on ANGLE UNITS
- **Sass**: `adjust-hue($color, $degrees)`
- **Less**: `spin($color, $amount)`
- **Functionality**: Adjust the hue angle of a color
- The earlier "pure rename (verified)" grade was reached from `45`/`45deg` only,
  where the two happen to agree (`#886600` in both). Sass CONVERTS a true angle
  unit and Less does not — `sass-spec`'s `adjust_hue/units.hrx` has
  `adjust-hue(red, 60rad)` → `rgb(0, 179.576224164, 255)` (i.e. 3437.75deg),
  where Less's `spin` reads the bare `60`. Unitless and unknown units (`60in`)
  are degrees in both.
- **Implementation**: `sass/color/adjust-hue.ts` — a Sass-owned body.

## Functions with Same Names

These functions have the same names in both Less and Sass and can potentially be shared:

Same name in both, but **none of these is shareable** — each diverges once you
leave the two-argument case:

- `lighten` / `darken` / `saturate` / `desaturate` - two-arg results agree, but
  Less has a third `method` argument (`lighten(#800, 10%, relative)` → `#960000`)
  where Sass raises `Only 2 arguments allowed`. `darken(#800, 100%)` also differs
  in output format: Less `#000000`, Sass `black`.
- `mix($color1, $color2, $weight?)` - Less ROUNDS channels, Sass does not:
  `mix(#f00,#00f)` → Less `#800080`, Sass `rgb(127.5, 0, 127.5)`. Sass also has a
  fourth colour-space `$method` argument.

All of the above now have Sass-owned bodies in `sass/color/`, alongside
`hue`/`saturation`/`lightness`/`opacity`, `complement`, `invert`, and the
`rgb`/`rgba`/`hsl`/`hsla` constructors (which diverge on channel clamping,
percent preservation and achromatic canonicalization). The only colour functions
that remain SHARED are `red`/`green`/`blue`/`alpha`, per the colour-precision
ruling: channels carry full precision internally and quantize only at the output
boundary, which makes the two dialects' channel readers the same function.

Conformance for the whole Sass set is driven by the `sass-spec` corpus
(`spec/core_functions/color/**`) in `sass/__tests__/color-sass-spec.test.ts`,
not by hand-picked examples.
