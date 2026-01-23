# Sass Function Catalog

This document catalogs all built-in Sass functions from dart-sass, categorized by conversion complexity for importing into Jess.

## Complexity Categories

- **Simple**: Direct conversion possible, basic types only
- **Medium**: Requires type conversion, some metadata handling
- **Complex**: Requires complex logic, special number handling, CSS passthrough
- **Very Complex**: Multiple color spaces, advanced overloads, special cases

## Color Module Functions

### Simple Functions
- `red($color)` - Extract red channel
- `green($color)` - Extract green channel  
- `blue($color)` - Extract blue channel
- `hue($color)` - Extract hue (with unit conversion)
- `saturation($color)` - Extract saturation
- `lightness($color)` - Extract lightness
- `alpha($color)` - Extract alpha (with overloads)
- `opacity($color)` - Extract opacity (with CSS passthrough)

### Medium Complexity
- `lighten($color, $amount)` - Adjust lightness (legacy colors only)
- `darken($color, $amount)` - Adjust darkness (legacy colors only)
- `saturate($color, $amount)` - Increase saturation (with CSS filter overload)
- `desaturate($color, $amount)` - Decrease saturation
- `adjust-hue($color, $degrees)` - Adjust hue angle
- `grayscale($color)` - Convert to grayscale (with CSS filter passthrough)
- `opacify($color, $amount)` - Increase opacity
- `fade-in($color, $amount)` - Alias for opacify
- `transparentize($color, $amount)` - Decrease opacity
- `fade-out($color, $amount)` - Alias for transparentize
- `complement($color, $space: null)` - Get complementary color

### Complex Functions
- `rgb($red, $green, $blue, $alpha?)` - Create RGB color (multiple overloads)
- `rgba($red, $green, $blue, $alpha?)` - Create RGBA color (multiple overloads)
- `hsl($hue, $saturation, $lightness, $alpha?)` - Create HSL color (multiple overloads)
- `hsla($hue, $saturation, $lightness, $alpha?)` - Create HSLA color (multiple overloads)
- `mix($color1, $color2, $weight: 50%, $method: null)` - Mix colors (with interpolation method)
- `invert($color, $weight: 100%, $space: null)` - Invert color (with CSS filter passthrough)

### Very Complex Functions
- `color($description)` - Parse color from string (multiple color spaces)
- `hwb($channels)` - HWB color space
- `lab($channels)` - Lab color space
- `lch($channels)` - LCH color space
- `oklab($channels)` - OKLab color space
- `oklch($channels)` - OKLCH color space
- `adjust($color, $kwargs...)` - Adjust color channels (keyword args)
- `scale($color, $kwargs...)` - Scale color channels (keyword args)
- `change($color, $kwargs...)` - Change color channels (keyword args)
- `ie-hex-str($color)` - IE hex string format

### Color Module Functions (sass:color)
- `color.red($color)` - Module version
- `color.green($color)` - Module version
- `color.blue($color)` - Module version
- `color.hue($color)` - Module version
- `color.saturation($color)` - Module version
- `color.lightness($color)` - Module version
- `color.whiteness($color)` - HWB whiteness
- `color.blackness($color)` - HWB blackness
- `color.space($color)` - Get color space name
- `color.to-space($color, $space)` - Convert to color space
- `color.is-legacy($color)` - Check if legacy color
- `color.is-missing($color, $channel)` - Check missing channel
- `color.is-in-gamut($color, $space: null)` - Check gamut
- `color.to-gamut($color, $space: null, $method: null)` - Convert to gamut
- `color.channel($color, $channel, $space: null)` - Get channel value
- `color.same($color1, $color2)` - Compare colors
- `color.is-powerless($color, $channel, $space: null)` - Check powerless channel

## Math Module Functions

