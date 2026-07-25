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
- **Status**: needs a Sass implementation. Re-exporting `argb` gives SCSS the wrong case.

### grayscale (Sass) = greyscale (Less) — PURE RENAME (verified)
- **Sass**: `grayscale($color)`
- **Less**: `greyscale($color)`
- **Functionality**: Remove all saturation from a color (same as `desaturate($color, 100%)`)
- **Implementation**: `sass/grayscale.ts` → re-exports `less/greyscale.ts`

### fade-in / opacify (Sass) ≠ fadein (Less) — DIVERGENT, not an alias
### fade-out / transparentize (Sass) ≠ fadeout (Less) — DIVERGENT, not an alias
- The AMOUNT is on a different scale. Less takes a percentage; Sass takes a 0-1
  fraction and **rejects** a percentage outright:

  ```
  fadein(rgba(255,0,0,0.5), 10%)    Less → rgba(255, 0, 0, 0.6)
  fade-in(rgba(255,0,0,0.5), 10%)   Sass → Error: $amount: Expected 10% to be within 0 and 1
  fade-in(rgba(255,0,0,0.5), 0.1)   Sass → rgba(255, 0, 0, 0.6)
  ```
- **Status**: `sass/fade-in.ts`, `sass/fade-out.ts`, `sass/opacify.ts` and
  `sass/transparentize.ts` need real Sass implementations. Re-exporting the Less
  body errors on every correct Sass call site and mis-scales any percentage that
  slips through.

### adjust-hue (Sass) = spin (Less) — PURE RENAME (verified)
- **Sass**: `adjust-hue($color, $degrees)`
- **Less**: `spin($color, $amount)`
- **Functionality**: Adjust the hue angle of a color
- **Verified**: `spin(#800,45)` (Less) and both `adjust-hue(#800,45)` and
  `adjust-hue(#800,45deg)` (Sass) all give `#886600`
- **Implementation**: `sass/adjust-hue.ts` → re-exports `less/spin.ts`

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

These are currently exported from Less but could be moved to shared if verified to be identical.
