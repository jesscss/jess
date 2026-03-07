# Import Chain Analysis for Circular Dependency

## Error
```
TypeError: Class extends value undefined is not a constructor or null
 ❯ src/tree/number.ts:17:26
     17| export class Num extends Dimension {
 ❯ src/tree/index.ts:36:1
```

## Chain Analysis

### index.ts export order:
- Line 35: `export * from './dimension';`
- Line 36: `export * from './number';`

### number.ts imports:
- `./node` (for defineType, Node, etc.)
- `./dimension` (for Dimension class) ← **THIS IS UNDEFINED**

### dimension.ts imports:
- `./color` (Color, ColorFormat)
- `./node` (Node, defineType, etc.)
- `./util/calculate` (Operator, calculate)
- `./util/print` (PrintOptions, getPrintOptions)

### Potential cycle paths to check:

1. **dimension.ts → color.ts → ?**
   - color.ts imports: `./call`, `./list`, `./node`, `./util/calculate`, `./util/print`, `./util/is-node`
   
2. **dimension.ts → node.ts → ?**
   - node.ts imports: `./node-base`, `./nil`, `./any`, `../context`
   - node-base.ts imports: `./rules` (type only), `./nil` (type only)
   
3. **dimension.ts → util/calculate.ts → ?**
   - calculate.ts: No imports (just exports)
   
4. **dimension.ts → util/print.ts → ?**
   - print.ts imports: `../at-rule` (type only), `../ruleset` (type only)

### Key question:
Does any file in the chain from dimension.ts eventually import from index.ts or cause index.ts to be re-evaluated?