### Simple Functions
- `math.abs($number)` - Absolute value
- `math.ceil($number)` - Ceiling
- `math.floor($number)` - Floor
- `math.round($number)` - Round
- `math.max($numbers...)` - Maximum (variadic)
- `math.min($numbers...)` - Minimum (variadic)
- `math.percentage($number)` - Convert to percentage
- `math.unit($number)` - Get unit string
- `math.unitless($number)` - Check if unitless
- `math.compatible($number1, $number2)` - Check unit compatibility
- `math.sqrt($number)` - Square root
- `math.pow($base, $exponent)` - Power
- `math.log($number, $base: null)` - Logarithm
- `math.hypot($numbers...)` - Hypotenuse (variadic)

### Medium Complexity
- `math.clamp($min, $number, $max)` - Clamp value (unit conversion)
- `math.sin($number)` - Sine (unit conversion)
- `math.cos($number)` - Cosine (unit conversion)
- `math.tan($number)` - Tangent (unit conversion)
- `math.asin($number)` - Arc sine
- `math.acos($number)` - Arc cosine
- `math.atan($number)` - Arc tangent
- `math.atan2($y, $x)` - Arc tangent 2

### Global Math Functions (Deprecated)
- `abs($number)` - With percentage deprecation warning
- `ceil($number)` - Deprecated
- `floor($number)` - Deprecated
- `max($numbers...)` - Deprecated
- `min($numbers...)` - Deprecated
- `round($number)` - Deprecated
- `percentage($number)` - Deprecated
- `unit($number)` - Deprecated
- `comparable($number1, $number2)` - Deprecated
- `unitless($number)` - Deprecated

### Math Module Variables
- `math.$e` - Euler's number
- `math.$pi` - Pi
- `math.$epsilon` - Machine epsilon
- `math.$max-safe-integer` - Max safe integer
- `math.$min-safe-integer` - Min safe integer
- `math.$max-number` - Max number
- `math.$min-number` - Min number

## String Module Functions

### Simple Functions
- `string.length($string)` - String length (code points)
- `string.unquote($string)` - Remove quotes
- `string.quote($string)` - Add quotes
- `string.to-upper-case($string)` - Uppercase
- `string.to-lower-case($string)` - Lowercase
- `string.unique-id()` - Generate unique ID

### Medium Complexity
- `string.index($string, $substring)` - Find substring index
- `string.insert($string, $insert, $index)` - Insert string (code point handling)
- `string.slice($string, $start-at, $end-at: -1)` - Slice string (code point handling)
- `string.split($string, $separator, $limit: null)` - Split string

### Global String Functions (Deprecated)
- `str-length($string)` - Deprecated
- `str-insert($string, $insert, $index)` - Deprecated
- `str-index($string, $substring)` - Deprecated
- `str-slice($string, $start-at, $end-at: -1)` - Deprecated
- `unquote($string)` - Deprecated
- `quote($string)` - Deprecated
- `to-upper-case($string)` - Deprecated
- `to-lower-case($string)` - Deprecated
- `unique-id()` - Deprecated

## List Module Functions

### Simple Functions
- `list.length($list)` - List length
- `list.nth($list, $n)` - Get nth element (1-based, negative support)
- `list.index($list, $value)` - Find value index
- `list.is-bracketed($list)` - Check if bracketed
- `list.separator($list)` - Get separator

### Medium Complexity
- `list.set-nth($list, $n, $value)` - Set nth element (preserve metadata)
- `list.join($list1, $list2, $separator: auto, $bracketed: auto)` - Join lists (metadata handling)
- `list.append($list, $val, $separator: auto)` - Append to list (metadata handling)
- `list.zip($lists...)` - Zip lists (variadic)
- `list.slash($list)` - Create slash-separated list

### Global List Functions (Deprecated)
- `length($list)` - Deprecated
- `nth($list, $n)` - Deprecated
- `set-nth($list, $n, $value)` - Deprecated
- `join($list1, $list2, $separator: auto, $bracketed: auto)` - Deprecated
- `append($list, $val, $separator: auto)` - Deprecated
- `zip($lists...)` - Deprecated
- `index($list, $value)` - Deprecated
- `is-bracketed($list)` - Deprecated
- `list-separator($list)` - Deprecated

