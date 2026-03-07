# Sass Function Port Plan

This document outlines the plan for systematically porting dart-sass functions to Jess, one at a time, using the standard `defineFunction` pattern.

## Approach

1. **No conversion helpers** - Use standard `defineFunction` with explicit `ParamDefinition[]` arrays
2. **Direct implementation** - Rewrite functions based on dart-sass source code
3. **Test parity** - Port dart-sass tests to ensure same input → same output (serialized)
4. **Module structure** - Maintain Sass module organization (global vs module-specific)

## Standard Pattern

All functions should follow this pattern:

```typescript
import { defineFunction, Color, Dimension, ... } from '@jesscss/core';
import { percentOf, toNumber, ... } from '@jesscss/core';

const functionName = defineFunction(
  'function-name', // Use dash-case for Sass function names
  function(param1: Type1, param2?: Type2) {
    // Implementation based on dart-sass source
    // ...
    return result;
  },
  {
    params: [
      {
        name: 'param1',
        type: Type1
      },
      {
        name: 'param2',
        type: Type2,
        optional: true,
        convert: [percentOf(1), toNumber()] // if needed
      }
    ]
  }
);

export default functionName;
```

## Function Categories

### Phase 1: Simple Functions (High Priority)
Functions that are straightforward conversions with minimal logic:

**Color Channel Extractors:**
- [x] `red($color)` - Already implemented
- [x] `green($color)` - Already implemented
- [x] `blue($color)` - Already implemented
- [x] `alpha($color)` - Already implemented
- [ ] `hue($color)` - Extract hue (returns Dimension with 'deg' unit)
- [ ] `saturation($color)` - Extract saturation (returns Dimension with '%' unit)
- [ ] `lightness($color)` - Extract lightness (returns Dimension with '%' unit)
- [ ] `opacity($color)` - Extract opacity (with CSS passthrough for special numbers)

**Math Functions:**
- [x] `abs($number)` - Already implemented
- [x] `ceil($number)` - Already implemented
- [x] `floor($number)` - Already implemented
- [x] `round($number)` - Already implemented
- [x] `max($numbers...)` - Already implemented
- [x] `min($numbers...)` - Already implemented
- [ ] `percentage($number)` - Convert to percentage
- [ ] `unit($number)` - Get unit string
- [ ] `unitless($number)` - Check if unitless
- [ ] `compatible($number1, $number2)` - Check unit compatibility

**String Functions:**
- [ ] `unquote($string)` - Remove quotes
- [ ] `quote($string)` - Add quotes
- [ ] `to-upper-case($string)` - Uppercase
- [ ] `to-lower-case($string)` - Lowercase
- [ ] `unique-id()` - Generate unique ID
- [ ] `str-length($string)` - String length (deprecated, use string.length)
- [ ] `str-insert($string, $insert, $index)` - Insert string
- [ ] `str-index($string, $substring)` - Find substring index
- [ ] `str-slice($string, $start-at, $end-at: -1)` - Slice string

**List Functions:**
- [ ] `length($list)` - List length
- [ ] `nth($list, $n)` - Get nth element (1-based)
- [ ] `index($list, $value)` - Find value index
- [ ] `is-bracketed($list)` - Check if bracketed
- [ ] `list-separator($list)` - Get separator

**Map Functions:**
- [ ] `map-get($map, $key, $keys...)` - Get value (nested)
- [ ] `map-keys($map)` - Get all keys
- [ ] `map-values($map)` - Get all values
- [ ] `map-has-key($map, $key, $keys...)` - Check key existence

### Phase 2: Medium Complexity Functions

**Color Adjustments:**
- [x] `lighten($color, $amount)` - Already implemented
- [x] `darken($color, $amount)` - Already implemented
- [x] `saturate($color, $amount)` - Already implemented
- [x] `desaturate($color, $amount)` - Already implemented
- [x] `adjust-hue($color, $degrees)` - Already implemented
- [x] `grayscale($color)` - Already implemented
- [x] `opacify($color, $amount)` - Already implemented
- [x] `fade-in($color, $amount)` - Already implemented
- [x] `transparentize($color, $amount)` - Already implemented
- [x] `fade-out($color, $amount)` - Already implemented
- [ ] `complement($color, $space: null)` - Get complementary color
- [ ] `invert($color, $weight: 100%, $space: null)` - Invert color (with CSS filter passthrough)

**Color Creation:**
- [x] `rgb($red, $green, $blue, $alpha?)` - Already implemented
- [x] `rgba($red, $green, $blue, $alpha?)` - Already implemented
- [x] `hsl($hue, $saturation, $lightness, $alpha?)` - Already implemented
- [x] `hsla($hue, $saturation, $lightness, $alpha?)` - Already implemented
- [x] `mix($color1, $color2, $weight: 50%)` - Already implemented
- [ ] `ie-hex-str($color)` - IE hex string format (partially implemented)

