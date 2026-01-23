# Sass Function Export Structure

This document explains the export structure for Sass functions, matching Sass's module system.

## Structure Overview

- **`sass/index.ts`** - Global legacy functions (deprecated, for backward compatibility)
- **`sass/color/index.ts`** - Functions available in `sass:color` module
- **`sass/math/index.ts`** - Functions available in `sass:math` module
- **`sass/string/index.ts`** - Functions available in `sass:string` module
- **`sass/list/index.ts`** - Functions available in `sass:list` module
- **`sass/map/index.ts`** - Functions available in `sass:map` module

## Dash-Case Function Names

`defineFunction` accepts a string as the first parameter, so dash-case names work directly:

```typescript
defineFunction('ie-hex-str', fn, options)  // ✅ Works
defineFunction('fade-in', fn, options)     // ✅ Works
defineFunction('adjust-hue', fn, options)   // ✅ Works
```

The function name is stored in the function object and used when the function is called. When exporting from modules, we use camelCase for valid JavaScript identifiers, but the actual function name remains dash-case.

## Global Functions (`sass/index.ts`)

These are the legacy global functions that Sass provides for backward compatibility. They are deprecated in favor of module-specific functions.

### Global Math Functions
- `abs()`, `ceil()`, `floor()`, `round()`, `max()`, `min()`
- TODO: `percentage()`, `unit()`, `comparable()`, `unitless()`, `random()`

### Global Color Functions
- `red()`, `green()`, `blue()`, `alpha()`
- `mix()`, `rgb()`, `rgba()`, `hsl()`, `hsla()`
- `lighten()`, `darken()`, `saturate()`, `desaturate()`
- `grayscale()`, `adjust-hue()`, `opacify()`, `fade-in()`, `transparentize()`, `fade-out()`
- `complement()`, `ie-hex-str()`, `invert()`
- TODO: `hue()`, `saturation()`, `lightness()`, `opacity()`, `color()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `adjust-color()`, `scale-color()`, `change-color()`

### Global String Functions
- TODO: All string functions

### Global List Functions
- TODO: All list functions

### Global Map Functions
- TODO: All map functions

## Color Module (`sass/color/index.ts`)

Functions available in `sass:color` module (modern, non-deprecated).

### Available Functions
- `red()`, `green()`, `blue()`, `alpha()` - Channel extractors
- `mix()` - Color mixing
- `invert()` - Color inversion
- `grayscale()` - Remove saturation
- `complement()` - Complementary color
- `ie-hex-str()` - IE hex format

### TODO: Module-Specific Functions
- `hue()`, `saturation()`, `lightness()` - HSL channel extractors
- `whiteness()`, `blackness()` - HWB channel extractors
- `space()` - Get color space name
- `to-space()` - Convert to color space
- `is-legacy()` - Check if legacy color
- `is-missing()` - Check missing channel
- `is-in-gamut()` - Check gamut
- `to-gamut()` - Convert to gamut
- `channel()` - Get channel value
- `same()` - Compare colors
- `is-powerless()` - Check powerless channel
- `adjust()`, `scale()`, `change()` - Color adjustments
- `hwb()` - HWB color creation (overloaded)
- `opacity()` - Get opacity

## Math Module (`sass/math/index.ts`)

Functions available in `sass:math` module.

### Available Functions
- `abs()`, `ceil()`, `floor()`, `round()`, `max()`, `min()`

### TODO: Module Functions
- `percentage()`, `unit()`, `unitless()`, `compatible()`
- `sqrt()`, `pow()`, `log()`, `hypot()`
- `sin()`, `cos()`, `tan()`, `asin()`, `acos()`, `atan()`, `atan2()`
- `clamp()`, `div()`

### TODO: Module Variables
- `$e`, `$pi`, `$epsilon`
- `$max-safe-integer`, `$min-safe-integer`
- `$max-number`, `$min-number`

## String Module (`sass/string/index.ts`)

Functions available in `sass:string` module.

### Available Functions
- `length()` - String length

### TODO: Module Functions
- `unquote()`, `quote()`
- `to-upper-case()`, `to-lower-case()`
- `index()`, `insert()`, `slice()`, `split()`
- `unique-id()`

## List Module (`sass/list/index.ts`)

Functions available in `sass:list` module.

### TODO: All Module Functions
- `length()`, `nth()`, `set-nth()`
- `join()`, `append()`, `zip()`
- `index()`, `is-bracketed()`, `separator()`, `slash()`

## Map Module (`sass/map/index.ts`)

Functions available in `sass:map` module.

### TODO: All Module Functions
- `get()`, `set()`, `merge()`, `remove()`
- `keys()`, `values()`, `has-key()`
- `deep-merge()`, `deep-remove()`

## Usage Examples

```typescript
// Global functions (legacy)
import { abs, red, mix } from '@jesscss/fns/sass';
abs(-10px);
red(rgb(255, 0, 0));

// Module functions (modern)
import { abs as mathAbs } from '@jesscss/fns/sass/math';
import { red as colorRed } from '@jesscss/fns/sass/color';
mathAbs(-10px);
colorRed(rgb(255, 0, 0));

// Or namespace import
import * as color from '@jesscss/fns/sass/color';
color.red(rgb(255, 0, 0));
```
