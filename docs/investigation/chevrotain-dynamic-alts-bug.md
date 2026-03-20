# Chevrotain Fork Bug: Fast-Dispatch Cache Assumes Static Alternatives

## Bug

The fast-dispatch cache (`_orFastMaps`) in `orInternal` assumes that a given `(rule, occurrence)` OR always receives the same alternatives array. This fails when alternatives are **dynamic** — passed in as a parameter that changes between calls.

## Reproduction

The Jess css-parser's `main` rule is called with different `alt` parameters:
- Top-level: `alt = [atRule, qualifiedRule]` (2 alts)
- From `declarationList`: `alt = [innerAtRule, declaration, qualifiedRule, Semi]` (4 alts)

Both go through the same RULE-wrapped `main`, so they share the same `(currRuleShortName, occurrence)` mapKey for the OR inside.

On the first call (top-level, 2 alts), the cache records `tokenTypeIdx → altIdx 1` (qualifiedRule).
On the second call (declarationList, 4 alts), the cache returns `altIdx 1` which is now `declaration`, but the cache also tries to check preceding gated alts: `alts[g]` for `g < 1` — this works. But if the cached `altIdx` is 2 or 3, `alts[g]` for the 2-alt array returns `undefined`, crashing with `Cannot read properties of undefined (reading 'GATE')`.

## Where to Fix

File: `packages/chevrotain/src/parse/parser/parser.ts` (post-mixin-flattening)

Function: `addOrFastMapEntry` and `orInternal`

## Possible Fixes

1. **Detect dynamic alts**: If the alternatives array reference changes between calls for the same mapKey, invalidate the cache entry. Store `alts` alongside the cached index and compare on lookup.

2. **Key by alts identity**: Include the alternatives array's identity (or length) in the mapKey. E.g., `mapKey = currRuleShortName | occurrence | (alts.length << 16)`.

3. **Validate cached altIdx**: Before accessing `alts[cachedAltIdx]`, check `cachedAltIdx < alts.length`. If out of bounds, skip the fast path and fall through to speculation.

4. **Skip caching for dynamic alts**: If the OR receives a new `alts` array on a subsequent call (reference inequality), disable caching for that mapKey entirely.

Option 3 is the simplest and safest — just add bounds checks.

## Test

```typescript
it("OR with dynamic alts should not crash", () => {
  class TestParser extends EmbeddedActionsParser {
    constructor() {
      super([TokenA, TokenB, TokenC, TokenD]);
      this.RULE("dynamicOr", (alts) => {
        return this.OR(alts);
      });
      this.performSelfAnalysis();
    }
    dynamicOr!: (alts: IOrAlt<any>[]) => any;
  }

  const parser = new TestParser();

  // First call with 2 alts
  parser.input = tokenize("A");
  parser.dynamicOr([
    { ALT: () => parser.CONSUME(TokenA) },
    { ALT: () => parser.CONSUME(TokenB) },
  ]);

  // Second call with 4 alts — should NOT crash
  parser.input = tokenize("C");
  parser.dynamicOr([
    { ALT: () => parser.CONSUME(TokenA) },
    { ALT: () => parser.CONSUME(TokenB) },
    { ALT: () => parser.CONSUME(TokenC) },
    { ALT: () => parser.CONSUME(TokenD) },
  ]);
});
```
