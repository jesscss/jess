# Pre-push Check TODOs

Generated: 2026-04-13T14:02:49.541Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/jess-parser` - `pnpm -w exec tsc -p packages/jess-parser/tsconfig.build.json --noEmit` (exit 2)
2. [ ] `packages/jess-parser` - `pnpm --filter ./packages/jess-parser build` (exit 1)
3. [ ] `packages/jess-parser` - `pnpm exec eslint packages/jess-parser/src/productions/atRules.ts packages/jess-parser/src/productions/controlFlow.ts packages/jess-parser/src/productions/mixins.ts packages/jess-parser/src/productions/root.ts packages/jess-parser/src/productions/values.ts` (exit 1)
4. [ ] `packages/jess-plugin-less-compat` - `pnpm -w exec tsc -p packages/jess-plugin-less-compat/tsconfig.build.json --noEmit` (exit 2)
5. [ ] `packages/less-parser` - `pnpm -w exec tsc -p packages/less-parser/tsconfig.build.json --noEmit` (exit 2)

## Failure Details
### 1) packages/jess-parser

- Command: `pnpm -w exec tsc -p packages/jess-parser/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/jess-parser/src/jessParser.ts(36,3): error TS2394: This overload signature is not compatible with its implementation signature.
packages/jess-parser/src/jessParser.ts(38,23): error TS2322: Type '"stylesheet"' is not assignable to type '"jessComposeAtRule" | "jessFromAtRule" | "jessExportAtRule" | "jessComparison" | "jessConditionInParens" | "jessIfStatement" | "jessForStatement" | "jessMixinParams" | "jessGuard" | ... 10 more ... | "expressionValue"'.
packages/jess-parser/src/jessParser.ts(41,12): error TS2339: Property 'warnings' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessParser.ts(43,14): error TS2339: Property 'context' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessParser.ts(45,12): error TS2339: Property 'input' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessParser.ts(52,33): error TS2339: Property 'warnings' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessParser.ts(57,22): error TS2339: Property 'errors' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessRecursiveParser.ts(6,3): error TS2305: Module '"@jesscss/scss-parser"' has no exported member 'ScssRecursiveParser'.
packages/jess-parser/src/jessRecursiveParser.ts(85,14): error TS2339: Property 'OVERRIDE_RULE' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessRecursiveParser.ts(87,14): error TS2339: Property 'RULE' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/jessRecursiveParser.ts(92,12): error TS2339: Property 'performSelfAnalysis' does not exist on type 'JessRecursiveParser'.
packages/jess-parser/src/productions/controlFlow.ts(164,21): error TS2353: Object literal may only specify known properties, and 'conditions' does not exist in type 'IfValue'.
packages/jess-parser/src/productions/controlFlow.ts(201,28): error TS2322: Type 'Node<unknown, NodeOptions>' is not assignable to type 'ForIterable'.
  Property 'kind' is missing in type 'Node<unknown, NodeOptions>' but required in type '{ kind: "node"; value: Node<unknown, NodeOptions>; }'.
packages/jess-parser/src/productions/values.ts(4,10): error TS2305: Module '"@jesscss/scss-parser"' has no exported member 'scssValueProduction'.
```

### 2) packages/jess-parser

- Command: `pnpm --filter ./packages/jess-parser build`
- Exit: `1`

```
> @jesscss/jess-parser@2.0.0-alpha.5 build /Users/matthew/git/oss/jess/packages/jess-parser
> pnpm clean && pnpm compile


> @jesscss/jess-parser@2.0.0-alpha.5 clean /Users/matthew/git/oss/jess/packages/jess-parser
> shx rm -rf ./lib tsconfig.tsbuildinfo


> @jesscss/jess-parser@2.0.0-alpha.5 compile /Users/matthew/git/oss/jess/packages/jess-parser
> tsdown --tsconfig tsconfig.build.json && tsc -p tsconfig.build.json --emitDeclarationOnly

