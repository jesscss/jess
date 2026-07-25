# Pre-push Check TODOs

Generated: 2026-07-23T00:11:18.750Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/core` - `pnpm exec eslint packages/core/src/ast/__tests__/mixin-dispatch-arguments.test.ts packages/core/src/ast/__tests__/plugin-direct-body-scope.test.ts packages/core/src/ast/__tests__/rule-placement-direct-acceptance.test.ts packages/core/src/ast/__tests__/value-access-direct-acceptance.test.ts packages/core/src/ast/__tests__/value-define-function.test.ts packages/core/src/ast/__tests__/value-list.test.ts packages/core/src/ast/__tests__/value-operate-units.test.ts packages/core/src/ast/evaluator.ts packages/core/src/ast/functions/types.ts packages/core/src/ast/guard.ts packages/core/src/ast/mixin-dispatch.ts packages/core/src/ast/nodes.ts packages/core/src/ast/serialize-value.ts packages/core/src/ast/serialize.ts packages/core/src/ast/value-dispatch.ts packages/core/src/ast/value-eval.ts packages/core/src/ast/value-factory.ts packages/core/src/ast/value-guards.ts packages/core/src/ast/value-list.ts packages/core/src/ast/value-operate.ts packages/core/src/tree/__tests__/ampersand.test.ts packages/core/src/tree/__tests__/control.test.ts packages/core/src/tree/__tests__/declaration.test.ts packages/core/src/tree/__tests__/extend-eval-integration.test.ts packages/core/src/tree/__tests__/mixin.test.ts packages/core/src/tree/__tests__/node-flags.test.ts packages/core/src/tree/__tests__/node-render-buffer.test.ts packages/core/src/tree/__tests__/selector-complex.test.ts packages/core/src/tree/__tests__/selector-compound.test.ts packages/core/src/tree/__tests__/selector-list.test.ts packages/core/src/tree/__tests__/selector-render-contract.test.ts packages/core/src/tree/__tests__/selector.test.ts packages/core/src/tree/__tests__/static-name-predicate.test.ts packages/core/src/tree/__tests__/string-normalized-eval.test.ts packages/core/src/tree/extend/__tests__/corpus-algorithm-cases.test.ts packages/core/src/tree/extend/__tests__/corpus-simplified-cases.test.ts packages/core/src/tree/index.ts packages/core/src/tree/tree.ts packages/core/src/tree/util/__tests__/callable-args.test.ts packages/core/src/tree/util/__tests__/callable-param-match.test.ts packages/core/src/tree/util/__tests__/cloning.test.ts packages/core/src/value.ts packages/core/test/flags-isolation.test.ts` (exit 1)
2. [ ] `packages/jess` - `pnpm exec eslint packages/jess/test/cli.test.ts packages/jess/test/less/all-less.test.ts packages/jess/test/less/at-rule-bubbling-bugs.test.ts packages/jess/test/less/namespaced-mixin-value.test.ts packages/jess/test/less/percent-format-eval.test.ts packages/jess/test/path-resolution.test.ts packages/jess/test/plugin-js-auto-wire.test.ts` (exit 1)

## Failure Details
### 1) packages/core

- Command: `pnpm exec eslint packages/core/src/ast/__tests__/mixin-dispatch-arguments.test.ts packages/core/src/ast/__tests__/plugin-direct-body-scope.test.ts packages/core/src/ast/__tests__/rule-placement-direct-acceptance.test.ts packages/core/src/ast/__tests__/value-access-direct-acceptance.test.ts packages/core/src/ast/__tests__/value-define-function.test.ts packages/core/src/ast/__tests__/value-list.test.ts packages/core/src/ast/__tests__/value-operate-units.test.ts packages/core/src/ast/evaluator.ts packages/core/src/ast/functions/types.ts packages/core/src/ast/guard.ts packages/core/src/ast/mixin-dispatch.ts packages/core/src/ast/nodes.ts packages/core/src/ast/serialize-value.ts packages/core/src/ast/serialize.ts packages/core/src/ast/value-dispatch.ts packages/core/src/ast/value-eval.ts packages/core/src/ast/value-factory.ts packages/core/src/ast/value-guards.ts packages/core/src/ast/value-list.ts packages/core/src/ast/value-operate.ts packages/core/src/tree/__tests__/ampersand.test.ts packages/core/src/tree/__tests__/control.test.ts packages/core/src/tree/__tests__/declaration.test.ts packages/core/src/tree/__tests__/extend-eval-integration.test.ts packages/core/src/tree/__tests__/mixin.test.ts packages/core/src/tree/__tests__/node-flags.test.ts packages/core/src/tree/__tests__/node-render-buffer.test.ts packages/core/src/tree/__tests__/selector-complex.test.ts packages/core/src/tree/__tests__/selector-compound.test.ts packages/core/src/tree/__tests__/selector-list.test.ts packages/core/src/tree/__tests__/selector-render-contract.test.ts packages/core/src/tree/__tests__/selector.test.ts packages/core/src/tree/__tests__/static-name-predicate.test.ts packages/core/src/tree/__tests__/string-normalized-eval.test.ts packages/core/src/tree/extend/__tests__/corpus-algorithm-cases.test.ts packages/core/src/tree/extend/__tests__/corpus-simplified-cases.test.ts packages/core/src/tree/index.ts packages/core/src/tree/tree.ts packages/core/src/tree/util/__tests__/callable-args.test.ts packages/core/src/tree/util/__tests__/callable-param-match.test.ts packages/core/src/tree/util/__tests__/cloning.test.ts packages/core/src/value.ts packages/core/test/flags-isolation.test.ts`
- Exit: `1`

```
/Users/matthew/git/oss/jess/packages/core/src/ast/mixin-dispatch.ts
  249:8  warning  Function 'selectDefinitions' has too many parameters (7). Maximum allowed is 6  max-params

