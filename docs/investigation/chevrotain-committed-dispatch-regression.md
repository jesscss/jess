# Chevrotain Fork: Committed Dispatch Regression

## Summary

Commit `e8ac31f0 feat: zero-overhead committed dispatch for OR (no try/catch)` regressed the Jess css-parser from 77/95 passing tests to 46/95. The `GATE` crash (`Cannot read properties of undefined (reading 'GATE')`) returned.

The fix for dynamic alternatives at `9c14c90c fix: skip OR fast-dispatch when alts array identity changes` works correctly — 77/95 tests pass when built at that commit. The three commits on top of it (`1ec5ccf4`, `8d727706`, `e8ac31f0`) reintroduce the problem.

## How to Reproduce

### Step 1: Write a failing test

The test must use dynamic alternatives — an OR that receives different `alts` arrays on different invocations of the same RULE:

```typescript
it("committed dispatch with dynamic alts should not crash", () => {
  class TestParser extends EmbeddedActionsParser {
    constructor() {
      super([TokenA, TokenB, TokenC, TokenD, LCurly, RCurly]);
      this.RULE("wrapper", (alts) => {
        return this.OR(alts);
      });
      this.RULE("outer", () => {
        // 2-alt call
        return this.SUBRULE(this.wrapper, { ARGS: [[
          { ALT: () => this.CONSUME(TokenA) },
          { ALT: () => this.CONSUME(TokenB) },
        ]] });
      });
      this.RULE("inner", () => {
        // 4-alt call to same RULE
        return this.SUBRULE(this.wrapper, { ARGS: [[
          { ALT: () => this.CONSUME(TokenA) },
          { ALT: () => this.CONSUME(TokenB) },
          { ALT: () => this.CONSUME(TokenC) },
          { ALT: () => this.CONSUME(TokenD) },
        ]] });
      });
      this.performSelfAnalysis();
    }
    outer!: () => any;
    inner!: () => any;
  }

  const parser = new TestParser();

  // First: call outer (populates fast-dispatch with 2-alt mapping)
  parser.input = tokenize("A");
  parser.outer();
  expect(parser.errors).toHaveLength(0);

  // Second: call inner (same RULE, different alts — must not crash)
  parser.input = tokenize("C");
  parser.inner();
  expect(parser.errors).toHaveLength(0);
});
```

### Step 2: Verify it fails at HEAD (`e8ac31f0`)

The test should crash with `Cannot read properties of undefined (reading 'GATE')` in `addOrFastMapEntry` or the committed dispatch path.

### Step 3: Verify it passes at `9c14c90c`

The dynamic-alts identity check correctly skips the fast path when `alts` changes.

## Root Cause

The committed dispatch path (`e8ac31f0`) bypasses the `alts` identity check from `9c14c90c`. When it uses a cached `altIdx` from a previous invocation with a 2-element `alts` array, and the current `alts` has 4 elements (or vice versa), it accesses `alts[cachedIdx]` out of bounds, getting `undefined`.

The fix at `9c14c90c` stored `_orLastAlts[mapKey]` and compared array identity on each call. The committed dispatch path needs the same guard — if `alts !== _orLastAlts[mapKey]`, it must fall through to the speculative slow path.

## Real-World Impact

The Jess css-parser's `main` production is called with different `alt` arrays:
- Top-level stylesheet: `[atRule, qualifiedRule]` (2 alts)
- Inside `declarationList`: `[innerAtRule, declaration, qualifiedRule, Semi]` (4 alts)

Both route through the same RULE-wrapped `main`, sharing the same fast-dispatch mapKey. The first call caches for 2 alts; the second call crashes when the committed dispatch tries to use that cache with 4 alts.

## Commits to Examine

| Commit | Status | Tests |
|--------|--------|-------|
| `9c14c90c` fix: skip OR fast-dispatch when alts array identity changes | **GOOD** | 77/95 |
| `1ec5ccf4` feat: pre-populate OR fast maps from GAST | unknown | — |
| `8d727706` feat: structural committed dispatch for OR fast path | unknown | — |
| `e8ac31f0` feat: zero-overhead committed dispatch for OR | **BROKEN** | 46/95 |

The regression is somewhere in the committed dispatch path. The `_orLastAlts` identity check needs to be preserved in whatever dispatch strategy is used.