ℹ tsdown v0.21.7 powered by rolldown v1.0.0-rc.12
ℹ entry: src/index.ts
ℹ tsconfig: tsconfig.build.json
ℹ Build start
ℹ Hint: consider adding deps.onlyBundle option to avoid unintended bundling of dependencies, or set deps.onlyBundle: false to disable this hint.
See more at https://tsdown.dev/options/dependencies#deps-onlybundle
Detected dependencies in bundle:
- type-fest
ℹ dist/index.mjs    35.96 kB │ gzip: 8.03 kB
ℹ dist/index.d.mts   8.13 kB │ gzip: 2.82 kB
ℹ 2 files, total: 44.09 kB
✔ Build complete in 549ms
src/jessParser.ts(36,3): error TS2394: This overload signature is not compatible with its implementation signature.
src/jessParser.ts(38,23): error TS2322: Type '"stylesheet"' is not assignable to type '"jessComposeAtRule" | "jessFromAtRule" | "jessExportAtRule" | "jessComparison" | "jessConditionInParens" | "jessIfStatement" | "jessForStatement" | "jessMixinParams" | "jessGuard" | ... 10 more ... | "expressionValue"'.
src/jessParser.ts(41,12): error TS2339: Property 'warnings' does not exist on type 'JessRecursiveParser'.
src/jessParser.ts(43,14): error TS2339: Property 'context' does not exist on type 'JessRecursiveParser'.
src/jessParser.ts(45,12): error TS2339: Property 'input' does not exist on type 'JessRecursiveParser'.
src/jessParser.ts(52,33): error TS2339: Property 'warnings' does not exist on type 'JessRecursiveParser'.
src/jessParser.ts(57,22): error TS2339: Property 'errors' does not exist on type 'JessRecursiveParser'.
src/jessRecursiveParser.ts(6,3): error TS2305: Module '"@jesscss/scss-parser"' has no exported member 'ScssRecursiveParser'.
src/jessRecursiveParser.ts(85,14): error TS2339: Property 'OVERRIDE_RULE' does not exist on type 'JessRecursiveParser'.
src/jessRecursiveParser.ts(87,14): error TS2339: Property 'RULE' does not exist on type 'JessRecursiveParser'.
src/jessRecursiveParser.ts(92,12): error TS2339: Property 'performSelfAnalysis' does not exist on type 'JessRecursiveParser'.
src/productions/controlFlow.ts(164,21): error TS2353: Object literal may only specify known properties, and 'conditions' does not exist in type 'IfValue'.
src/productions/controlFlow.ts(201,28): error TS2322: Type 'Node<unknown, NodeOptions>' is not assignable to type 'ForIterable'.
  Property 'kind' is missing in type 'Node<unknown, NodeOptions>' but required in type '{ kind: "node"; value: Node<unknown, NodeOptions>; }'.
src/productions/values.ts(4,10): error TS2305: Module '"@jesscss/scss-parser"' has no exported member 'scssValueProduction'.
 ELIFECYCLE  Command failed with exit code 2.
/Users/matthew/git/oss/jess/packages/jess-parser:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/jess-parser@2.0.0-alpha.5 build: `pnpm clean && pnpm compile`
Exit status 1
```

### 3) packages/jess-parser

- Command: `pnpm exec eslint packages/jess-parser/src/productions/atRules.ts packages/jess-parser/src/productions/controlFlow.ts packages/jess-parser/src/productions/mixins.ts packages/jess-parser/src/productions/root.ts packages/jess-parser/src/productions/values.ts`
- Exit: `1`

```
/Users/matthew/git/oss/jess/packages/jess-parser/src/productions/atRules.ts
   17:44  warning  'T' is defined but never used. Allowed unused args must match /^_/u         @typescript-eslint/no-unused-vars
   23:30  error    Unsafe type assertion: type 'Quoted' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   33:23  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   58:41  warning  'T' is defined but never used. Allowed unused args must match /^_/u         @typescript-eslint/no-unused-vars
   64:30  error    Unsafe type assertion: type 'Quoted' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   82:29  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   96:43  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  104:48  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  124:43  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  132:48  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  167:43  warning  'T' is defined but never used. Allowed unused args must match /^_/u         @typescript-eslint/no-unused-vars
  173:30  error    Unsafe type assertion: type 'Quoted' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  183:23  error    Unsafe type assertion: type 'IToken' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  203:40  warning  'T' is defined but never used. Allowed unused args must match /^_/u         @typescript-eslint/no-unused-vars

