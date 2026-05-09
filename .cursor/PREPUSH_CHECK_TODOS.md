# Pre-push Check TODOs

Generated: 2026-05-09T02:03:32.528Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/core` - `pnpm exec eslint packages/core/src/define-function.ts packages/core/src/tree/__tests__/call.test.ts packages/core/src/tree/__tests__/control.test.ts packages/core/src/tree/__tests__/declaration.test.ts packages/core/src/tree/__tests__/reference.test.ts packages/core/src/tree/call.ts packages/core/src/tree/declaration.ts packages/core/src/tree/reference.ts packages/core/src/tree/rules.ts packages/core/src/tree/util/cloning.ts` (exit 1)

## Failure Details
### 1) packages/core

- Command: `pnpm exec eslint packages/core/src/define-function.ts packages/core/src/tree/__tests__/call.test.ts packages/core/src/tree/__tests__/control.test.ts packages/core/src/tree/__tests__/declaration.test.ts packages/core/src/tree/__tests__/reference.test.ts packages/core/src/tree/call.ts packages/core/src/tree/declaration.ts packages/core/src/tree/reference.ts packages/core/src/tree/rules.ts packages/core/src/tree/util/cloning.ts`
- Exit: `1`

```
/Users/matthew/git/oss/jess/packages/core/src/define-function.ts
     8:16   warning  'Sequence' is defined but never used. Allowed unused vars must match /^_/u                      @typescript-eslint/no-unused-vars
     8:26   warning  'Operation' is defined but never used. Allowed unused vars must match /^_/u                     @typescript-eslint/no-unused-vars
     8:37   warning  'Num' is defined but never used. Allowed unused vars must match /^_/u                           @typescript-eslint/no-unused-vars
   168:3    warning  'T' is defined but never used. Allowed unused vars must match /^_/u                             @typescript-eslint/no-unused-vars
   264:18   error    Unsafe type assertion: type 'NamedFunction' is more narrow than the original type               @typescript-eslint/no-unsafe-type-assertion
   267:15   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   272:9    error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion           @typescript-eslint/no-unsafe-type-assertion
   273:15   error    Unsafe type assertion: type 'readonly ParamDefinition[]' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   289:13   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   308:15   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   322:9    error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   338:24   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   342:13   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   345:18   error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion           @typescript-eslint/no-unsafe-type-assertion
   345:19   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   346:19   error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion           @typescript-eslint/no-unsafe-type-assertion
   346:20   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   368:14   error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion           @typescript-eslint/no-unsafe-type-assertion
   371:18   error    Unsafe type assertion: type 'readonly ParamDefinition[]' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   419:19   error    Unsafe type assertion: type 'Error' is more narrow than the original type                       @typescript-eslint/no-unsafe-type-assertion
   452:8    error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   453:14   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   456:13   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   493:44   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   529:14   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   561:12   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   588:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   611:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   614:12   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   627:12   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   654:53   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   665:25   error    Unsafe type assertion: type 'string' is more narrow than the original type                      @typescript-eslint/no-unsafe-type-assertion
   681:12   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   707:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   710:12   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   714:73   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   731:12   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   740:66   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   750:15   warning  'callerName' is assigned a value but never used. Allowed unused vars must match /^_/u           @typescript-eslint/no-unused-vars
   772:10   warning  'validateCallWithContextArgs' is defined but never used. Allowed unused vars must match /^_/u   @typescript-eslint/no-unused-vars
   782:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   787:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   792:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   839:23   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   887:10   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   894:21   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety        @typescript-eslint/no-unsafe-type-assertion
   962:27   error    Unsafe type assertion: type 'ArgType' is more narrow than the original type                     @typescript-eslint/no-unsafe-type-assertion
   977:10   warning  'validateArrayElements' is defined but never used. Allowed unused vars must match /^_/u         @typescript-eslint/no-unused-vars
   977:109  warning  'context' is assigned a value but never used. Allowed unused args must match /^_/u              @typescript-eslint/no-unused-vars
  1047:28   error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion           @typescript-eslint/no-unsafe-type-assertion

✖ 50 problems (42 errors, 8 warnings)
```

