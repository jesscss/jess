# Pre-push Check TODOs

Generated: 2026-03-18T00:01:57.109Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/jess-plugin-js` - `pnpm -w exec tsc -p packages/jess-plugin-js/tsconfig.build.json --noEmit` (exit 2)
2. [ ] `packages/jess-plugin-js` - `pnpm --filter ./packages/jess-plugin-js build` (exit 1)

## Failure Details
### 1) packages/jess-plugin-js

- Command: `pnpm -w exec tsc -p packages/jess-plugin-js/tsconfig.build.json --noEmit`
- Exit: `2`

```
packages/jess-plugin-js/src/index.ts(5,21): error TS2307: Cannot find module 'node:fs' or its corresponding type declarations.
packages/jess-plugin-js/src/index.ts(6,22): error TS2307: Cannot find module 'node:net' or its corresponding type declarations.
packages/jess-plugin-js/src/index.ts(7,23): error TS2307: Cannot find module 'node:path' or its corresponding type declarations.
packages/jess-plugin-js/src/index.ts(8,46): error TS2307: Cannot find module 'node:url' or its corresponding type declarations.
packages/jess-plugin-js/src/index.ts(9,71): error TS2307: Cannot find module 'node:child_process' or its corresponding type declarations.
packages/jess-plugin-js/src/index.ts(134,14): error TS2503: Cannot find namespace 'NodeJS'.
packages/jess-plugin-js/src/index.ts(137,22): error TS2503: Cannot find namespace 'NodeJS'.
packages/jess-plugin-js/src/index.ts(163,5): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(164,5): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(169,7): error TS2304: Cannot find name 'clearTimeout'.
packages/jess-plugin-js/src/index.ts(179,22): error TS2304: Cannot find name 'setTimeout'.
packages/jess-plugin-js/src/index.ts(222,9): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(223,23): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(228,23): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(287,9): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(290,38): error TS7006: Parameter 'socket' implicitly has an 'any' type.
packages/jess-plugin-js/src/index.ts(293,26): error TS7006: Parameter 'chunk' implicitly has an 'any' type.
packages/jess-plugin-js/src/index.ts(330,62): error TS2339: Property 'url' does not exist on type 'ImportMeta'.
packages/jess-plugin-js/src/index.ts(342,14): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
packages/jess-plugin-js/src/index.ts(350,29): error TS7006: Parameter 'chunk' implicitly has an 'any' type.
packages/jess-plugin-js/src/index.ts(359,21): error TS2304: Cannot find name 'setTimeout'.
packages/jess-plugin-js/src/index.ts(375,15): error TS2304: Cannot find name 'clearTimeout'.
packages/jess-plugin-js/src/index.ts(386,28): error TS7006: Parameter 'err' implicitly has an 'any' type.
packages/jess-plugin-js/src/index.ts(387,9): error TS2304: Cannot find name 'clearTimeout'.
packages/jess-plugin-js/src/index.ts(429,7): error TS2304: Cannot find name 'clearTimeout'.
packages/jess-plugin-js/src/index.ts(439,7): error TS2304: Cannot find name 'clearTimeout'.
packages/jess-plugin-js/src/index.ts(458,23): error TS2304: Cannot find name 'setTimeout'.
packages/jess-plugin-js/src/index.ts(477,34): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
```

### 2) packages/jess-plugin-js

- Command: `pnpm --filter ./packages/jess-plugin-js build`
- Exit: `1`

```
> @jesscss/plugin-js@2.0.0-alpha.5 build /Users/matthew/git/oss/jess/packages/jess-plugin-js
> pnpm compile


> @jesscss/plugin-js@2.0.0-alpha.5 compile /Users/matthew/git/oss/jess/packages/jess-plugin-js
> tsc -b tsconfig.build.json

src/index.ts(5,21): error TS2307: Cannot find module 'node:fs' or its corresponding type declarations.
src/index.ts(6,22): error TS2307: Cannot find module 'node:net' or its corresponding type declarations.
src/index.ts(7,23): error TS2307: Cannot find module 'node:path' or its corresponding type declarations.
src/index.ts(8,46): error TS2307: Cannot find module 'node:url' or its corresponding type declarations.
src/index.ts(9,71): error TS2307: Cannot find module 'node:child_process' or its corresponding type declarations.
src/index.ts(134,14): error TS2503: Cannot find namespace 'NodeJS'.
src/index.ts(137,22): error TS2503: Cannot find namespace 'NodeJS'.
src/index.ts(163,5): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(164,5): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(169,7): error TS2304: Cannot find name 'clearTimeout'.
src/index.ts(179,22): error TS2304: Cannot find name 'setTimeout'.
src/index.ts(222,9): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(223,23): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(228,23): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(287,9): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(290,38): error TS7006: Parameter 'socket' implicitly has an 'any' type.
src/index.ts(293,26): error TS7006: Parameter 'chunk' implicitly has an 'any' type.
src/index.ts(330,62): error TS2339: Property 'url' does not exist on type 'ImportMeta'.
src/index.ts(342,14): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/index.ts(350,29): error TS7006: Parameter 'chunk' implicitly has an 'any' type.
src/index.ts(359,21): error TS2304: Cannot find name 'setTimeout'.
src/index.ts(375,15): error TS2304: Cannot find name 'clearTimeout'.
src/index.ts(386,28): error TS7006: Parameter 'err' implicitly has an 'any' type.
src/index.ts(387,9): error TS2304: Cannot find name 'clearTimeout'.
src/index.ts(429,7): error TS2304: Cannot find name 'clearTimeout'.
src/index.ts(439,7): error TS2304: Cannot find name 'clearTimeout'.
src/index.ts(458,23): error TS2304: Cannot find name 'setTimeout'.
src/index.ts(477,34): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
 ELIFECYCLE  Command failed with exit code 1.
/Users/matthew/git/oss/jess/packages/jess-plugin-js:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/plugin-js@2.0.0-alpha.5 build: `pnpm compile`
Exit status 1
```