/Users/matthew/git/oss/jess/packages/jess-parser/src/productions/controlFlow.ts
   21:41  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                @typescript-eslint/no-unused-vars
   26:18  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
   29:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   39:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   41:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   43:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   45:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   47:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   49:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   51:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
   53:19  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
   61:47  error    Unsafe type assertion: type '"=" | ">" | "<" | ">=" | "<="' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   93:48  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                @typescript-eslint/no-unused-vars
  101:18  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
  103:20  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
  121:42  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                @typescript-eslint/no-unused-vars
  130:23  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
  133:23  error    Unsafe type assertion: type 'Rules' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  145:22  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
  148:22  error    Unsafe type assertion: type 'Rules' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  154:22  error    Unsafe type assertion: type 'Rules' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  171:43  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                @typescript-eslint/no-unused-vars
  179:24  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
  182:22  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type     @typescript-eslint/no-unsafe-type-assertion
  186:19  error    Unsafe type assertion: type 'Rules' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion

/Users/matthew/git/oss/jess/packages/jess-parser/src/productions/mixins.ts
   24:42  warning  'T' is defined but never used. Allowed unused args must match /^_/u                               @typescript-eslint/no-unused-vars
   37:30  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                        @typescript-eslint/no-unsafe-type-assertion
   45:32  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type    @typescript-eslint/no-unsafe-type-assertion
   68:36  warning  'T' is defined but never used. Allowed unused args must match /^_/u                               @typescript-eslint/no-unused-vars
   72:12  error    Unsafe type assertion: type 'Condition' is more narrow than the original type                     @typescript-eslint/no-unsafe-type-assertion
   81:46  warning  'T' is defined but never used. Allowed unused args must match /^_/u                               @typescript-eslint/no-unused-vars
   89:15  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                        @typescript-eslint/no-unsafe-type-assertion
  105:20  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>[]' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  111:17  error    Unsafe type assertion: type 'Condition' is more narrow than the original type                     @typescript-eslint/no-unsafe-type-assertion
  116:19  error    Unsafe type assertion: type 'Rules' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
  144:40  warning  'T' is defined but never used. Allowed unused args must match /^_/u                               @typescript-eslint/no-unused-vars
  157:22  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                        @typescript-eslint/no-unsafe-type-assertion
  165:19  error    Unsafe type assertion: type 'Reference' is more narrow than the original type                     @typescript-eslint/no-unsafe-type-assertion
  175:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  176:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  177:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  178:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  179:1   error    Expected indentation of 12 spaces but found 10                                                    @stylistic/indent
  180:1   error    Expected indentation of 14 spaces but found 12                                                    @stylistic/indent
  181:1   error    Expected indentation of 14 spaces but found 12                                                    @stylistic/indent
  182:1   error    Expected indentation of 16 spaces but found 14                                                    @stylistic/indent
  182:25  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type    @typescript-eslint/no-unsafe-type-assertion
  183:1   error    Expected indentation of 14 spaces but found 12                                                    @stylistic/indent
  184:1   error    Expected indentation of 12 spaces but found 10                                                    @stylistic/indent
  185:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  186:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  187:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent
  188:1   error    Expected indentation of 10 spaces but found 8                                                     @stylistic/indent

/Users/matthew/git/oss/jess/packages/jess-parser/src/productions/root.ts
   28:41  warning  'T' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars
   33:19  error    Unsafe type assertion: type 'Rules' is more narrow than the original type                       @typescript-eslint/no-unsafe-type-assertion
   44:41  warning  'T' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars
   49:19  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                      @typescript-eslint/no-unsafe-type-assertion
   57:19  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   59:19  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   72:44  warning  'T' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars
   76:18  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
   85:31  warning  'T' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars
  172:42  warning  'T' is defined but never used. Allowed unused args must match /^_/u                             @typescript-eslint/no-unused-vars

