# Color Node Structure and Unit Tracking Analysis

## Color Node Structure Investigation

### Current State

Jess Color node already preserves the original authored statement:
- `Color.node` can be a `string` (hex) or `Node` (parsed color function)
- Only converts when operations are performed
- Serialization checks `Color.node` first, falling back to format-based serialization

### Proposed Enhancement: Store Multiple Channel Formats

**Current Issue:**
- Color constructor only accepts RGB in array form: `[r, g, b, a]`
- Can't directly create HSL colors - must convert
- Format is stored but channels are only stored for one format at a time

**Proposed Structure:**
```typescript
export interface ColorData {
  node?: string | Node;  // Original authored statement
  format?: ColorFormat;  // Preferred output format
  
  // Store channels for RGB and HSL (both commonly used)
  rgb?: [number, number, number];
  hsl?: [number, number, number];
  alpha?: number;
  
  // Optional: Store other color space channels
  // These would be normalized float values (0-1 for most, 0-360 for hue)
  hwb?: [number, number, number];      // Hue (0-360), Whiteness (0-100), Blackness (0-100)
  lab?: [number, number, number];       // L (0-100), a (-125 to 125), b (-125 to 125)
  lch?: [number, number, number];       // L (0-100), C (0-150), H (0-360)
  oklab?: [number, number, number];     // L (0-1), a (-0.4 to 0.4), b (-0.4 to 0.4)
  oklch?: [number, number, number];     // L (0-1), C (0-0.4), H (0-360)
  
  // Metadata
  space?: 'rgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch'; // Original color space
  isLegacy?: boolean;
  missingChannels?: Set<0 | 1 | 2 | 'alpha'>; // CSS Color 4 'none' keyword
}
```

**Channel Value Format:**
- **Normalized float values** (not Dimension/units)
- Each color space has its own range:
  - RGB: 0-255 (stored as-is, clamped on getter)
  - HSL: H 0-360, S/L 0-1 (stored as-is)
  - HWB: H 0-360, W/B 0-100 (stored as-is)
  - Lab/LCH: Various ranges (stored as-is)
- **Not units** - these are pure numeric values
- Functions that accept multiple types (e.g., `color.channel()`) would handle conversion

**Implementation Complexity:**
- **Trivial** for RGB/HSL: Already stored, just need to allow HSL in constructor
- **Simple** for HWB: Similar to HSL, straightforward conversion
- **Complex** for Lab/LCH/OKLab/OKLCH: Requires color science library for accurate conversion

**Recommendation:**
1. **Phase 1 (Trivial)**: Allow HSL in constructor, store both RGB and HSL
2. **Phase 2 (Simple)**: Add HWB support (similar to HSL)
3. **Phase 3 (Complex)**: Add Lab/LCH/OKLab/OKLCH only if needed (requires color science)

## Unit Tracking Analysis

### Less.js Unit System

Less.js has a `Unit` class that tracks numerator/denominator arrays:
```javascript
var Unit = function (numerator, denominator, backupUnit) {
    this.numerator = numerator ? copyArray(numerator).sort() : [];
    this.denominator = denominator ? copyArray(denominator).sort() : [];
    this.backupUnit = backupUnit || numerator[0]; // For fallback output
};
```

**Key Features:**
- Tracks compound units from math operations
- Has `cancel()` method to simplify units (e.g., `px/px` → unitless)
- Uses `backupUnit` for output when unit can't be represented as single unit
- In `genCSS()`, outputs single unit if possible, otherwise uses `backupUnit` or falls back to denominator[0]

**When It's Used:**
- During math operations (multiplication, division)
- When units need to be canceled or simplified
- For output generation (tries to output single unit, falls back if needed)

**Example from Less.js:**
```javascript
// Division: 10px / 2s → numerator: ['px'], denominator: ['s']
// Output: Uses backupUnit (px) or falls back to denominator[0] (s) in non-strict mode
// In strict mode: Throws error if not singular unit
```

### Sass Number System

Sass has similar numerator/denominator tracking:
```dart
class ComplexSassNumber extends SassNumber {
  List<String> numeratorUnits;
  List<String> denominatorUnits;
}
```

**Key Difference:**
- Sass converts compound units to `calc()` when outputting to CSS
- If `numeratorUnits.isEmpty`, outputs as plain number
- Otherwise wraps in `calc()`: `calc(123px / 5ms)`

**When It's Used:**
- `math.div(123px, 5ms)` creates `px/ms` unit
- `1px * 1em` creates `px*em` unit
- Output: Converts to `calc(1px * 1em)` for CSS

### Jess Current System

Jess Dimension stores single `unit` string:
- Can handle compound units as strings: `"px*rem"`, `"px/ms"`
- Unit arithmetic handles conversion within same group
- Division cancels units in strict mode: `10px / 2px` → unitless

**Current Behavior:**
- Multiplication: `10px * 2` → `20px` (keeps unit)
- Division (strict): `10px / 2px` → `5` (cancels units)
- Division (non-strict): `10px / 2px` → `5px` (keeps unit)
- Different units: Converts if same group, otherwise coerces or errors

### Is Numerator/Denominator Tracking Necessary?

**For Less.js:**
- **Yes, but limited**: Used for unit cancellation and fallback output
- Less.js outputs single unit when possible, uses backupUnit otherwise
- Compound units are intermediate - final output is usually single unit

**For Sass:**
- **Yes, for calc() output**: Compound units must be preserved to output as `calc()`
- Sass's `math.div()` intentionally creates compound units
- These are output as `calc()` expressions, not simplified

**For Jess:**
- **Maybe not necessary**: 
  - Current string-based approach works for most cases
  - Less doesn't have `math.div()` - division cancels units
  - Compound units are rare in practice
  - Could parse string when needed: `"px*rem"` → `["px", "rem"]`

**Examples Where Tracking Is Valuable:**

1. **Sass `math.div()` output:**
   ```sass
   $result: math.div(123px, 5ms);
   // Output: calc(123px / 5ms)
   ```
   Without tracking, can't generate correct `calc()` output.

2. **Unit cancellation:**
   ```sass
   $result: 10px / 2px;  // Should be unitless: 5
   ```
   With tracking: `numerator: ['px'], denominator: ['px']` → cancel → unitless
   Without tracking: Need to parse `"px/px"` string to detect cancellation

3. **Complex operations:**
   ```sass
   $result: 1px * 1em / 1s / 1foo;
   // Output: calc(1px * 1em / 1s / 1foo)
   ```
   String representation: `"px*em/s/foo"` works, but harder to manipulate

**Conclusion:**
- **For Less compatibility**: Not strictly necessary - string-based works
- **For Sass compatibility**: Needed if we want to output `calc()` correctly
- **For Jess math modes**: Current string-based approach is sufficient
- **Recommendation**: Only add if we need to support Sass `math.div()` output to `calc()`

## Recommendations

### Color Node
1. **Immediate (Trivial)**: Allow HSL in constructor, store both RGB and HSL
2. **Short-term (Simple)**: Add HWB support if needed
3. **Long-term (Complex)**: Add Lab/LCH/OKLab/OKLCH only if required

### Unit Tracking
1. **Current approach is sufficient** for Less and most Jess use cases
2. **Add numerator/denominator arrays** only if:
   - We need to support Sass `math.div()` → `calc()` output
   - We want better unit cancellation logic
   - We need to manipulate compound units programmatically

**Alternative**: Keep string-based, parse when needed for specific operations (lazy parsing).