**Math Functions:**
- [ ] `sqrt($number)` - Square root
- [ ] `pow($base, $exponent)` - Power
- [ ] `log($number, $base: null)` - Logarithm
- [ ] `hypot($numbers...)` - Hypotenuse (variadic)
- [ ] `clamp($min, $number, $max)` - Clamp value
- [ ] `sin($number)` - Sine (angle conversion)
- [ ] `cos($number)` - Cosine (angle conversion)
- [ ] `tan($number)` - Tangent (angle conversion)
- [ ] `asin($number)` - Arc sine
- [ ] `acos($number)` - Arc cosine
- [ ] `atan($number)` - Arc tangent
- [ ] `atan2($y, $x)` - Arc tangent 2

**List Functions:**
- [ ] `set-nth($list, $n, $value)` - Set nth element
- [ ] `join($list1, $list2, $separator: auto, $bracketed: auto)` - Join lists
- [ ] `append($list, $val, $separator: auto)` - Append to list
- [ ] `zip($lists...)` - Zip lists (variadic)

**Map Functions:**
- [ ] `map-set($map, $key, $value)` - Set value
- [ ] `map-merge($map1, $map2)` - Merge maps
- [ ] `map-remove($map, $keys...)` - Remove keys

### Phase 3: Complex Functions

**Color Functions:**
- [ ] `color($description)` - Parse color from string (multiple color spaces)
- [ ] `hwb($channels)` - HWB color space
- [ ] `lab($channels)` - Lab color space
- [ ] `lch($channels)` - LCH color space
- [ ] `oklab($channels)` - OKLab color space
- [ ] `oklch($channels)` - OKLCH color space
- [ ] `adjust($color, $kwargs...)` - Adjust color channels (keyword args)
- [ ] `scale($color, $kwargs...)` - Scale color channels (keyword args)
- [ ] `change($color, $kwargs...)` - Change color channels (keyword args)

**Color Module Functions:**
- [ ] `color.whiteness($color)` - HWB whiteness
- [ ] `color.blackness($color)` - HWB blackness
- [ ] `color.space($color)` - Get color space name
- [ ] `color.to-space($color, $space)` - Convert to color space
- [ ] `color.is-legacy($color)` - Check if legacy color
- [ ] `color.is-missing($color, $channel)` - Check missing channel
- [ ] `color.is-in-gamut($color, $space: null)` - Check gamut
- [ ] `color.to-gamut($color, $space: null, $method: null)` - Convert to gamut
- [ ] `color.channel($color, $channel, $space: null)` - Get channel value
- [ ] `color.same($color1, $color2)` - Compare colors
- [ ] `color.is-powerless($color, $channel, $space: null)` - Check powerless channel

### Phase 4: Advanced Features

- [ ] CSS function passthrough for special numbers
- [ ] Microsoft filter support
- [ ] Random number generation
- [ ] Math module variables ($e, $pi, etc.)

## Test Strategy

For each function:

1. **Find dart-sass test file** - Look in `dart-sass/test/` or `dart-sass/lib/src/functions/`
2. **Extract test cases** - Convert Dart test syntax to TypeScript/Vitest
3. **Test serialized output** - Focus on input → output, not internal representation
4. **Test edge cases** - Special numbers, null values, error cases

Example test structure:

```typescript
import { describe, it, expect } from 'vitest';
import { Color, Dimension, Context, callWithContext } from '@jesscss/core';
import hue from '../src/sass/hue.js';

describe('hue()', () => {
  it('should extract hue from HSL color', async () => {
    const color = new Color({ format: ColorFormat.HSL, hsl: [180, 0.5, 0.5] });
    const context = new Context();
    const result = await callWithContext(context, hue, color);
    expect(result.toString()).toBe('180deg');
  });
  
  // Port more test cases from dart-sass
});
```

## Implementation Order

1. **Start with simple functions** - Build confidence and establish patterns
2. **Group by module** - Complete one module at a time (color, math, string, list, map)
3. **Test as you go** - Write tests immediately after implementation
4. **Document edge cases** - Note any differences from dart-sass behavior

## Files to Remove

After converting functions that use helpers:

- `packages/fns/src/sass/parse-params.ts` - Remove, use explicit ParamDefinition[]
- `packages/fns/src/sass/define-function-sass.ts` - Remove, use defineFunction directly
- `packages/fns/src/sass/value-converter.ts` - Remove, not needed
- `packages/fns/src/sass/color-converter.ts` - Remove, not needed

## Next Steps

1. Convert functions using `parseSassParams` to standard pattern:
   - `invert.ts`
   - `complement.ts`
   - `string/length.ts`
2. Remove helper files
3. Start Phase 1: Simple functions, one at a time
4. For each function:
   - Read dart-sass implementation
   - Rewrite using defineFunction
   - Port tests from dart-sass
   - Verify output matches