/Users/matthew/git/oss/jess/packages/jess-parser/src/productions/values.ts
   24:46  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                   @typescript-eslint/no-unused-vars
   30:19  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type        @typescript-eslint/no-unsafe-type-assertion
   51:39  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                   @typescript-eslint/no-unused-vars
   59:20  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type        @typescript-eslint/no-unsafe-type-assertion
   70:43  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                   @typescript-eslint/no-unused-vars
   76:16  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type        @typescript-eslint/no-unsafe-type-assertion
  107:16  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type        @typescript-eslint/no-unsafe-type-assertion
  119:14  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type        @typescript-eslint/no-unsafe-type-assertion
  137:47  warning  'T' is defined but never used. Allowed unused args must match /^_/u                                   @typescript-eslint/no-unused-vars
  142:19  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  149:24  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  157:28  error    Unsafe type assertion: type 'List<Node<unknown, NodeOptions>>' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  161:23  error    Unsafe type assertion: type 'Reference' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
  173:23  error    Unsafe type assertion: type 'Reference' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
  183:21  error    Unsafe type assertion: type 'Node<unknown, NodeOptions>' is more narrow than the original type        @typescript-eslint/no-unsafe-type-assertion
  187:21  error    Unsafe type assertion: type 'Reference' is more narrow than the original type                         @typescript-eslint/no-unsafe-type-assertion
  251:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  268:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  273:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  278:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  283:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  288:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion
  293:21  error    Unsafe type assertion: type 'IToken' is more narrow than the original type                            @typescript-eslint/no-unsafe-type-assertion

✖ 100 problems (79 errors, 21 warnings)
  14 errors and 0 warnings potentially fixable with the `--fix` option.
```

### 4) packages/jess-plugin-less-compat

- Command: `pnpm -w exec tsc -p packages/jess-plugin-less-compat/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/jess-plugin-less-compat/src/nodes/at-rule.ts(7,18): error TS2339: Property 'get' does not exist on type 'AtRule'.
packages/jess-plugin-less-compat/src/nodes/at-rule.ts(9,25): error TS2339: Property 'get' does not exist on type 'AtRule'.
packages/jess-plugin-less-compat/src/nodes/at-rule.ts(13,23): error TS2339: Property 'get' does not exist on type 'AtRule'.
packages/jess-plugin-less-compat/src/nodes/at-rule.ts(18,21): error TS2339: Property 'get' does not exist on type 'AtRule'.
packages/jess-plugin-less-compat/src/nodes/attribute-selector.ts(8,22): error TS2339: Property 'get' does not exist on type 'AttributeSelector'.
packages/jess-plugin-less-compat/src/nodes/attribute-selector.ts(11,16): error TS2339: Property 'get' does not exist on type 'AttributeSelector'.
packages/jess-plugin-less-compat/src/nodes/attribute-selector.ts(13,23): error TS2339: Property 'get' does not exist on type 'AttributeSelector'.
packages/jess-plugin-less-compat/src/nodes/call.ts(7,18): error TS2339: Property 'get' does not exist on type 'Call'.
packages/jess-plugin-less-compat/src/nodes/call.ts(9,22): error TS2339: Property 'get' does not exist on type 'Call'.
packages/jess-plugin-less-compat/src/nodes/call.ts(23,20): error TS2339: Property 'get' does not exist on type 'Call'.
packages/jess-plugin-less-compat/src/nodes/call.ts(26,27): error TS7006: Parameter 'a' implicitly has an 'any' type.
packages/jess-plugin-less-compat/src/nodes/condition.ts(7,16): error TS2339: Property 'get' does not exist on type 'Condition'.
packages/jess-plugin-less-compat/src/nodes/condition.ts(9,22): error TS2339: Property 'get' does not exist on type 'Condition'.
packages/jess-plugin-less-compat/src/nodes/condition.ts(13,23): error TS2339: Property 'get' does not exist on type 'Condition'.
packages/jess-plugin-less-compat/src/nodes/condition.ts(16,20): error TS2339: Property 'get' does not exist on type 'Condition'.
packages/jess-plugin-less-compat/src/nodes/declaration.ts(7,18): error TS2339: Property 'get' does not exist on type 'Declaration<DeclarationOptions>'.
packages/jess-plugin-less-compat/src/nodes/declaration.ts(9,23): error TS2339: Property 'get' does not exist on type 'Declaration<DeclarationOptions>'.
packages/jess-plugin-less-compat/src/nodes/declaration.ts(12,23): error TS2339: Property 'get' does not exist on type 'Declaration<DeclarationOptions>'.
packages/jess-plugin-less-compat/src/nodes/declaration.ts(17,24): error TS2339: Property 'get' does not exist on type 'Declaration<DeclarationOptions>'.
packages/jess-plugin-less-compat/src/nodes/dimension.ts(6,19): error TS2339: Property 'number' does not exist on type 'Dimension | Num'.
  Property 'number' does not exist on type 'Dimension'.