## Map Module Functions

### Simple Functions
- `map.get($map, $key, $keys...)` - Get value (nested support)
- `map.keys($map)` - Get all keys
- `map.values($map)` - Get all values
- `map.has-key($map, $key, $keys...)` - Check key existence (nested)

### Medium Complexity
- `map.set($map, $key, $value)` - Set value (overloaded)
- `map.merge($map1, $map2)` - Merge maps (overloaded, deep merge support)
- `map.remove($map, $keys...)` - Remove keys (variadic)
- `map.deep-merge($map1, $map2)` - Deep merge
- `map.deep-remove($map, $keys...)` - Deep remove

### Global Map Functions (Deprecated)
- `map-get($map, $key, $keys...)` - Deprecated
- `map-merge($map1, $map2)` - Deprecated
- `map-remove($map, $keys...)` - Deprecated
- `map-keys($map)` - Deprecated
- `map-values($map)` - Deprecated
- `map-has-key($map, $key, $keys...)` - Deprecated

## Conversion Complexity Summary

### Simple (Direct Conversion)
- Basic math operations (abs, ceil, floor, round)
- String utilities (length, quote, unquote, case conversion)
- List utilities (length, nth, index)
- Map utilities (get, keys, values, has-key)
- Color channel extractors (red, green, blue, hue, saturation, lightness, alpha)

**Count**: ~30 functions

### Medium (Type Conversion Required)
- Math with units (sin, cos, tan, clamp)
- String manipulation (insert, slice, split) - code point handling
- List manipulation (join, append, set-nth) - metadata preservation
- Color adjustments (lighten, darken, saturate, desaturate, adjust-hue)
- Color creation (rgb, rgba, hsl, hsla) - with overloads

**Count**: ~25 functions

### Complex (Special Handling)
- Color mixing (mix) - interpolation methods
- Color inversion (invert) - CSS filter passthrough
- Color parsing (color, hwb, lab, lch, oklab, oklch) - multiple color spaces
- Color adjustments (adjust, scale, change) - keyword arguments
- Map operations (merge, deep-merge) - nested structures
- Variadic functions (max, min, hypot, zip) - rest parameters

**Count**: ~15 functions

### Very Complex (Advanced Features)
- Color space conversion (to-space, to-gamut) - gamut mapping
- Color channel access (channel) - dynamic channel names
- Color comparison (same) - cross-space comparison
- Special number handling - CSS function passthrough
- Microsoft filter support (alpha function)

**Count**: ~10 functions

## Total Function Count

- **Color Module**: ~50 functions (global + module)
- **Math Module**: ~25 functions + 7 variables
- **String Module**: ~10 functions
- **List Module**: ~10 functions
- **Map Module**: ~10 functions

**Grand Total**: ~105 functions

## Conversion Priority

### Phase 1: High-Value Simple Functions
1. Math utilities (abs, ceil, floor, round, max, min)
2. String utilities (length, quote, unquote, case conversion)
3. Color channel extractors (red, green, blue, alpha)
4. List utilities (length, nth, index)

### Phase 2: Medium Complexity Core Functions
1. Color creation (rgb, rgba, hsl, hsla)
2. Color adjustments (lighten, darken, saturate, desaturate)
3. Math with units (sin, cos, tan, clamp)
4. List manipulation (join, append)

### Phase 3: Complex Functions
1. Color mixing and conversion (mix, invert)
2. Color parsing (color, hwb, lab, lch)
3. Variadic functions (max, min with rest params)
4. Map operations (merge, deep-merge)

### Phase 4: Advanced Features
1. Color space conversion (to-space, to-gamut)
2. Dynamic channel access (channel)
3. Special number handling
4. CSS function passthrough
