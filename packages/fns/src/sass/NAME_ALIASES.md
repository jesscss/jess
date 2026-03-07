# Sass Function Name Aliases

This document lists Sass functions that are functionally identical to Less functions but have different names. These are implemented as re-exports from the Less implementations.

## Color Functions

### ie-hex-str (Sass) = argb (Less)
- **Sass**: `ie-hex-str($color)`
- **Less**: `argb($color)`
- **Functionality**: Creates a hex representation of a color in `#AARRGGBB` format (IE/Android format)
- **Implementation**: `sass/ie-hex-str.ts` → re-exports `less/argb.ts`

### grayscale (Sass) = greyscale (Less)
- **Sass**: `grayscale($color)`
- **Less**: `greyscale($color)`
- **Functionality**: Remove all saturation from a color (same as `desaturate($color, 100%)`)
- **Implementation**: `sass/grayscale.ts` → re-exports `less/greyscale.ts`

### fade-in (Sass) = fadein (Less)
- **Sass**: `fade-in($color, $amount)`
- **Less**: `fadein($color, $amount)`
- **Functionality**: Increase opacity (decrease transparency) of a color
- **Note**: `opacify()` is an alias for `fade-in()` in Sass
- **Implementation**: `sass/fade-in.ts` → re-exports `less/fadein.ts`

### fade-out (Sass) = fadeout (Less)
- **Sass**: `fade-out($color, $amount)`
- **Less**: `fadeout($color, $amount)`
- **Functionality**: Decrease opacity (increase transparency) of a color
- **Note**: `transparentize()` is an alias for `fade-out()` in Sass
- **Implementation**: `sass/fade-out.ts` → re-exports `less/fadeout.ts`

### opacify (Sass) = fadein (Less)
- **Sass**: `opacify($color, $amount)`
- **Less**: `fadein($color, $amount)`
- **Functionality**: Increase opacity of a color (alias for `fade-in()` in Sass)
- **Implementation**: `sass/opacify.ts` → re-exports `less/fadein.ts`

### transparentize (Sass) = fadeout (Less)
- **Sass**: `transparentize($color, $amount)`
- **Less**: `fadeout($color, $amount)`
- **Functionality**: Decrease opacity of a color (alias for `fade-out()` in Sass)
- **Implementation**: `sass/transparentize.ts` → re-exports `less/fadeout.ts`

### adjust-hue (Sass) = spin (Less)
- **Sass**: `adjust-hue($color, $degrees)`
- **Less**: `spin($color, $amount)`
- **Functionality**: Adjust the hue angle of a color
- **Note**: Less's `spin()` accepts any dimension, while Sass's `adjust-hue()` expects degrees, but they're functionally equivalent
- **Implementation**: `sass/adjust-hue.ts` → re-exports `less/spin.ts`

## Functions with Same Names

These functions have the same names in both Less and Sass and can potentially be shared:

- `lighten($color, $amount)` - Same in both
- `darken($color, $amount)` - Same in both
- `saturate($color, $amount)` - Same in both (though Sass has CSS filter overload)
- `desaturate($color, $amount)` - Same in both
- `mix($color1, $color2, $weight?)` - Similar (Sass has additional `$method` parameter)

These are currently exported from Less but could be moved to shared if verified to be identical.