packages/jess-plugin-less-compat/src/nodes/dimension.ts(7,57): error TS2339: Property 'unit' does not exist on type 'Dimension'.
packages/jess-plugin-less-compat/src/nodes/expression.ts(8,23): error TS2339: Property 'get' does not exist on type 'Expression'.
packages/jess-plugin-less-compat/src/nodes/extend.ts(8,26): error TS2339: Property 'get' does not exist on type 'Extend'.
packages/jess-plugin-less-compat/src/nodes/extend.ts(11,20): error TS2339: Property 'get' does not exist on type 'Extend'.
packages/jess-plugin-less-compat/src/nodes/import.ts(8,24): error TS2339: Property 'get' does not exist on type 'StyleImport'.
packages/jess-plugin-less-compat/src/nodes/list.ts(6,21): error TS2339: Property 'get' does not exist on type 'List<Node<unknown, NodeOptions>>'.
packages/jess-plugin-less-compat/src/nodes/list.ts(42,24): error TS2339: Property 'get' does not exist on type 'List<Node<unknown, NodeOptions>>'.
packages/jess-plugin-less-compat/src/nodes/mixin.ts(7,18): error TS2339: Property 'get' does not exist on type 'Mixin'.
packages/jess-plugin-less-compat/src/nodes/mixin.ts(9,24): error TS2339: Property 'get' does not exist on type 'Mixin'.
packages/jess-plugin-less-compat/src/nodes/mixin.ts(13,23): error TS2339: Property 'get' does not exist on type 'Mixin'.
packages/jess-plugin-less-compat/src/nodes/mixin.ts(17,23): error TS2339: Property 'get' does not exist on type 'Mixin'.
packages/jess-plugin-less-compat/src/nodes/negative.ts(8,23): error TS2339: Property 'get' does not exist on type 'Negative'.
packages/jess-plugin-less-compat/src/nodes/operation.ts(7,16): error TS2339: Property 'get' does not exist on type 'Operation'.
packages/jess-plugin-less-compat/src/nodes/operation.ts(10,22): error TS2339: Property 'get' does not exist on type 'Operation'.
packages/jess-plugin-less-compat/src/nodes/operation.ts(11,23): error TS2339: Property 'get' does not exist on type 'Operation'.
packages/jess-plugin-less-compat/src/nodes/paren.ts(8,23): error TS2339: Property 'get' does not exist on type 'Paren'.
packages/jess-plugin-less-compat/src/nodes/quoted.ts(7,23): error TS2339: Property 'get' does not exist on type 'Quoted'.
packages/jess-plugin-less-compat/src/nodes/quoted.ts(15,29): error TS2339: Property 'get' does not exist on type 'Interpolated<any>'.
packages/jess-plugin-less-compat/src/nodes/quoted.ts(19,19): error TS2339: Property 'quote' does not exist on type 'Quoted'.
packages/jess-plugin-less-compat/src/nodes/quoted.ts(20,21): error TS2339: Property 'escaped' does not exist on type 'Quoted'.
packages/jess-plugin-less-compat/src/nodes/reference.ts(23,23): error TS2339: Property 'get' does not exist on type 'Reference'.
packages/jess-plugin-less-compat/src/nodes/ruleset.ts(8,27): error TS2339: Property 'get' does not exist on type 'Ruleset<RulesetValue>'.
packages/jess-plugin-less-compat/src/nodes/ruleset.ts(13,25): error TS2339: Property 'get' does not exist on type 'SelectorList'.
packages/jess-plugin-less-compat/src/nodes/ruleset.ts(18,24): error TS2339: Property 'get' does not exist on type 'Ruleset<RulesetValue>'.
packages/jess-plugin-less-compat/src/nodes/ruleset.ts(23,30): error TS2339: Property 'get' does not exist on type 'Ruleset<RulesetValue>'.
packages/jess-plugin-less-compat/src/nodes/ruleset.ts(24,27): error TS2339: Property 'get' does not exist on type 'Ruleset<RulesetValue>'.
packages/jess-plugin-less-compat/src/nodes/ruleset.ts(29,40): error TS2339: Property 'get' does not exist on type 'SelectorList'.
packages/jess-plugin-less-compat/src/nodes/selector.ts(30,40): error TS2339: Property 'get' does not exist on type 'SelectorList'.
packages/jess-plugin-less-compat/src/nodes/selector.ts(38,33): error TS2339: Property 'get' does not exist on type 'ComplexSelector'.
packages/jess-plugin-less-compat/src/nodes/selector.ts(52,41): error TS2339: Property 'get' does not exist on type 'CompoundSelector'.
packages/jess-plugin-less-compat/src/nodes/selector.ts(72,39): error TS2339: Property 'get' does not exist on type 'CompoundSelector'.
packages/jess-plugin-less-compat/src/nodes/sequence.ts(9,12): error TS2339: Property 'get' does not exist on type 'Sequence'.
packages/jess-plugin-less-compat/src/nodes/sequence.ts(13,12): error TS2339: Property 'get' does not exist on type 'Sequence'.
packages/jess-plugin-less-compat/src/nodes/sequence.ts(18,24): error TS2339: Property 'get' does not exist on type 'Sequence'.
packages/jess-plugin-less-compat/src/nodes/sequence.ts(25,21): error TS2339: Property 'get' does not exist on type 'Sequence'.
packages/jess-plugin-less-compat/src/nodes/sequence.ts(49,30): error TS2339: Property 'get' does not exist on type 'Sequence'.
packages/jess-plugin-less-compat/src/nodes/sequence.ts(51,15): error TS2339: Property 'setData' does not exist on type 'Sequence'.
packages/jess-plugin-less-compat/src/nodes/url.ts(8,23): error TS2339: Property 'get' does not exist on type 'Url'.
packages/jess-plugin-less-compat/src/nodes/var-declaration.ts(7,18): error TS2339: Property 'get' does not exist on type 'VarDeclaration'.
packages/jess-plugin-less-compat/src/nodes/var-declaration.ts(9,23): error TS2339: Property 'get' does not exist on type 'VarDeclaration'.
packages/jess-plugin-less-compat/src/nodes/var-declaration.ts(18,21): error TS2339: Property 'get' does not exist on type 'VarDeclaration'.
packages/jess-plugin-less-compat/src/plugin.ts(1096,19): error TS2322: Type 'typeof import("/Users/matthew/git/oss/jess/packages/core/lib/tree/node-base").REMOVE' is not assignable to type 'Node<unknown, NodeOptions>'.
packages/jess-plugin-less-compat/src/plugin.ts(1124,7): error TS1360: Type '{ atRule: (node: any, _ctx?: any) => any; visit: (node: Node) => Node; }' does not satisfy the expected type 'Visitor'.
  Type '{ atRule: (node: any, _ctx?: any) => any; visit: (node: Node<unknown, NodeOptions>) => Node<unknown, NodeOptions>; }' is missing the following properties from type 'Visitor': _methodMap, startNode, getMethod, _visit, visitExit