/Users/matthew/git/oss/jess/packages/core/src/ast/serialize.ts
    38:3   warning  'isLiteralNode' is defined but never used. Allowed unused vars must match /^_/u                                                                                     @typescript-eslint/no-unused-vars
    69:3   warning  'PropertyReference' is defined but never used. Allowed unused vars must match /^_/u                                                                                 @typescript-eslint/no-unused-vars
    87:78  warning  'Plugin' is defined but never used. Allowed unused vars must match /^_/u                                                                                            @typescript-eslint/no-unused-vars
   270:10  warning  Prefer using an optional chain expression instead, as it's more concise and easier to read                                                                          @typescript-eslint/prefer-optional-chain
   781:10  warning  'lookupMixinCandidates' is defined but never used. Allowed unused vars must match /^_/u                                                                             @typescript-eslint/no-unused-vars
  1532:13  warning  Blocks are nested too deeply (6). Maximum allowed is 5                                                                                                              max-depth
  1534:15  warning  Blocks are nested too deeply (7). Maximum allowed is 5                                                                                                              max-depth
  1538:15  warning  Blocks are nested too deeply (7). Maximum allowed is 5                                                                                                              max-depth
  1541:17  warning  Blocks are nested too deeply (8). Maximum allowed is 5                                                                                                              max-depth
  1548:15  warning  Blocks are nested too deeply (7). Maximum allowed is 5                                                                                                              max-depth
  1554:13  warning  Blocks are nested too deeply (6). Maximum allowed is 5                                                                                                              max-depth
  1827:7   warning  'BARE_SLASH_OPERATORS' is assigned a value but never used. Allowed unused vars must match /^_/u                                                                     @typescript-eslint/no-unused-vars
  2455:13  warning  Blocks are nested too deeply (6). Maximum allowed is 5                                                                                                              max-depth
  2676:3   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  3707:1   warning  Function 'putValue' has too many parameters (7). Maximum allowed is 6                                                                                               max-params
  3931:1   warning  Function 'collectPlacedExtendFacts' has too many parameters (9). Maximum allowed is 6                                                                               max-params
  4671:1   warning  Function 'flattenResolved' has too many parameters (7). Maximum allowed is 6                                                                                        max-params
  4711:1   warning  Function 'flattenWithHeader' has too many parameters (8). Maximum allowed is 6                                                                                      max-params
  4821:7   warning  Prefer using an optional chain expression instead, as it's more concise and easier to read                                                                          @typescript-eslint/prefer-optional-chain
  4851:1   warning  Function 'walkBody' has too many parameters (12). Maximum allowed is 6                                                                                              max-params
  5284:1   warning  Function 'expandCall' has too many parameters (13). Maximum allowed is 6                                                                                            max-params
  5455:1   warning  Function 'expandApply' has too many parameters (11). Maximum allowed is 6                                                                                           max-params
  5514:10  warning  'descendNamespacePath' is defined but never used. Allowed unused vars must match /^_/u                                                                              @typescript-eslint/no-unused-vars
  5702:10  warning  'resolveToMixinCall' is defined but never used. Allowed unused vars must match /^_/u                                                                                @typescript-eslint/no-unused-vars
  5788:1   warning  Function 'expandReferenceCall' has too many parameters (11). Maximum allowed is 6                                                                                   max-params
  6020:3   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  6161:1   warning  Function 'expandFor' has too many parameters (12). Maximum allowed is 6                                                                                             max-params
  6575:36  error    Unsafe type assertion: type 'ValueNode' is more narrow than the original type                                                                                       @typescript-eslint/no-unsafe-type-assertion
  6674:5   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  6682:5   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7611:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7617:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7631:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7654:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7657:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7660:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  7663:9   warning  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
  8122:1   warning  Function 'emitNestedBody' has too many parameters (9). Maximum allowed is 6                                                                                         max-params
  8648:1   warning  Function 'expandNestedCall' has too many parameters (7). Maximum allowed is 6                                                                                       max-params
  8801:1   warning  Function 'expandNestedReferenceCall' has too many parameters (7). Maximum allowed is 6                                                                              max-params
  8841:1   warning  Function 'expandNestedFor' has too many parameters (7). Maximum allowed is 6                                                                                        max-params

