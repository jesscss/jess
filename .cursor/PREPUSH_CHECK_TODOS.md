# Pre-push Check TODOs

Generated: 2026-03-07T19:27:56.883Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/scss-parser` - `pnpm -w exec tsc -p packages/scss-parser/tsconfig.build.json --noEmit` (exit 2)
2. [ ] `packages/scss-parser` - `pnpm --filter ./packages/scss-parser build` (exit 1)

## Failure Details
### 1) packages/scss-parser

- Command: `pnpm -w exec tsc -p packages/scss-parser/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/scss-parser/src/productions.ts(205,16): error TS2339: Property 'rulesVisibility' does not exist on type 'DeclarationOptions & { paramVar?: boolean | undefined; } & AllNodeOptions'.
packages/scss-parser/src/productions.ts(3061,37): error TS2339: Property 'Dot' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3061,65): error TS2339: Property 'Hash' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3062,67): error TS2339: Property 'LBracket' does not exist on type 'TokenMap'.
```

### 2) packages/scss-parser

- Command: `pnpm --filter ./packages/scss-parser build`
- Exit: `1`

```
> @jesscss/scss-parser@2.0.0-alpha.1 build /Users/matthew/git/oss/jess/packages/scss-parser
> pnpm compile


> @jesscss/scss-parser@2.0.0-alpha.1 compile /Users/matthew/git/oss/jess/packages/scss-parser
> pnpm -w exec tsc -p packages/scss-parser/tsconfig.build.json

packages/scss-parser/src/productions.ts(205,16): error TS2339: Property 'rulesVisibility' does not exist on type 'DeclarationOptions & { paramVar?: boolean | undefined; } & AllNodeOptions'.
packages/scss-parser/src/productions.ts(3061,37): error TS2339: Property 'Dot' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3061,65): error TS2339: Property 'Hash' does not exist on type 'TokenMap'.
packages/scss-parser/src/productions.ts(3062,67): error TS2339: Property 'LBracket' does not exist on type 'TokenMap'.
 ELIFECYCLE  Command failed with exit code 2.
/Users/matthew/git/oss/jess/packages/scss-parser:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/scss-parser@2.0.0-alpha.1 build: `pnpm compile`
Exit status 1

(node:36825) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
```