packages/jess-plugin-less-compat/src/plugin.ts(1126,5): error TS2322: Type '{ atRule: (node: any, _ctx?: any) => any; visit: (node: Node) => Node; }' is not assignable to type 'Visitor | Visitor[] | undefined'.
  Type '{ atRule: (node: any, _ctx?: any) => any; visit: (node: Node<unknown, NodeOptions>) => Node<unknown, NodeOptions>; }' is missing the following properties from type 'Visitor': _methodMap, startNode, getMethod, _visit, visitExit
```

### 5) packages/less-parser

- Command: `pnpm -w exec tsc -p packages/less-parser/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/less-parser/src/productions/guards.ts(41,25): error TS2339: Property 'name' does not exist on type 'Call'.
packages/less-parser/src/productions/guards.ts(637,15): error TS2322: Type 'Quoted' is not assignable to type 'string | Interpolated<AnyRole>'.
  Type 'Quoted' is missing the following properties from type 'Interpolated<AnyRole>': replace, createSelector, createGeneric, evalToSelector, _evalToInterpolated
packages/less-parser/src/productions/guards.ts(714,38): error TS2345: Argument of type '(Node<unknown, NodeOptions> | DeclarationValue<"property">)[]' is not assignable to parameter of type 'Node<unknown, NodeOptions>[]'.
  Type 'Node<unknown, NodeOptions> | DeclarationValue<"property">' is not assignable to type 'Node<unknown, NodeOptions>'.
    Type 'DeclarationValue<"property">' is missing the following properties from type 'Node<unknown, NodeOptions>': _location, location, _treeContext, treeContext, and 60 more.
