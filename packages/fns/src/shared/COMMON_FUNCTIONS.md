# Common Functions Between Less and Sass

This document identifies functions that exist in both Less and Sass with the same behavior, which should be placed in the `shared/` folder.

## Math Functions (Identical Behavior)

### Simple Math Operations
- **abs($number)** - Absolute value
  - Less: `packages/fns/src/less/abs.ts`
  - Sass: `packages/fns/src/sass/math/abs.ts`
  - **Status**: Identical behavior - returns absolute value with same units
  - **Action**: Move to `shared/math/abs.ts`

- **ceil($number)** - Ceiling
  - Less: `packages/fns/src/less/ceil.ts`
  - Sass: `math.ceil($number)`
  - **Status**: Identical behavior
  - **Action**: Move to `shared/math/ceil.ts`

- **floor($number)** - Floor
  - Less: `packages/fns/src/less/floor.ts`
  - Sass: `math.floor($number)`
  - **Status**: Identical behavior
  - **Action**: Move to `shared/math/floor.ts`

- **round($number, $precision?: 0)** - Round
  - Less: `packages/fns/src/less/round.ts` (supports precision)
  - Sass: `math.round($number)` (no precision in Sass)
  - **Status**: Less has precision parameter, Sass doesn't
  - **Action**: Keep separate OR create shared version with optional precision

- **max($values...)** - Maximum
  - Less: `packages/fns/src/less/max.ts` (variadic)
  - Sass: `math.max($numbers...)` (variadic)
  - **Status**: Identical behavior - variadic, returns max
  - **Action**: Move to `shared/math/max.ts`

- **min($values...)** - Minimum
  - Less: `packages/fns/src/less/min.ts` (variadic)
  - Sass: `math.min($numbers...)` (variadic)
  - **Status**: Identical behavior - variadic, returns min
  - **Action**: Move to `shared/math/min.ts`

### Trigonometric Functions
- **sin($number)**, **cos($number)**, **tan($number)**
- **asin($number)**, **acos($number)**, **atan($number)**
- **sqrt($number)**
- **Status**: Identical behavior in both
- **Action**: Move to `shared/math/`

## Color Functions (Identical Behavior)

### Color Channel Extractors
- **red($color)** - Extract red channel (0-255)
  - Less: `packages/fns/src/less/red.ts`
  - Sass: `color.red($color)` / global `red($color)`
  - **Status**: Identical behavior
  - **Action**: Move to `shared/color/red.ts`

- **green($color)** - Extract green channel (0-255)
  - Less: `packages/fns/src/less/green.ts`
  - Sass: `color.green($color)` / global `green($color)`
  - **Status**: Identical behavior
  - **Action**: Move to `shared/color/green.ts`

- **blue($color)** - Extract blue channel (0-255)
  - Less: `packages/fns/src/less/blue.ts`
  - Sass: `color.blue($color)` / global `blue($color)`
  - **Status**: Identical behavior
  - **Action**: Move to `shared/color/blue.ts`

- **alpha($color)** - Extract alpha channel (0-1)
  - Less: `packages/fns/src/less/alpha.ts`
  - Sass: `color.alpha($color)` / global `alpha($color)`
  - **Status**: Identical behavior
  - **Action**: Move to `shared/color/alpha.ts`

### Color Creation
- **rgb($red, $green, $blue, $alpha?)** - Create RGB color
  - Less: `packages/fns/src/less/rgb.ts`
  - Sass: `rgb($red, $green, $blue, $alpha?)` (overloaded)
  - **Status**: Similar but Sass has more overloads (color + alpha, channels)
  - **Action**: Keep separate OR create base shared version

- **rgba($red, $green, $blue, $alpha?)** - Create RGBA color
  - Less: `packages/fns/src/less/rgba.ts`
  - Sass: `rgba($red, $green, $blue, $alpha?)` (overloaded)
  - **Status**: Similar but Sass has more overloads
  - **Action**: Keep separate OR create base shared version

- **hsl($hue, $saturation, $lightness, $alpha?)** - Create HSL color
  - Less: `packages/fns/src/less/hsl.ts`
  - Sass: `hsl($hue, $saturation, $lightness, $alpha?)` (overloaded)
  - **Status**: Similar but Sass has more overloads
  - **Action**: Keep separate OR create base shared version

- **hsla($hue, $saturation, $lightness, $alpha?)** - Create HSLA color
  - Less: `packages/fns/src/less/hsla.ts`
  - Sass: `hsla($hue, $saturation, $lightness, $alpha?)` (overloaded)
  - **Status**: Similar but Sass has more overloads
  - **Action**: Keep separate OR create base shared version

### Color Adjustments (Potentially Identical)
- **lighten($color, $amount)** - Lighten color
  - Less: `packages/fns/src/less/lighten.ts`
  - Sass: `lighten($color, $amount)` (legacy colors only)
  - **Status**: Need to verify algorithm is identical
  - **Action**: Verify and potentially move to shared

- **darken($color, $amount)** - Darken color
  - Less: `packages/fns/src/less/darken.ts`
  - Sass: `darken($color, $amount)` (legacy colors only)
  - **Status**: Need to verify algorithm is identical
  - **Action**: Verify and potentially move to shared

- **saturate($color, $amount)** - Increase saturation
  - Less: `packages/fns/src/less/saturate.ts`
  - Sass: `saturate($color, $amount)` (with CSS filter overload)
  - **Status**: Need to verify algorithm is identical
  - **Action**: Verify and potentially move to shared

- **desaturate($color, $amount)** - Decrease saturation
  - Less: `packages/fns/src/less/desaturate.ts`
  - Sass: `desaturate($color, $amount)`
  - **Status**: Need to verify algorithm is identical
  - **Action**: Verify and potentially move to shared

- **mix($color1, $color2, $weight?: 50%)** - Mix colors
  - Less: `packages/fns/src/less/mix.ts`
  - Sass: `mix($color1, $color2, $weight?: 50%, $method?: null)`
  - **Status**: Less uses legacy algorithm, Sass has interpolation method option
  - **Action**: Keep separate (different algorithms)

## Functions That Are Different

### Less-Specific Functions
- **spin($color, $degrees)** - Less only
- **hsv()**, **hsva()**, **hsvhue()**, **hsvsaturation()**, **hsvvalue()** - Less only
- **luma()**, **luminance()** - Less only
- **contrast()** - Less only
- **shade()**, **tint()** - Less only
- Color blending modes (multiply, screen, overlay, etc.) - Less only

### Sass-Specific Functions
- **color.adjust()**, **color.scale()**, **color.change()** - Sass only
- **color.to-space()**, **color.to-gamut()** - Sass only
- Advanced color spaces (lab, lch, oklab, oklch) - Sass only
- **color.channel()** - Sass only

## Migration Plan

### Phase 1: Simple Math Functions (High Confidence)
1. Move `abs`, `ceil`, `floor` to `shared/math/`
2. Move `max`, `min` to `shared/math/`
3. Update Less and Sass exports to re-export from shared

### Phase 2: Color Channel Extractors (High Confidence)
1. Move `red`, `green`, `blue`, `alpha` to `shared/color/`
2. Update Less and Sass exports to re-export from shared

### Phase 3: Verify Color Adjustments (Medium Confidence)
1. Compare `lighten`, `darken`, `saturate`, `desaturate` implementations
2. If identical, move to `shared/color/`
3. If different, document differences and keep separate

### Phase 4: Color Creation Functions (Low Confidence)
1. Compare `rgb`, `rgba`, `hsl`, `hsla` implementations
2. Create base shared versions if core behavior is identical
3. Keep library-specific overloads in library folders
