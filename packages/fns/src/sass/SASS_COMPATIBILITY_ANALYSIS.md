# Sass AST Compatibility Analysis

This document analyzes potential tweaks to Jess Node AST structure and `defineFunction` that could improve Sass AST compatibility.

## Current State

### Jess AST Structure
- **Color**: Supports RGB, HSL, HEX formats. Stores `rgb`, `hsl`, `alpha`, and `format` in `value`.
- **Dimension**: Stores `number` and `unit` (single string) in `value`.
- **List**: Stores array of nodes with `separator` property.
- **Sequence**: Stores array of nodes (space-separated).
- **String**: Primitive string type.
- **Map**: Key-value pairs.

### Sass AST Structure
- **SassColor**: Supports RGB, HSL, HWB, Lab, LCH, OKLab, OKLCH spaces. Stores channels, alpha, space, missing channels, legacy flag.
- **SassNumber**: Stores value with `numeratorUnits` and `denominatorUnits` arrays (e.g., `px*rem/s`).
- **SassList**: Stores items with separator type (`comma`, `space`, `slash`, `undecided`) and `hasBrackets` flag.
- **SassString**: Stores text with `hasQuotes` flag.
- **SassMap**: Key-value pairs.

## Key Compatibility Gaps

### 1. Color Space Support

**Current Gap:**
- Jess only supports RGB, HSL, HEX
- Sass supports RGB, HSL, HWB, Lab, LCH, OKLab, OKLCH
- Missing color spaces require conversion

**Question: Is there inherent benefit to storing colors in their original color space?**

**Answer:** Jess already preserves the original authored statement via `value.node` (string or Node). For most color adjustments, no - operations typically convert to a working space (like HSL), perform the operation, then convert back. However, storing channel values in multiple formats can be useful for:
- Avoiding unnecessary conversions when the format matches the operation
- Supporting color space-specific operations (e.g., `color.channel()` in Sass)
- Faster access to commonly-used formats (RGB and HSL are both frequently needed)

**Missing Channels:**
CSS Color 4 allows `none` keyword for missing components (e.g., `rgb(none 100 200)`). These are used for:
- Relative color syntax: `hsl(from red 240deg s l)` - keeps saturation/lightness, changes hue
- Color interpolation where some components are unspecified
- The `none` value is treated as `0` in calculations but preserves the "missing" semantic

**Precision Loss Example:**
If a color has missing channels (e.g., `rgb(none 100 200)`), converting to Jess RGB format would lose the information that red was "none" vs "0". When converting back, you'd get `rgb(0 100 200)` instead of `rgb(none 100 200)`. This matters for relative color syntax and interpolation.

**Potential Solutions:**

#### Option A: Extend ColorFormat enum
```typescript
export enum ColorFormat {
  HEX,
  RGB,
  HSL,
  HWB,    // New
  LAB,    // New
  LCH,    // New
  OKLAB,  // New
  OKLCH   // New
}
```

**Pros:**
- Native support for all Sass color spaces
- No conversion loss
- Direct compatibility

**Cons:**
- Requires color science library for conversions
- More complex Color class
- May not be needed for Less compatibility

#### Option B: Store multiple channel formats in Color
```typescript
export interface ColorData {
  node?: string | Node;  // Original authored statement (already exists)
  format?: ColorFormat;  // Preferred output format (already exists)
  
  // Store channels for RGB and HSL (both commonly used)
  rgb?: [number, number, number];
  hsl?: [number, number, number];
  alpha?: number;
  
  // Optional: Store other color space channels (normalized float values, not units)
  hwb?: [number, number, number];      // Hue (0-360), Whiteness (0-100), Blackness (0-100)
  lab?: [number, number, number];       // L (0-100), a (-125 to 125), b (-125 to 125)
  lch?: [number, number, number];       // L (0-100), C (0-150), H (0-360)
  oklab?: [number, number, number];     // L (0-1), a (-0.4 to 0.4), b (-0.4 to 0.4)
  oklch?: [number, number, number];     // L (0-1), C (0-0.4), H (0-360)
  
  // Metadata
  space?: 'rgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch';
  isLegacy?: boolean;
  missingChannels?: Set<0 | 1 | 2 | 'alpha'>; // CSS Color 4 'none' keyword
}
```

