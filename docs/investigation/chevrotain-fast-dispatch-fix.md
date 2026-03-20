# Chevrotain Fork: Auto-Occurrence Already Works — Ambiguity Validation Is the Real Issue

## Investigation Result

The described fast-dispatch collision bug (multiple `OR()` calls sharing `occurrence = 0`) **does not exist**. The fork already auto-assigns occurrence numbers via `_dslCounter` in `recognizer_api.ts`. Every DSL call increments a per-rule counter automatically, so `OR`, `OR1`, `OR2` etc. all get unique keys.

A test was written and added to the fork at `packages/chevrotain/test/full_flow/multiple_or_spec.ts` confirming this — 10 tests all pass, including multiple plain `OR()` calls in the same rule.

## The Actual Problem

The real issue is **ambiguity validation throwing errors** during `performSelfAnalysis()`. The fork's speculative backtracking engine handles ambiguous alternatives correctly at runtime, but the LL(k) ambiguity validation (inherited from upstream Chevrotain) still treats them as fatal errors and throws during parser construction.

Detected ambiguities in the css-parser:
- `customBlock`: `<GenericFunctionStart>` in multiple alts
- `mathValue`: `<MathConstant>` in multiple alts
- `mediaFeature`: `<MfLt, Ident>` and `<MfGt, Ident>` in multiple alts

These are all correctly resolved by speculative backtracking at runtime.

## Current Workaround

`skipValidations: true` in the parser config. This skips ALL validation including useful checks like left recursion detection.

## What Needs to Be Fixed in the Fork

See `chevrotain-ambiguity-handling.md` for the full plan. Summary:

1. Ambiguity detection should **warn**, not throw
2. Left recursion detection should remain a hard error (causes infinite loops)
3. Consider `IParserConfig.ambiguityHandling: 'error' | 'warn' | 'ignore'`
