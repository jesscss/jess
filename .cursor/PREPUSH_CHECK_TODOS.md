# Pre-push Check TODOs

Generated: 2026-04-17T13:44:36.159Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/fns` - `pnpm -w exec tsc -p packages/fns/tsconfig.build.json --noEmit` (exit 2)
2. [ ] `packages/fns` - `pnpm --filter ./packages/fns build` (exit 1)

## Failure Details
### 1) packages/fns

- Command: `pnpm -w exec tsc -p packages/fns/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/fns/src/less/each.ts(34,69): error TS2339: Property 'rules' does not exist on type 'Node<unknown, NodeOptions>[] | MixinValue<"name">'.
  Property 'rules' does not exist on type 'Node<unknown, NodeOptions>[]'.
packages/fns/src/less/each.ts(37,15): error TS2339: Property 'params' does not exist on type 'Node<unknown, NodeOptions>[] | MixinValue<"name">'.
packages/fns/src/less/each.ts(53,23): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
packages/fns/src/less/each.ts(57,23): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
packages/fns/src/less/each.ts(61,23): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
```

### 2) packages/fns

- Command: `pnpm --filter ./packages/fns build`
- Exit: `1`

```
> @jesscss/fns@2.0.0-alpha.5 build /Users/matthew/git/oss/jess/packages/fns
> pnpm compile


> @jesscss/fns@2.0.0-alpha.5 compile /Users/matthew/git/oss/jess/packages/fns
> tsdown --tsconfig tsconfig.build.json --no-dts && tsc -p tsconfig.build.json --emitDeclarationOnly

ℹ tsdown v0.21.7 powered by rolldown v1.0.0-rc.12
ℹ config file: /Users/matthew/git/oss/jess/packages/fns/tsdown.config.ts 
ℹ entry: ./src/index.ts
ℹ tsconfig: tsconfig.build.json
ℹ Build start
ℹ Cleaning 171 files
ℹ [CJS] lib/index.cjs  82.91 kB │ gzip: 15.33 kB
ℹ [CJS] 1 files, total: 82.91 kB
ℹ [ESM] lib/index.js  73.47 kB │ gzip: 14.63 kB
ℹ [ESM] 1 files, total: 73.47 kB
✔ Build complete in 222ms
✔ Build complete in 222ms
src/less/each.ts(34,69): error TS2339: Property 'rules' does not exist on type 'Node<unknown, NodeOptions>[] | MixinValue<"name">'.
  Property 'rules' does not exist on type 'Node<unknown, NodeOptions>[]'.
src/less/each.ts(37,15): error TS2339: Property 'params' does not exist on type 'Node<unknown, NodeOptions>[] | MixinValue<"name">'.
src/less/each.ts(53,23): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/less/each.ts(57,23): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/less/each.ts(61,23): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
 ELIFECYCLE  Command failed with exit code 2.
/Users/matthew/git/oss/jess/packages/fns:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/fns@2.0.0-alpha.5 build: `pnpm compile`
Exit status 1
```