**Channel Values:**
- **Normalized float values** (not Dimension/units)
- Each color space has its own range (stored as-is)
- Functions that accept multiple types handle conversion

**Implementation Complexity:**
- **Trivial** for RGB/HSL: Already stored, just need to allow HSL in constructor
- **Simple** for HWB: Similar to HSL, straightforward conversion
- **Complex** for Lab/LCH/OKLab/OKLCH: Requires color science library

**Pros:**
- Avoids unnecessary conversions
- Faster access to commonly-used formats
- Backward compatible (node already preserves original)
- Preserves missing channel information for CSS Color 4 compatibility

**Cons:**
- More complex Color class
- Missing channels are rare in practice (CSS Color 4 feature)
- Advanced color spaces require color science library

#### Option C: Keep conversion layer (current approach)
**Pros:**
- Minimal changes to core
- Less complexity
- Clear separation of concerns

**Cons:**
- Conversion loss
- Performance overhead
- Metadata loss

**Recommendation:** Option B (metadata) provides best balance - preserves information without requiring full implementation.

### 2. Unit System

**Current Gap:**
- Jess Dimension stores single `unit` string (e.g., `"px"`, `"px*rem"`)
- Sass Number stores `numeratorUnits: ["px", "rem"]` and `denominatorUnits: ["s"]`
- Compound units result from CSS calc() operations in Sass (e.g., `math.div(123px, 5ms)` → `px/ms`)

**Question: What compound units exist in CSS?**

**Answer:** CSS itself doesn't have compound units. However, Sass's math operations can create them:
- Division: `math.div(123px, 5ms)` → numerator: `["px"]`, denominator: `["ms"]`
- Multiplication: `123px * 1em` → numerator: `["px", "em"]`, denominator: `[]`
- Complex: `px*em/ms*kHz` → numerator: `["px", "em"]`, denominator: `["ms", "kHz"]`

These are intermediate results from calculations, not standard CSS units. Sass outputs them as `calc()` expressions.

**Why numerator/denominator?**
- **Sass**: Needs to output compound units as `calc()` (e.g., `calc(123px / 5ms)`)
- **Less.js**: Uses for unit cancellation and fallback output (tries single unit, falls back to backupUnit)
- **Jess**: Current string-based approach (`"px*rem"`) works for most cases

**When is tracking valuable?**
1. **Sass `math.div()` output**: Must preserve structure to generate `calc()`
2. **Unit cancellation**: Easier to detect `px/px` → unitless with arrays
3. **Complex operations**: Easier to manipulate `px*em/s/foo` as arrays than strings

**Is it necessary for Jess?**
- **For Less compatibility**: No - string-based works, Less doesn't have `math.div()`
- **For Sass compatibility**: Only if we need to output `calc()` correctly
- **For Jess math modes**: Current string-based approach is sufficient

**Current State:**
Jess's Dimension already supports compound units as strings (e.g., `"px*rem"`), which works for most cases. The structure is only needed if we want to preserve exact unit structure through calculations.

**Potential Solutions:**

#### Option A: Extend Dimension to support numerator/denominator
```typescript
export type DimensionValue = {
  number: number;
  unit?: string; // Keep for backward compatibility (parsed from numerator/denominator)
  numeratorUnits?: string[]; // New (e.g., ["px", "em"])
  denominatorUnits?: string[]; // New (e.g., ["ms", "kHz"])
};
```

**Pros:**
- Direct compatibility with Sass
- Preserves unit structure from calc() operations
- Better for unit arithmetic and validation