packages/less-parser/src/productions/root.ts(114,32): error TS2339: Property 'name' does not exist on type 'Call'.
packages/less-parser/src/productions/root.ts(151,25): error TS2339: Property 'name' does not exist on type 'Call'.
packages/less-parser/src/productions/root.ts(355,18): error TS2552: Cannot find name 'TreeContext'. Did you mean 'RuleContext'?
packages/less-parser/src/productions/root.ts(492,18): error TS2552: Cannot find name 'TreeContext'. Did you mean 'RuleContext'?
packages/less-parser/src/productions/root.ts(1371,91): error TS2345: Argument of type '[] | LocationInfo' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/root.ts(1374,50): error TS2345: Argument of type '[] | LocationInfo | undefined' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/root.ts(1375,34): error TS2345: Argument of type '[] | LocationInfo | undefined' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/root.ts(1393,84): error TS2345: Argument of type '[] | LocationInfo | undefined' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/root.ts(1397,90): error TS2345: Argument of type '[] | LocationInfo | undefined' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/root.ts(1397,123): error TS2345: Argument of type '[] | LocationInfo | undefined' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/selectors.ts(147,45): error TS2552: Cannot find name 'TreeContext'. Did you mean 'RuleContext'?
packages/less-parser/src/productions/selectors.ts(242,12): error TS2552: Cannot find name 'TreeContext'. Did you mean 'RuleContext'?
packages/less-parser/src/productions/selectors.ts(708,34): error TS2322: Type 'string | Nil | undefined' is not assignable to type 'string | undefined'.
  Type 'Nil' is not assignable to type 'string'.
packages/less-parser/src/productions/selectors.ts(800,32): error TS2322: Type 'string | Nil | undefined' is not assignable to type 'string | undefined'.
  Type 'Nil' is not assignable to type 'string'.
packages/less-parser/src/productions/values.ts(112,32): error TS2345: Argument of type '[] | LocationInfo' is not assignable to parameter of type 'LocationInfo | undefined'.
  Type '[]' is not assignable to type '[startOffset: number, startLine: number, startColumn: number, endOffset: number, endLine: number, endColumn: number]'.
    Source has 0 element(s) but target requires 6.
packages/less-parser/src/productions/values.ts(542,20): error TS2345: Argument of type 'Any<AnyRole> | Node<unknown, NodeOptions>' is not assignable to parameter of type 'Quoted | Any<AnyRole>'.
  Type 'Node<unknown, NodeOptions>' is not assignable to type 'Quoted | Any<AnyRole>'.
    Type 'Node<unknown, NodeOptions>' is not assignable to type 'Any<AnyRole>'.
      The types returned by 'eval(...)' are incompatible between these types.
        Type 'MaybePromise<Node<unknown, NodeOptions>>' is not assignable to type 'Any<AnyRole>'.
          Type 'Promise<Node<unknown, NodeOptions>>' is missing the following properties from type 'Any<AnyRole>': eval, preEval, evalNode, compare, and 61 more.
packages/less-parser/src/productions/values.ts(1194,85): error TS2552: Cannot find name 'TreeContext'. Did you mean 'RuleContext'?
packages/less-parser/src/utils.ts(45,51): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
packages/less-parser/src/utils.ts(52,44): error TS2339: Property 'InterpolatedSelector' does not exist on type 'typeof N'.
packages/less-parser/src/utils.ts(58,21): error TS2339: Property 'value' does not exist on type 'never'.
packages/less-parser/src/utils.ts(58,31): error TS7006: Parameter 'node' implicitly has an 'any' type.
packages/less-parser/src/utils.ts(67,33): error TS2339: Property 'value' does not exist on type 'never'.
packages/less-parser/src/utils.ts(68,44): error TS2339: Property 'InterpolatedSelector' does not exist on type 'typeof N'.
packages/less-parser/src/utils.ts(69,19): error TS18046: 'node' is of type 'unknown'.
packages/less-parser/src/utils.ts(88,26): error TS2339: Property 'valueOf' does not exist on type 'never'.
```

