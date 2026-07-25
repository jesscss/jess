# Typecheck Burn-Down Inventory (task #28)

Baseline inventory of the `tsc` errors the workspace currently hides behind
`--noCheck`. This document **defines** the burn-down; a later pass executes it.

- **DONE-CRITERION:** every package's build typechecks clean **without
  `--noCheck`** — i.e. `tsc -p tsconfig.build.json --emitDeclarationOnly`
  reports **0 errors** for all packages. At that point the `--noCheck` flag can
  be dropped from every `compile` script.
- Do **not** partially "fix" by suppressing (`as any` / `@ts-ignore` /
  `@ts-nocheck` are banned per project rules). Fix the types.

## How this was measured

- Branch: `docs/typecheck-inventory` off `origin/dev`.
- Full workspace built in dependency order (parsers → awaitable-pipe → core →
  fns → plugins → config → jess), so cross-package imports resolve to real
  `.d.ts` (otherwise `TS2307 Cannot find module` false-positives flood the
  count).
- Per package: `tsc -p tsconfig.build.json --emitDeclarationOnly --noEmit`
  (the build's own typecheck, minus `--noCheck`), TypeScript **7.0.1-rc**
  (the workspace-pinned compiler the `compile` scripts invoke).
- Packages with no `tsconfig.build.json` (`_shared`, `docs*`, `extension`,
  `patch-css` has one but 0 errors, `vscode`, `language-service-tests`,
  `parser`) are not part of the compiled-declaration surface and are excluded.

## Total: **200 errors** across **7 packages / 34 files**

### Per package

| Package | Errors |
|---|---:|
| `@jesscss/core` | 136 |
| `@jesscss/scss-parser` | 36 |
| `@jesscss/less-parser` | 7 |
| `@jesscss/plugin-less` | 7 |
| `jess` | 6 |
| `@jesscss/fns` | 6 |
| `@jesscss/plugin-scss` | 2 |

The historical "~136 pre-existing errors" figure is exactly `@jesscss/core`
alone; the other 64 live in downstream packages.

### Per error class

| Code | Count | Meaning |
|---|---:|---|
| TS2345 | 71 | Argument type not assignable to parameter |
| TS2339 | 45 | Property does not exist on type |
| TS2322 | 42 | Type not assignable (assignment/return) |
| TS2554 | 5 | Wrong number of arguments |
| TS7006 | 4 | Parameter implicitly `any` |
| TS2740 | 4 | Type missing multiple required properties |
| TS18048 | 4 | Value possibly `undefined` |
| TS2694 | 3 | Namespace has no exported member |
| TS2559 | 3 | Type has no properties in common |
| TS2352 | 3 | Unsafe cast (neither sufficiently overlaps) |
| TS2551 | 2 | Property does not exist (did-you-mean) |
| TS2425 | 2 | Class incorrectly overrides member |
| TS2353 | 2 | Unknown object-literal property |
| TS2307 | 2 | Cannot find module |
| TS2304 | 2 | Cannot find name |
| TS2769 / TS2739 / TS2416 / TS2367 / TS2358 / TS2305 | 1 each | overload / missing-fields / override / bad-compare / instanceof-lhs / no-export |

### Per file (all 34)

```
 42  packages/core/src/tree/util/extend.ts
 17  packages/scss-parser/src/builders.ts                (HOT)
 15  packages/scss-parser/src/scss-atroot-helpers.ts
 14  packages/core/src/tree/ruleset.ts
  8  packages/core/src/tree/util/selector-match-core.ts
  7  packages/jess-plugin-less/src/index.ts
  7  packages/core/src/tree/util/extend-roots.ts
  7  packages/core/src/tree/rules.ts
  6  packages/core/src/tree/declaration.ts
  5  packages/jess/src/index.ts
  5  packages/core/src/tree/util/serialize-helper.ts
  5  packages/core/src/tree/util/extend-walk.ts
  5  packages/core/src/tree/util/emit-walk.ts
  5  packages/core/src/tree/import-style.ts
  4  packages/less-parser/src/lessRecursiveParser.ts
  4  packages/fns/src/less/format.ts
  4  packages/core/src/tree/util/check-valid-nodes.ts
  4  packages/core/src/tree/extend.ts
  3  packages/scss-parser/src/interp.ts
  3  packages/less-parser/src/builders.ts                (HOT)
  3  packages/core/src/tree/reference.ts
  3  packages/core/src/tree/ampersand.ts
  3  packages/core/src/ast/serialize.ts                  (HOT)
  2  packages/jess-plugin-scss/src/index.ts
  2  packages/fns/src/util/relative-color.ts
  2  packages/core/src/tree/util/callable-candidate-output.ts
  2  packages/core/src/tree/util/bitset.ts
  2  packages/core/src/tree/at-rule.ts
  1  packages/scss-parser/src/functional-parser.ts
  1  packages/jess/src/output.ts
  1  packages/core/src/tree/util/render-buffer.ts
  1  packages/core/src/tree/selector-list.ts
  1  packages/core/src/tree/node-base.ts
  1  packages/core/src/tree/extend/spine-extend.ts       (HOT-adjacent, see note)
  1  packages/core/src/tree/default-guard.ts
  1  packages/core/src/tree/call.ts
  1  packages/core/src/context.ts
  1  packages/core/src/ast/parse-host/import.ts          (HOT)
  1  packages/core/src/ast/parse-host/dispatch-host.ts   (HOT)
```

## HOT vs COLD split

HOT = files in the surfaces other agents are actively editing (`grammar.ts`,
`builders.ts`, `ast/parse-host/**`, `ast/extend/**` incl. `ast/extend.ts`,
`ast/serialize.ts`). **Defer** these — fixing now collides with in-flight edits.

| | Errors | Files |
|---|---:|---|
| **COLD** (safe to fix in a later parallel pass) | **175** | 29 |
| **HOT** (defer) | **25** | 5 |

**HOT (defer):**
- `scss-parser/src/builders.ts` — 17
- `less-parser/src/builders.ts` — 3
- `core/src/ast/serialize.ts` — 3
- `core/src/ast/parse-host/import.ts` — 1
- `core/src/ast/parse-host/dispatch-host.ts` — 1

Note: the `ast/extend/**` directory (`compose/emit/ir/match/plan/solve.ts`) and
`ast/extend.ts` are HOT but currently carry **0** errors. The 60+ "extend"
errors are all in the **legacy `tree/util/extend*.ts`** subsystem, which is
**COLD** (untouched by the last 30 commits) — do not confuse the two.
`tree/extend/spine-extend.ts` (1 error) is legacy-tree, treated COLD, but is
extend-adjacent — coordinate if the spine work is live.

## Root-cause clusters (ranked by errors-fixed-per-fix)

Most errors collapse into a few shared type mistakes. Ranked cold-first
(actionable now):

### 1. Legacy `tree` Selector type model — ~110+ errors — **COLD** — TOP PRIORITY
Files: `tree/util/extend.ts` (42), `ruleset.ts` (14), `selector-match-core.ts`
(8), `extend-roots.ts` (7), `rules.ts` (7), `extend-walk.ts` (5), `extend.ts`
(4), `ampersand.ts` (3), `reference.ts` (3), plus `selector-list.ts`,
`emit-walk.ts`, `serialize-helper.ts`, `check-valid-nodes.ts`,
`callable-candidate-output.ts`, and others under `tree/`.
Two intertwined root causes:
- **(1a) `noUncheckedIndexedAccess` on selector-component arrays.** Indexing
  `ComplexSelectorComponent[]` / selector arrays yields `Component | undefined`,
  but the shared match/walk helpers demand the non-`undefined` type — 30 of the
  TS2345/TS2322 errors are literally `X | undefined` → `X`. Fix at the handful
  of shared helper signatures / add one narrowing guard per hot loop, not at
  each call site.
- **(1b) `SelectorLike` union vs concrete `Selector<any, NodeOptions>`.** The
  legacy selector helpers pass the broad `SelectorLike` / `ComplexSelectorComponent`
  union where a concrete `Selector<any, NodeOptions>` is required (and vice
  versa). Reconciling the `SelectorLike` alias with the `Selector` generic (or
  the extend helpers' parameter types) knocks out the bulk of the remaining
  TS2345/TS2322 in this cluster.
This one cluster is ~2/3 of the entire backlog and the single highest-leverage
target. Land it first, in its own pass, after the ast/extend churn settles.

### 2. `TreeContext` vs `TreeContextLike` / `Context` — ~6 errors — mostly COLD
`declaration.ts`, `callable-candidate-output.ts`, `check-valid-nodes.ts`
(COLD) + `jess/src/index.ts` (COLD). `TreeContext` no longer structurally
satisfies the `TreeContextLike` / `Context` interfaces it is passed as. One fix
to the `TreeContext` shape (or the `*Like` interface) clears all of them —
related to the recent "track current core shape in bridge adapters" work.

### 3. `ContextOptions` missing `trivia` / `liftedCommentRanges` — ~5 errors — COLD
`jess/src/index.ts` (3) + `tree/rules.ts` (`sourceNode`, `options`). The
`ContextOptions` / node types lack fields the code reads. Add the fields to the
option/type declaration once → all clear.

### 4. `scss-atroot-helpers.ts` arg-count (TS2554 "expected 0-3, got 4") — 5 errors — COLD
A node factory / constructor signature gained/lost a parameter; five call sites
in `scss-atroot-helpers.ts` pass an extra arg. One signature reconciliation.

### 5. `@jesscss/fns` builtins — 6 errors — COLD
`builtins/format.ts` (4: two `TS7006` implicit-any params `list`/`ctx`, two
`FnDef` body-type `TS2322`) + `util/relative-color.ts` (2). Localized; type the
`format` builtin's params + the `FnDef` body signature.

### Deferred HOT clusters (record, do not fix yet)
- **scss node-namespace `typeof N` missing constructors** — 11 errors in
  `scss-parser/src/builders.ts` (`N.Interpolated` ×5, `N.Url` ×2, `N.While`,
  `N.Num`, `N.Keyword`, `N.If`, `N.For`). Root cause: the core node namespace
  `N`'s type doesn't declare these members. **HOT (builders.ts).** One `N`-type
  fix would clear all 11 — schedule right after the scss builders/grammar work.
- **`ScssFnParseResult` not exported from `scss-parser/src/grammar`** — 3 errors
  in `interp.ts` (TS2694). **HOT (grammar.ts).**
- `ast/serialize.ts` (3), `ast/parse-host/import.ts` + `dispatch-host.ts` (2,
  incl. `TS2307` on `@jesscss/css-parser/jess` and `@jesscss/less-parser`
  subpath resolution). **HOT.**

## Suggested execution order (later pass)

1. **Batch A — legacy selector/extend types (COLD):** cluster #1. Biggest win;
   do first, isolated worktree, after ast/extend churn quiets. ~110 errors.
2. **Batch B — context/options shapes (COLD):** clusters #2 + #3. ~11 errors.
3. **Batch C — scss cold + fns (COLD):** cluster #4 (`scss-atroot-helpers`) +
   cluster #5 (`fns`) + scss `interp`/`functional-parser` cold remainder.
4. **Batch D — HOT surfaces:** only after the grammar/builders/parse-host/
   serialize/ast-extend edits land — clusters in scss `builders.ts`,
   less `builders.ts`, `ast/serialize.ts`, `ast/parse-host/**`, scss `grammar`.
5. **Flip:** once all batches are green, remove `--noCheck` from every
   `compile` script and add the clean `tsc` to the pre-push gate.

Do not close the burn-down until `tsc -p tsconfig.build.json --emitDeclarationOnly`
is **0 errors in every package with the `--noCheck` flag removed**.