**Cons:**
- More complex Dimension class
- May not be needed for Less (Less doesn't have `math.div()`)
- Most CSS output needs single unit anyway
- Current string-based approach works for most cases

#### Option B: Parse unit string into arrays when needed
```typescript
get numeratorUnits(): string[] {
  if (this._numeratorUnits) return this._numeratorUnits;
  // Parse this.value.unit if it contains '*'
  return this.value.unit?.split('*') || [];
}
```

**Pros:**
- Backward compatible
- Lazy parsing
- No breaking changes

**Cons:**
- Parsing overhead
- May not handle all cases
- Still loses denominator info

#### Option C: Keep conversion layer (current approach)
**Pros:**
- No core changes
- Simple
- Works for most cases

**Cons:**
- Loses unit structure
- Conversion overhead

**Recommendation:** Option A if we want full compatibility, Option B for minimal changes.

### 3. List Separators

**Current Gap:**
- Jess List has `separator` property (`',' | ';' | '/'`)
- Sass List has `separator: 'comma' | 'space' | 'slash' | 'undecided'`
- Sass List has `hasBrackets` flag
- Jess Sequence is separate type for space-separated

**Note:** Jess already has `Paren` node type that represents brackets/parentheses, so `hasBrackets` could be determined by checking if a List is wrapped in a Paren node.

**Potential Solutions:**

#### Option A: Extend List separator type
```typescript
type ListSeparator = 'comma' | 'space' | 'slash' | 'undecided';
export interface ListOptions {
  separator?: ListSeparator;
  hasBrackets?: boolean; // New
}
```

**Pros:**
- Direct compatibility
- Preserves all metadata
- Better for Sass functions

**Cons:**
- May not be needed for Less
- More complexity

#### Option B: Add metadata to List
```typescript
export interface ListOptions {
  separator?: 'comma' | 'space' | 'slash';
  hasBrackets?: boolean; // New
  // Keep existing separator for backward compatibility
}
```

**Pros:**
- Backward compatible
- Preserves metadata
- Minimal changes

**Cons:**
- Still need conversion logic

**Recommendation:** Option B - add `hasBrackets` and extend separator type.

### 4. String Quotes

**Current Gap:**
- Jess has `Quoted` node type that stores quote information (`quote?: '"' | '\''`)
- Sass strings have `hasQuotes` flag
- Jess already preserves quote information via `Quoted` node

**Note:** Jess's `Quoted` node already handles this! It stores:
- The quote type: `quote?: '"' | '\''`
- Whether it's escaped: `escaped?: boolean`
- The string value

**Potential Solutions:**

#### Option A: Use existing Quoted node
Jess already has `Quoted` node that preserves quote information:
```typescript
export class Quoted extends Node<string | Any | Interpolated, QuotedOptions> {
  // QuotedOptions includes: quote?: '"' | '\'', escaped?: boolean
}
```

**Pros:**
- Already exists in Jess
- Preserves quote information
- No breaking changes needed
- Works for `unquote()`/`quote()` functions

**Cons:**
- Need to ensure conversion layer uses `Quoted` nodes
- May need to handle cases where strings are primitives vs Quoted nodes

**Recommendation:** Use existing `Quoted` node. The conversion layer should convert Sass strings to `Quoted` nodes (not primitive strings) to preserve quote information.

### 5. defineFunction Enhancements

**Current State:**
- `defineFunction` accepts `ParamDefinition[]` with `type: ArgType`
- `ArgType` can be primitive types or classes
- Type checking happens at runtime

**Potential Enhancements:**

#### Option A: Add Sass-style parameter string support
```typescript
defineFunction('abs', fn, {
  params: '$number', // Sass-style string
  // OR
  params: [{ name: 'number', type: Dimension }] // Current style
});
```

**Pros:**
- Easier migration from Sass
- More concise
- Familiar to Sass developers

**Cons:**
- Requires parsing
- Less type-safe
- Duplicate functionality

**Status:** Already implemented via `parseSassParams` and `defineFunctionSass`.

#### Option B: Add automatic value conversion
```typescript
defineFunction('abs', fn, {
  params: [{ name: 'number', type: Dimension }],
  convertFromSass: true, // Auto-convert Sass values
  convertToSass: true     // Auto-convert return values
});
```

**Pros:**
- Automatic compatibility
- Less boilerplate
- Transparent conversion

**Cons:**
- Performance overhead
- Hidden conversions
- May cause confusion

**Recommendation:** Keep conversion explicit via helper functions.

#### Option C: Add metadata preservation options
```typescript
defineFunction('abs', fn, {
  params: [{ name: 'number', type: Dimension }],
  preserveMetadata: {
    units: true,        // Preserve numerator/denominator units
    colorSpace: true,   // Preserve color space
    listSeparator: true // Preserve list separator
  }
});
```

**Pros:**
- Selective metadata preservation
- Performance control
- Explicit behavior

**Cons:**
- More complex API
- May not be needed if core supports it

**Recommendation:** If core AST supports metadata, this becomes automatic.

## Recommended Changes (Priority Order)

### High Priority

1. **Extend List separator support** (Option B from #3)
   - Extend separator type to include `'undecided'` (Jess already has `'/'`)
   - Note: `hasBrackets` can be determined via `Paren` wrapper, no flag needed
   - Minimal breaking changes

2. **Use Quoted nodes for strings** (from #4)
   - Ensure conversion layer converts Sass strings to `Quoted` nodes (not primitives)
   - Already supported in Jess, just needs proper usage in conversion

### Medium Priority

3. **Store multiple channel formats in Color** (Option B from #1)
   - **Phase 1 (Trivial)**: Allow HSL in constructor, store both RGB and HSL
   - **Phase 2 (Simple)**: Add HWB support if needed
   - **Phase 3 (Complex)**: Add Lab/LCH/OKLab/OKLCH only if required (needs color science)
   - Channels are normalized float values (not units)
   - Preserves information without requiring full implementation
   - Enables better Sass compatibility
   - Note: Missing channels are rare (CSS Color 4 feature)

### Low Priority

4. **Add numerator/denominator units to Dimension** (Option A from #2)
   - Only if we need to support Sass `math.div()` → `calc()` output
   - Current string-based approach works for Less and most Jess use cases
   - Less.js uses it for unit cancellation and fallback output
   - Sass uses it to generate `calc()` expressions
   - **Alternative**: Keep string-based, parse when needed (lazy parsing)

### Low Priority

5. **Extend ColorFormat enum** (Option A from #1)
   - Only if we want native support for all color spaces
   - Requires color science library
   - May not be needed if metadata approach works

## Implementation Strategy

1. **Phase 1: Metadata Preservation**
   - Add optional metadata fields to existing nodes
   - Keep backward compatibility
   - Update conversion layer to use metadata

2. **Phase 2: Enhanced Types**
   - Extend enums and types
   - Add new properties
   - Update type definitions

3. **Phase 3: New Node Types** (if needed)
   - Create String node type
   - Migrate existing code
   - Update function definitions

## Testing Considerations

- Ensure backward compatibility with Less
- Test metadata preservation through conversions
- Verify performance impact of metadata
- Test edge cases (missing channels, undecided separators, etc.)

## Conclusion

The most impactful changes would be:
1. **Extending List separator support** - Add `'undecided'` separator type (already has `'/'`)
2. **Using Quoted nodes for strings** - Ensure conversion uses `Quoted` nodes instead of primitives
3. **Storing multiple channel formats in Color** - Store RGB and HSL (trivial), optionally HWB (simple), Lab/LCH/OKLab/OKLCH (complex)

**Key Findings:**
- **List brackets**: Already representable via `Paren` node wrapper - no `hasBrackets` flag needed
- **String quotes**: Already supported via `Quoted` node - just need to use it in conversion
- **Color original statement**: Already preserved via `value.node` - no changes needed
- **Color channels**: Should be normalized float values (not units). Storing RGB+HSL is trivial and useful
- **Compound units**: Result from calc() operations, not standard CSS. Current string-based approach works for Less and most Jess cases. Only needed for Sass `math.div()` → `calc()` output
- **Missing channels**: CSS Color 4 feature, rare in practice. Only needed if supporting relative color syntax
- **Unit tracking**: Less.js uses for cancellation/fallback, Sass uses for `calc()` output. Not strictly necessary for Jess unless supporting Sass `calc()` output

These changes preserve Sass metadata without breaking Less compatibility, and enable better function compatibility with minimal performance impact.
