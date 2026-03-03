# Pre-push Check TODOs

Generated: 2026-03-03T23:27:00.555Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/core` - `pnpm exec eslint packages/core/src/tree/__tests__/mixin.test.ts packages/core/src/tree/__tests__/reference.test.ts packages/core/src/tree/declaration.ts packages/core/src/tree/interpolated.ts packages/core/src/tree/rules.ts packages/core/src/tree/selector-basic.ts packages/core/src/tree/util/registry-utils.ts` (exit 1)

## Failure Details
### 1) packages/core

- Command: `pnpm exec eslint packages/core/src/tree/__tests__/mixin.test.ts packages/core/src/tree/__tests__/reference.test.ts packages/core/src/tree/declaration.ts packages/core/src/tree/interpolated.ts packages/core/src/tree/rules.ts packages/core/src/tree/selector-basic.ts packages/core/src/tree/util/registry-utils.ts`
- Exit: `1`

```
/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts
   604:59  warning  'context' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars
   923:61  warning  'context' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars
  1151:12  warning  'idx' is assigned a value but never used. Allowed unused vars must match /^_/u                        @typescript-eslint/no-unused-vars
  1600:17  warning  'collectGeneratedLeadingIs' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1639:17  warning  'hasReplaceReplaceExtend' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars
  1646:17  warning  'hasRepAceExtend' is assigned a value but never used. Allowed unused vars must match /^_/u            @typescript-eslint/no-unused-vars
  1815:17  warning  'isList1Ref' is assigned a value but never used. Allowed unused vars must match /^_/u                 @typescript-eslint/no-unused-vars
  1896:19  warning  'i' is defined but never used. Allowed unused args must match /^_/u                                   @typescript-eslint/no-unused-vars
  2143:7   warning  'candidateEvalIndex' is assigned a value but never used. Allowed unused vars must match /^_/u         @typescript-eslint/no-unused-vars
  2349:17  warning  'candidateName' is assigned a value but never used. Allowed unused vars must match /^_/u              @typescript-eslint/no-unused-vars

/Users/matthew/git/oss/jess/packages/core/src/tree/selector-basic.ts
  5:15  warning  'MaybePromise' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts
   302:47  warning  'filterType' is defined but never used. Allowed unused args must match /^_/u                        @typescript-eslint/no-unused-vars
   302:68  warning  'options' is defined but never used. Allowed unused args must match /^_/u                           @typescript-eslint/no-unused-vars
   350:13  warning  'selectorStr' is assigned a value but never used. Allowed unused vars must match /^_/u              @typescript-eslint/no-unused-vars
   571:13  warning  'usedOwnSelectorFallback' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
   724:13  warning  'activeFile' is assigned a value but never used. Allowed unused vars must match /^_/u               @typescript-eslint/no-unused-vars
  1263:13  error    Closing curly brace does not appear on the same line as the subsequent block                        @stylistic/brace-style

✖ 17 problems (1 error, 16 warnings)
```

