# Project State

This file is lightweight startup memory for Cursor/debugging sessions. It should
not become a running work log.

For repo-wide rules, read `AGENTS.md`. For the active architecture roadmap, use:

- `docs/future/core-architecture/HANDOFF.md`
- `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md`
- `docs/future/core-architecture/PERFORMANCE-HANDOFF.md`

## Package Build Shape

If package B depends on package A, build A before testing B against local
changes.

Common dependency shape:

- leaves: `@jesscss/awaitable-pipe`, `@jesscss/shared`,
  `@jesscss/patch-css`, `@jesscss/style-resolver`, `@jesscss/config`
- core/parsers: `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, `@jesscss/fns`
- app/plugins: `@jesscss/parser`, `@jesscss/jess-plugin`,
  `@jesscss/plugin-node-modules`, `@jesscss/jess-plugin-less`,
  `@jesscss/jess-plugin-scss`, `@jesscss/jess-plugin-less-compat`,
  `@jesscss/language-service`, `@jesscss/jess`

Practical example: after changing `packages/core`, build core before running
Jess package fixture tests that import `@jesscss/core` from built output.

```sh
pnpm --filter @jesscss/core build
```

## Verification Commands

Use focused tests first while iterating.

Baseline for the current core/parser/Less fixture surface:

```sh
pnpm run verify:baseline
```

Core package:

```sh
pnpm --filter ./packages/core test -- --run
pnpm --filter ./packages/core exec tsc -p tsconfig.build.json --noEmit
```

Less fixture authority:

```sh
pnpm run test:less:test-data
```

The only fixture-backed Less integration authority in
`packages/jess/test/less` is `all-less.test.ts`. Treat other targeted Less test
files as suspect unless their expectations have been revalidated against
upstream Less test-data, Less.js behavior, or a documented Jess-specific
contract.

## Current Focus

No active debugging focus is recorded here.

For current implementation work, use the active handoffs listed at the top of
this file. When a debugging session starts, fill in only these fields and delete
them again once the issue is closed:

- Area:
- Focused baseline:
- Last thing tried:
- Result:
- Next step:

Do not paste long failure logs or old session history into this file. Keep that
material in issue comments, archived notes, or git history.
