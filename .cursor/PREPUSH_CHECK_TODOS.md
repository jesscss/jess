# Pre-push Check TODOs

Generated: 2026-03-10T19:09:05.661Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/parser` - `pnpm -w exec tsc -p packages/parser/tsconfig.build.json --noEmit` (exit 2)
2. [ ] `packages/parser` - `pnpm --filter ./packages/parser build` (exit 2)
3. [ ] `packages/scss-parser` - `pnpm -w exec tsc -p packages/scss-parser/tsconfig.build.json --noEmit` (exit 2)
4. [ ] `packages/scss-parser` - `pnpm --filter ./packages/scss-parser build` (exit 2)

## Failure Details
### 1) packages/parser

- Command: `pnpm -w exec tsc -p packages/parser/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/parser/src/jessActionsParser.ts(97,46): error TS2304: Cannot find name 'Node'.
packages/parser/src/productions.ts(207,35): error TS2322: Type 'false' is not assignable to type 'true | Node<unknown, NodeOptions> | undefined'.
packages/parser/src/productions.ts(261,35): error TS2322: Type 'false' is not assignable to type 'true | Node<unknown, NodeOptions> | undefined'.
packages/parser/src/productions.ts(389,26): error TS2322: Type 'false' is not assignable to type 'true | Node<unknown, NodeOptions> | undefined'.
packages/parser/src/productions.ts(621,11): error TS2322: Type 'Quoted | Url' is not assignable to type 'Quoted'.
  Type 'Url' is not assignable to type 'Quoted'.
    The types returned by 'eval(...)' are incompatible between these types.
      Type 'MaybePromise<Node<unknown, NodeOptions>>' is not assignable to type 'Promise<Any<AnyRole> | Interpolated<AnyRole> | Quoted>'.
        Type 'Node<unknown, NodeOptions>' is missing the following properties from type 'Promise<Any<AnyRole> | Interpolated<AnyRole> | Quoted>': then, catch, finally, [Symbol.toStringTag]
packages/parser/src/productions.ts(806,10): error TS2488: Type 'Alt | ({ ALT: () => any; GATE?: undefined; } | { GATE: () => boolean; ALT: () => IToken; })[]' must have a '[Symbol.iterator]()' method that returns an iterator.
```

### 2) packages/parser

- Command: `pnpm --filter ./packages/parser build`
- Exit: `2`

```
> @jesscss/parser@2.0.0-alpha.5 build /Users/matthew/git/oss/jess/packages/parser
> pnpm clean && pnpm compile


> @jesscss/parser@2.0.0-alpha.5 clean /Users/matthew/git/oss/jess/packages/parser
> shx rm -rf ./lib tsconfig.tsbuildinfo


> @jesscss/parser@2.0.0-alpha.5 compile /Users/matthew/git/oss/jess/packages/parser
> tsc -p tsconfig.build.json

src/jessActionsParser.ts(97,46): error TS2304: Cannot find name 'Node'.
src/productions.ts(207,35): error TS2322: Type 'false' is not assignable to type 'true | Node<unknown, NodeOptions> | undefined'.
src/productions.ts(261,35): error TS2322: Type 'false' is not assignable to type 'true | Node<unknown, NodeOptions> | undefined'.
src/productions.ts(389,26): error TS2322: Type 'false' is not assignable to type 'true | Node<unknown, NodeOptions> | undefined'.
src/productions.ts(621,11): error TS2322: Type 'Quoted | Url' is not assignable to type 'Quoted'.
  Type 'Url' is not assignable to type 'Quoted'.
    The types returned by 'eval(...)' are incompatible between these types.
      Type 'MaybePromise<Node<unknown, NodeOptions>>' is not assignable to type 'Promise<Any<AnyRole> | Interpolated<AnyRole> | Quoted>'.
        Type 'Node<unknown, NodeOptions>' is missing the following properties from type 'Promise<Any<AnyRole> | Interpolated<AnyRole> | Quoted>': then, catch, finally, [Symbol.toStringTag]
src/productions.ts(806,10): error TS2488: Type 'Alt | ({ ALT: () => any; GATE?: undefined; } | { GATE: () => boolean; ALT: () => IToken; })[]' must have a '[Symbol.iterator]()' method that returns an iterator.
 ELIFECYCLE  Command failed with exit code 2.
/Users/matthew/git/oss/jess/packages/parser:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/parser@2.0.0-alpha.5 build: `pnpm clean && pnpm compile`
Exit status 2
```

### 3) packages/scss-parser

- Command: `pnpm -w exec tsc -p packages/scss-parser/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/scss-parser/src/productions.ts(206,16): error TS2339: Property 'rulesVisibility' does not exist on type 'DeclarationOptions & { paramVar?: boolean | undefined; } & AllNodeOptions'.
packages/scss-parser/src/productions.ts(3062,37): error TS2339: Property 'Dot' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3062,65): error TS2339: Property 'Hash' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3063,67): error TS2339: Property 'LBracket' does not exist on type 'TokenMap'.
```

### 4) packages/scss-parser

- Command: `pnpm --filter ./packages/scss-parser build`
- Exit: `2`

```
> @jesscss/scss-parser@2.0.0-alpha.1 build /Users/matthew/git/oss/jess/packages/scss-parser
> pnpm compile


> @jesscss/scss-parser@2.0.0-alpha.1 compile /Users/matthew/git/oss/jess/packages/scss-parser
> pnpm -w exec tsc -p packages/scss-parser/tsconfig.build.json

packages/scss-parser/src/productions.ts(206,16): error TS2339: Property 'rulesVisibility' does not exist on type 'DeclarationOptions & { paramVar?: boolean | undefined; } & AllNodeOptions'.
packages/scss-parser/src/productions.ts(3062,37): error TS2339: Property 'Dot' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3062,65): error TS2339: Property 'Hash' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3063,67): error TS2339: Property 'LBracket' does not exist on type 'TokenMap'.
 ELIFECYCLE  Command failed with exit code 2.
/Users/matthew/git/oss/jess/packages/scss-parser:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/scss-parser@2.0.0-alpha.1 build: `pnpm compile`
Exit status 2
```