/Users/matthew/git/oss/jess/packages/core/src/tree/index.ts
  23:25  warning  './util/compare.js' imported multiple times  import/no-duplicates
  81:33  warning  './util/compare.js' imported multiple times  import/no-duplicates

✖ 44 problems (1 error, 43 warnings)
```

### 2) packages/jess

- Command: `pnpm exec eslint packages/jess/test/cli.test.ts packages/jess/test/less/all-less.test.ts packages/jess/test/less/at-rule-bubbling-bugs.test.ts packages/jess/test/less/namespaced-mixin-value.test.ts packages/jess/test/less/percent-format-eval.test.ts packages/jess/test/path-resolution.test.ts packages/jess/test/plugin-js-auto-wire.test.ts`
- Exit: `1`

```
/Users/matthew/git/oss/jess/packages/jess/test/less/percent-format-eval.test.ts
  31:30  error  Strings must use singlequote  @stylistic/quotes
  32:27  error  Strings must use singlequote  @stylistic/quotes

/Users/matthew/git/oss/jess/packages/jess/test/path-resolution.test.ts
  224:79  error  Expected { after 'if' condition  curly
  225:79  error  Expected { after 'if' condition  curly
  228:12  error  Unexpected trailing comma        @stylistic/comma-dangle
  229:11  error  Unexpected trailing comma        @stylistic/comma-dangle
  231:50  error  Unexpected trailing comma        @stylistic/comma-dangle

/Users/matthew/git/oss/jess/packages/jess/test/plugin-js-auto-wire.test.ts
  77:14  warning  ["createJsPluginProxy"] is better written in dot notation  dot-notation

✖ 8 problems (7 errors, 1 warning)
  7 errors and 1 warning potentially fixable with the `--fix` option.
```

