# Unit Tracking Analysis: Is Numerator/Denominator Necessary?

## Question
Can we output operations as `calc()` without tracking numerator/denominator arrays? The user believes we can just output the operation directly as `calc()`.

## Analysis

### Scenario 1: Direct Operations
```sass
$result: 10px / 2s;
```
**Current approach**: Each operation decides the output unit.
**With calc()**: Output `calc(10px / 2s)` directly.
**Conclusion**: ✅ No tracking needed - we can output the operation as calc().

### Scenario 2: Stored in Variable
```sass
$speed: 10px / 2s;
$result: $speed * 2;
```
**Question**: When we use `$speed` later, how do we know it has compound units?

**Analysis**:
- `$speed` is stored as a Dimension with `unit: "px/s"` (string)
- When we do `$speed * 2`, we check the unit string
- If unit contains `/` or `*`, we know it's compound
- We can output `calc(calc(10px / 2s) * 2)`

**Conclusion**: ✅ No tracking needed - string-based unit works. We can detect compound units by checking if unit string contains `/` or `*`.

### Scenario 3: Nested Operations
```sass
$result: (10px / 2s) * 3;
```
**Analysis**:
- Inner operation `10px / 2s` creates Dimension with `unit: "px/s"`
- Outer operation `$result * 3` sees unit "px/s"
- Detects compound unit, outputs `calc(calc(10px / 2s) * 3)`

**Conclusion**: ✅ No tracking needed - string-based works.

### Scenario 4: Unit Cancellation
```sass
$result: 10px / 2px;
```
**Analysis**:
- Operation detects `px / px` → cancels to unitless
- In 'preserve' mode, could output `calc(10px / 2px)` or just `5`
- User wants calc() when units are "mis-used" - cancellation might be considered normal, not mis-use

**Conclusion**: ✅ No tracking needed - we can detect cancellation by parsing the operation.

### Scenario 5: Function Return Values
```sass
@function speed($distance, $time) {
  @return $distance / $time;
}
$result: speed(100px, 5s);
```
**Analysis**:
- Function returns Dimension with `unit: "px/s"`
- When used later, we detect compound unit from string
- Output as calc() when needed

**Conclusion**: ✅ No tracking needed - string-based works.

### Scenario 6: Multiple Operations on Compound Units
```sass
$speed: 10px / 2s;
$accel: $speed / 1s;  // Should be px/s²
$result: $accel * 2;
```
**Analysis**:
- `$speed` has unit `"px/s"`
- `$speed / 1s` → need to create `"px/s/s"` or `"px/s²"`
- String-based: `"px/s/s"` or parse and simplify to `"px/s²"`
- When outputting, detect compound unit, wrap in calc()

**Conclusion**: ✅ No tracking needed - we can:
1. Create compound unit strings: `"px/s/s"` or `"px/s²"`
2. Parse string to detect compound units
3. Output as calc() when needed

### Scenario 7: Unit Arithmetic on Compound Units
```sass
$speed1: 10px / 2s;
$speed2: 20px / 3s;
$result: $speed1 + $speed2;
```
**Analysis**:
- Both have `"px/s"` units
- Addition with same compound unit → keep unit, output `calc((10px / 2s) + (20px / 3s))`
- Or simplify: `calc(5px / 1s + 6.67px / 1s)` → `calc(11.67px / 1s)`

**Conclusion**: ✅ No tracking needed - string-based works. We can:
1. Check if units match (string comparison)
2. If they match, perform operation, keep unit string
3. Output as calc() with nested operations

## Edge Cases

### Case 1: Unit Simplification
```sass
$result: 10px * 2px / 4px;
```
**String approach**: `"px*px/px"` → could simplify to `"px"` or keep as `"px*px/px"`
**With tracking**: `numerator: ["px", "px"], denominator: ["px"]` → cancel → `numerator: ["px"]`
**Question**: Do we need to simplify, or can we output `calc(10px * 2px / 4px)`?

**Answer**: We can output the operation as-is in calc(). Simplification is optional optimization.

### Case 2: Complex Nested Operations
```sass
$result: (10px / 2s) * (3em / 1s) / 5;
```
**String approach**: Final unit would be `"px*em/s/s"` or `"px*em/s²"`
**With tracking**: `numerator: ["px", "em"], denominator: ["s", "s"]`
**Question**: Can we represent this as a string?

**Answer**: Yes - `"px*em/s/s"` or we could simplify to `"px*em/s²"`. When outputting, we can parse the string to reconstruct the operation structure, or just output the entire nested calc().

## Conclusion

**Unit tracking (numerator/denominator arrays) is NOT necessary** for 'preserve' mode because:

1. **String-based units work**: We can store compound units as strings (`"px/s"`, `"px*em"`, etc.)
2. **Detection is simple**: Check if unit string contains `/` or `*` to detect compound units
3. **Output is straightforward**: When outputting, if unit is compound, wrap in `calc()`
4. **Operations can be nested**: We can output nested calc() expressions: `calc(calc(10px / 2s) * 2)`
5. **Simplification is optional**: We don't need to simplify compound units - we can output the full operation

**The only potential issue**: If we need to do unit arithmetic on compound units (like adding two `px/s` values), we might need to parse the string. But even then, we can:
- Parse the string to extract numerator/denominator when needed
- Or just output the operation as calc() without simplifying

**Recommendation**: Use string-based units for 'preserve' mode. No numerator/denominator tracking needed.
