# Branch backlog triage — 2026-07-30

Base for this pass: `origin/dev` at `37954ccf6d4e2d9242b445cdef8ff6163ccb5c4a`
(re-verified against `928b3ca7bfac29663e2b96913780d0f3a842755c` mid-pass as
concurrent lanes landed; no verdict depends on those three commits).

At the start of this pass the repo held **279 local branches**, of which **192
were not merged into `origin/dev`**. A cleanup on 2026-07-25 had deleted 761
branches; the backlog regrew within five days. This file is the recovery record:
every deleted branch is listed with its **full tip SHA**, so the work stays
reachable by SHA for as long as git keeps it (`git branch <name> <sha>` restores
it).

## Method

Verdicts were reached cheapest-signal-first, and every branch was measured, not
guessed:

1. `git cherry origin/dev <branch>` — patch-id equivalence with upstream.
2. `git rev-list --count <branch>..origin/dev` — how far the branch has fallen
   behind. The backlog turned out to be **700–7 300 commits behind**.
3. `git diff --name-only origin/dev...<branch>` cross-referenced against
   `git ls-tree -r --name-only origin/dev` — does the branch still target files
   that exist? Three structural moves invalidated most of the backlog:
   - `docs/future/core-architecture/**` → `docs/architecture/core/**` (deleted at
     the old path)
   - `packages/{css,less,scss,jess}-parser/**` → `packages/syntax/**`, and
     `packages/internal-css-recognition` → `packages/parser-shared` (the packages
     regroup, `e96d1035d`)
   - the AST-v2 cutover, which replaced the `packages/core/src/tree/` engine that
     the whole `work/*` family folds into
4. `git merge-tree --write-tree` against `origin/dev` — does it still apply?
   **154 of 192 conflict.** Of the 38 that merge cleanly, most do so only because
   they add files into directories that no longer exist, which resurrects dead
   trees rather than delivering value.

Nothing was deleted on the strength of a family name. The `alpha*` family was
confirmed by ancestry, not assumed (see below).

## Summary

| Verdict | Count |
| --- | --- |
| Landed on `origin/dev` | 0 |
| Deleted (recorded below) | 159 |
| Needs owner decision | 19 |
| Out of scope (other lanes) | 25 |

## Landed

None. One branch — `fix-config-ts-load-race` — was taken all the way to a green,
fast-forwardable head and then **pulled back before the push** when adversarial
review found it redundant. That episode is written up under "Needs owner
decision" below, because the way it nearly landed is the more useful record.

## Needs owner decision

These were **not** deleted. Each carries content that may still be wanted, and
none could be adjudicated without an owner call.

### The near-miss: `fix-config-ts-load-race`

Tip `bbadfeaf9287fc37e8a5018536a02c9702f50994`, 2026-07-24, 727 behind, no remote
twin. **Kept, not deleted, and deliberately not landed.**

This was the one branch in 192 that looked like a clean survivor, and every cheap
signal agreed: merges clean against `origin/dev`, targets live paths, confined to
the leaf package `packages/config`, arrives with its own tests. Rebased onto
`origin/dev` it went fully green — `pnpm test` 30/30 across 2 files (including
five new `ts-loader` cases), `pnpm build` clean, `npx eslint` clean on all three
changed files after converting one `//` block to `/* … */` for the
`grammar/no-multiline-line-comments` rule that postdates the branch, no banned
`any`/`@ts-ignore`, and no change to any exported symbol in `loader.ts`, so none
of the five workspace consumers of `styles-config` were affected.

**It was still wrong to land, and only adversarial review caught it.** The race
it fixes is already fixed on `dev` by a different route:

> `452e62edc` — "fix(config): bump cosmiconfig to 9.0.2 for the TypeScript-config
> load race", authored the **same day, two hours later**, and on `origin/dev`.

Verified directly rather than taken on trust: the installed cosmiconfig is 9.0.2,
and `node_modules/.pnpm/cosmiconfig@9.0.2.../dist/loaders.js:78` builds its
compiled path as `` `${filepath}.${randomUUID()}.cjs` `` — per-load and
unshared. The fixed-sibling-path race the commit message describes is a
cosmiconfig **9.0.0** behaviour and no longer exists. The two commits are
alternative fixes for one bug and `dev` already chose the other.

Review also measured three behavioural regressions against the stock loader,
none of them visible from the diff or from a green suite:

| case | under this branch |
| --- | --- |
| top-level `await` in a config | **throws** — `.ts` is now forced through CommonJS in *both* explorers, where the async path previously used cosmiconfig's ESM loader |
| `import.meta.url` in `styles.config.mts` | **throws** — an `.mts` file is by definition an ES module; compiling it to CJS is semantically wrong |
| relative `import` of a sibling **`.ts`** | **throws** — contradicting the comment at `ts-loader.ts:89`; the shipped test only exercises `require('./shared.cjs')` |

Plus a packaging defect worth fixing regardless of this branch's fate:
`ts-loader.ts:57` resolves `typescript` from **styles-config's own** location,
whereas cosmiconfig resolved it from **cosmiconfig's**, where pnpm injects it as a
declared optional peer. `packages/config/package.json` lists `typescript` only as
a **devDependency**. In-repo this works purely because of the dev symlink; for a
published consumer under pnpm's isolated layout the `require` would fail where
the old path succeeded.

**Residual value, for the owner to weigh:** loading a config from a *read-only*
directory (which `452e62edc`'s own message explicitly scopes out as uncovered),
and avoiding the write + read-back + `import-fresh` round trip. Both real; neither
is the stated motivation. If it is ever landed, the commit message has to be
rewritten — as written it documents a bug that no longer exists — the two async
regressions have to be accepted deliberately rather than by accident, and the
`typescript` resolution root fixed.

The general lesson for the next pass over this backlog: **"merges clean and its
tests are green" is not evidence a stale branch is wanted.** It says nothing
about whether the problem was already solved another way.

### Live worktree — another lane's floor

Deleting these would yank a directory a concurrently running agent is standing
in. Left completely untouched.

| Branch | Tip SHA | Worktree | Note |
| --- | --- | --- | --- |
| `codex/root-trivia-cutover` | `a32f94de3` | `~/git/oss/jess-root-trivia` | 2026-07-30, on `origin`. Active sparse-trivia lane. Conflicts only in `scss-parser` index/test. |
| `fix/ab-compare-files` | `52f590a6c` | `~/git/worktrees/jess/ab-compare-files` | On `origin`. One-line fix to the A/B driver's FILES list; belongs to the out-of-scope `ab-worktree-harness` lane. Merges **clean** — a cheap land for that lane. |
| `epic-herschel-e1ef28` | `f994f2aed` | `~/git/worktrees/jess/epic-herschel-e1ef28` | "give every CST node one hidden class". Merges **clean**, but this is the hidden-class unification that was **measured and reverted** (16 maps assumed, 2 observed). Owner should confirm it is the same experiment before it is deleted or re-landed. |
| `scss-user-fn-scope-lookup` | `f6d154cd5` | `~/git/worktrees/jess/scss-user-fn-scope-lookup` | 2026-07-30 perf work. |
| `less-pseudo-spacing` | `53a0bb989` | `.claude/worktrees/agent-a2bfdca45382385ed` | Structured `PseudoSelector` (P0.3); targets the pre-regroup `packages/less-parser/`. |
| `codex/less-api-bridge-alpha` | `ee19d6bcb` | `~/git/worktrees/jess/less-api-bridge-alpha` | Alpha-family snapshot (1 928 files vs merge-base, 7 298 behind) carrying one real commit: move the Less API bridge into the compat plugin. Worth extracting, not worth rebasing whole. |
| `brave-jackson-baaa2d` | `dc563e4f9` | `~/git/worktrees/jess/brave-jackson-baaa2d` | Machine-named agent branch, live worktree. |
| `work/scss-extend-pseudo-regression` | `fe8417afc` | `~/git/worktrees/jess-scss-extend-pseudo-regression` | `git cherry` says **every commit is already upstream** — redundant. Safe to delete once the worktree is released. |
| `work/scss-less-import-options-cut` | `41730f1ca` | `~/git/worktrees/jess-scss-less-import-options` | Same: **already upstream** by patch-id. Safe to delete once the worktree is released. |
| `reorg/p0` | `b71850f0c` | `/private/tmp/jess-reorg-p0` (prunable) | The packages regroup Phase 0. Its worktree directory is already gone; the reorg itself has since landed by another route. |

### Carries content, targets live AST-v2 files, will not rebase cleanly

| Branch | Tip SHA | Date | Behind | Why undecided |
| --- | --- | --- | --- | --- |
| `wip/maybe-promise-2b` | `94e649ba9` | 2026-07-24 | 766 | 1 700 lines across `ast/mixin-dispatch.ts` + `ast/serialize.ts`, putting mixin dispatch on the MaybePromise lane. Its own commits say **"NOT FOR LANDING"**. Conflicts on both files. Real design content; needs an owner to say whether the lane is alive. |
| `codex/less-container-followup` | `92bf7075f` | 2026-07-22 | 976 | 7-line perf change to `ast/serialize.ts` ("avoid dynamic bubble callback allocation"). Live file, small, but conflicts and carries **no measurement** — perf claims need controlled measurement before landing. |
| `extend-p-amp` | `d19ce368d` | 2026-07-23 | 862 | 426 lines across `ast/extend/{compose,ir,match}.ts` — structural `&`-boundary + parent-segment splice (RUNG P-amp). Live files, but three extend lanes have run since; likely superseded, not provably so. |
| `work/less-math-unit-fix` | `ef775b503` | 2026-07-22 | 1 042 | "defer strict unit validation to final values" — touches `ast/value-operate.ts`, `ast/serialize.ts` and `jess/test/less/strict-units.test.ts`, all live. A **semantics** change: needs the semantics gate and a `DESIGN-DECISIONS.md` row, not a triage-lane land. |
| `grammar-lint-rules` | `7c883f7f1` | 2026-07-25 | 713 | 396 files. Enforces comment shape and grammar authoring rules. Touches `grammar.ts` files, which this lane is forbidden to modify. |
| `wip/lint-autofix-checkpoint-2026-07-25` | `47f5351fb` | 2026-07-25 | 689 | 138 files; the commit describes itself as an **uncommitted lint-autofix checkpoint rescued from the dev checkout**. Salvage, not a branch — someone should confirm nothing in it is still wanted. |
| `salvage/local-extend-b3de1d6f3` | `191a16bd6` | 2026-07-23 | 870 | Explicitly named a pre-merge salvage of a local extend experiment. Deleting a salvage branch defeats its purpose. |
| `salvage/q40-source-normalization` | `7bb9b483e` | 2026-07-14 | 1 729 | Same — named salvage. Targets legacy `tree/`, so probably dead, but the naming is a deliberate owner signal. |

## Deleted

All 159 below were **recorded before deletion**. Restore any of them with
`git branch <name> <sha>`.

The `Behind` column is `commits ahead / commits behind origin/dev`. `Remote`
names a remote ref at the identical SHA — where one exists the branch was never
at risk, since deleting the local ref loses nothing at all.

### Why each family went

- **`alpha*`, `backup-alpha*`, `jess-alpha-curated`, `codex/alpha-before-dev-*`,
  `worktree-agent-a00486ceee36870d0` (29 branches)** — release snapshots squashed
  *from* `dev`, so their content is upstream by construction. Verified rather
  than assumed: of the 28 that carry an `alpha*`-shaped name, **23 are direct
  ancestors of `alpha`**, which is preserved at `origin/alpha` (`74328f3bc`) —
  their commits remain reachable through `alpha`'s own history.
  `alpha-backup-20260711` is preserved as `origin/alpha-archive-20260711`. The
  four remaining (`alpha-pre-resquash-20260723-{56da9292,70d2476a,811e1af2}`,
  `backup-alpha-0b2edbcf9`) are backups taken before a squash that has since been
  superseded five times over; they are 7 319 commits behind. **`alpha` itself was
  not touched.**
- **`work/*` spine folds (42 branches)** — nearly all share merge-base `43d016b28`,
  1 983 commits behind, all folding the legacy `packages/core/src/tree/` engine
  onto "the spine". AST-v2 replaced that engine wholesale. Several are exact
  duplicates of one another (`work/deval-flip`, `work/leaky-nested-def-fold` and
  `work/mg-ns-path-call` are all `bac41d242`; `work/import-nested-treectx` and
  `work/import-ref-cluster` are both `43dff4c3a`).
- **`experiment/tree2-*` (10 branches)** — `tree2` was the working name of AST-v2.
  The engine landed; these specs sit in the deleted `docs/future/core-architecture/`
  and the code targets a `tree2-frontend/` directory that does not exist. Six of
  the seven spec branches are preserved on `origin`.
- **`feature/q40-*` (9 branches)** — a rejected perf batch. Four commits say
  "reject" in the subject line. **`feature/q40-parser-host-20260715` and
  `feature/q40-registration-prep-20260715` are empty** — zero files differ from
  their merge-base.
- **`feature/css-direct-*`, `feature/*-import-facts`, `feature/css-ls-*`
  (15 branches)** — July-19 parser/language-service work against
  `packages/css-parser/**` and `packages/less-parser/**`, paths the regroup moved.
- **Parser fixes already upstream** — `fix/nth-of-type-reject` and
  `gate/pseudo-1a` implement the Selectors-4 §6.6.2 `of S` restriction; that
  restriction is **already in `origin/dev`** at
  `packages/syntax/css/css-parser/src/grammar.ts:1231` and
  `packages/parser-shared/src/pseudo-consts.ts:46`. `feat/pseudo-shared-consts`
  is the pseudo consolidation that landed 2026-07-23.
- **Core fixes already upstream** — `feature/ast-merge-importance` adds merge
  `!important` promotion; `mergeImportant` is **already in
  `origin/dev:packages/core/src/ast/serialize.ts`** at five call sites.
  `worktree-agent-a8eb72dcf13b7daba` splits the value-block model into
  Collection + AnonymousMixin; **`AnonymousMixin` is already on `dev`** across
  `ast/{node,nodes,serialize,traversal}.ts`.
- **Superseded tooling** — `parseman-034-adoption` and `fix-idiom-plan-032` plan
  the 0.32→0.34 bump; the repo is on **0.44**. `chore/rename-parser-shared`
  renames `internal-css-recognition` → `parser-shared`; `packages/parser-shared`
  **already exists on `dev`**.
- **Design docs preserved on `origin`** — `design-sigil-exploration`,
  `trace-dual-grammar`, `packages-restructure-plan`, `grammar-remediation-plan`,
  `css-sharing-inventory`, `design/less-compat-repoint`, `jess-hostmode`,
  `kill-grammar-duplication`. All conflict against the live
  `docs/design/GRAMMAR-REBUILD-SPEC.md` and `docs/architecture/core/HANDOFF.md`,
  which have moved on. Nothing is lost: each has a remote twin at the same SHA.
- **POC / bench artifacts** — `poc/eval-dep-graph`, `work/value-shape-bakeoff`,
  `work/value-shape-spec`, `experiment/tree2-perf-signal-*`,
  `perf/extend-*`, `perf/walk-degen`, `lane-a*`, `lane-b-argalloc`,
  `combined-eval-alloc`. All measure the legacy `tree/` engine.

### Full record

| Branch | Tip SHA | Date | Ahead/Behind | Remote at same SHA |
| --- | --- | --- | --- | --- |
| `alpha-backup-20260711` | `253d140c9ffe1675bc159a3ec2f6085b13e3b134` | 2026-04-04 | 5/5808 | origin/alpha-archive-20260711 |
| `alpha-pre-alpha9-20260722-c88526bb7` | `6be731a5ebfba1e76e3105685eed780e1bfefd2c` | 2026-07-22 | 49/7319 | — |
| `alpha-pre-alpha9-20260722-fc30fc50d` | `3c451fe72ea7d2e1c6098f685745d76b43707a25` | 2026-07-22 | 51/7319 | — |
| `alpha-pre-alpha9-20260722-fdec1cd11` | `73cf03985845288677778d96ca6ad78866895503` | 2026-07-22 | 50/7319 | — |
| `alpha-pre-alpha9-20260723-08b98960c` | `636449ddb4d0d7f40067b8a0919f09cd93931086` | 2026-07-22 | 52/7319 | — |
| `alpha-pre-alpha9-cli-cut` | `e87c98cd817f321605f3c6da771e29bb7f936818` | 2026-07-22 | 44/7319 | — |
| `alpha-pre-alpha9-cut` | `59f34bb238279f61801bf3ceaf1d2fb37040de2c` | 2026-07-21 | 37/7319 | — |
| `alpha-pre-alpha9-cut-20260722-final` | `d8dbde60c9675c0e7123b04a91cd304d837cd276` | 2026-07-22 | 41/7319 | — |
| `alpha-pre-alpha9-final-docs-fns` | `dd70d6b2fd4e118aaf6ef8ad78ff9529296f360b` | 2026-07-22 | 46/7319 | — |
| `alpha-pre-alpha9-final-refresh` | `486fb4ec0665eb6fb7561a5febfbf0e92a7b68c2` | 2026-07-22 | 45/7319 | — |
| `alpha-pre-alpha9-refresh-20260722` | `564b656153e26b3b57e1157ddee02557dbdcc132` | 2026-07-22 | 39/7319 | — |
| `alpha-pre-alpha9-refresh-20260722-c40952314` | `b83f94b390c37701c6c21100a4e848325411d573` | 2026-07-22 | 40/7319 | — |
| `alpha-pre-refresh` | `b1f27645832829fa6ec5a12c2619f18b9bb9f135` | 2026-07-28 | 58/7319 | — |
| `alpha-pre-refresh-20260728-alpha11` | `2e217b69ded54eaf52d758496cdfe7e89831e877` | 2026-07-28 | 59/7319 | — |
| `alpha-pre-refresh-20260728-alpha11-2` | `b30717f4317bcd95246224abe15678c0d72565a3` | 2026-07-28 | 60/7319 | — |
| `alpha-pre-refresh-20260729T025427Z` | `dd6359ed3fca566d0e825ed26a4396dfebad6986` | 2026-07-28 | 61/7319 | — |
| `alpha-pre-refresh-20260729T174337Z` | `b2ddec8e5fa5bf69dee9ac0f455d9078651674c7` | 2026-07-28 | 62/7319 | — |
| `alpha-pre-refresh-20260729T174710Z` | `ff687e344bf17c74da2a7a32fe1a05d0a39e48a1` | 2026-07-29 | 63/7319 | — |
| `alpha-pre-resquash-20260723-3c6ef50e` | `3c6ef50ea079248c58f562c8a7588ed31a915852` | 2026-07-23 | 53/7319 | — |
| `alpha-pre-resquash-20260723-56da9292` | `56da9292494920684c5f76e152c69ef85d8ff935` | 2026-07-23 | 54/7319 | — |
| `alpha-pre-resquash-20260723-70d2476a` | `70d2476a7fe5510cc040a5d910003b7b6b9df2ea` | 2026-07-23 | 54/7319 | — |
| `alpha-pre-resquash-20260723-811e1af2` | `811e1af27ec622ae8fc2c085529e510f8fe8065c` | 2026-07-23 | 54/7319 | — |
| `alpha-pre-squash-20260728` | `6c3eed11a46438f4f118f67987fb13eedcd8b3a8` | 2026-07-23 | 54/7319 | — |
| `alpha-versioning` | `b8c73ab14c3546211acc4352abe089ae8d5feebc` | 2026-07-12 | 17/7319 | — |
| `archive/local-dev-6d9960f2d` | `6d9960f2dc1cf41e1a5735ba97ec480d4d5b4837` | 2026-07-09 | 1/2287 | — |
| `archive/stale-tree-helper-audit-20260722` | `cd3aa7bde1a53b47d17cc52095616a30b119e86d` | 2026-07-21 | 25/1146 | — |
| `audit/core-test-slim` | `3408ec516d6a2e235eafb9c65146149ca4b9c182` | 2026-07-09 | 1/2211 | — |
| `backup-alpha-0b2edbcf9` | `0b2edbcf9d8f9606bd7ee9fde366b8725e9bd668` | 2026-07-13 | 19/7319 | — |
| `backup-alpha-preland` | `b8c73ab14c3546211acc4352abe089ae8d5feebc` | 2026-07-12 | 17/7319 | — |
| `chore/all-less-collapsenesting-into-config` | `acecfda3d8a5d2201fefaed9470d6ec1e198851a` | 2026-07-15 | 1/1637 | origin/chore/all-less-collapsenesting-into-config |
| `chore/rename-parser-shared` | `7e4c1a490639d049394fddf972cc957ab93cde84` | 2026-07-25 | 1/696 | origin/chore/rename-parser-shared |
| `codex/alpha-before-dev-40bddcad7` | `5a9de6f1d2c96bb26cad43c245269b0905364ad1` | 2026-07-22 | 48/7319 | — |
| `codex/alpha-precommit-release-mode` | `c952b4af5a13975448bebba62978b938c1d21fff` | 2026-07-21 | 27/1149 | — |
| `combined-eval-alloc` | `16b6fd26ccf1e44107917740d8930648e24a249e` | 2026-07-11 | 31/1983 | — |
| `css-sharing-inventory` | `d644709ff5ad3bad2e4e77c1e20e96648556aa39` | 2026-07-24 | 1/779 | origin/css-sharing-inventory |
| `cutover/mixins-interp-fold` | `a0e6d0351fd156ec454da7da39e1c40bd5f23939` | 2026-07-10 | 3/1983 | — |
| `design-sigil-exploration` | `68678c85da2da69e5d0731098319da9f9ba71a59` | 2026-07-24 | 1/716 | origin/design-sigil-exploration |
| `design/less-compat-repoint` | `c74dde4cb82c5b4018af315e25011be52f7613c7` | 2026-07-18 | 1/1337 | origin/design/less-compat-repoint |
| `docs/branch-consolidation-analysis` | `73058f4d4ba7b7d019a9462325e65d13b66392fc` | 2026-07-09 | 1/2110 | — |
| `docs/ls-diagnostics-parity-plan` | `1a5fe466c5b328ea142b390f907d01d48632d341` | 2026-07-11 | 17/1983 | — |
| `experiment/tree2-benchmark-bringup-20260715` | `82ef89efd8747e04933e2a652816a7873bf2381b` | 2026-07-16 | 1/1660 | origin/experiment/tree2-benchmark-bringup-20260715 |
| `experiment/tree2-cleanroom-20260715` | `89c88c4f781bd6baf67875f06b6f5d4d42b11b7a` | 2026-07-16 | 1/1660 | — |
| `experiment/tree2-perf-signal-20260716` | `bea041532ca7bb47f906f0b00cd918aab12910d7` | 2026-07-16 | 1/1660 | origin/experiment/tree2-perf-signal-20260716 |
| `experiment/tree2-r5r6-capability-20260716` | `89c88c4f781bd6baf67875f06b6f5d4d42b11b7a` | 2026-07-16 | 1/1660 | — |
| `experiment/tree2-spec-r2-20260715` | `9c2680b147588e8f55a8d413731d5ddf65da6e8a` | 2026-07-15 | 1/1667 | origin/experiment/tree2-spec-r2-20260715 |
| `experiment/tree2-spec-r3-20260715` | `f4cf66a638f9ab6f41388d050cfe58fb4128b33b` | 2026-07-15 | 1/1667 | origin/experiment/tree2-spec-r3-20260715 |
| `experiment/tree2-spec-r4-20260715` | `894814625094d9df7a863ba7b9ea69a18a57ae05` | 2026-07-15 | 1/1667 | origin/experiment/tree2-spec-r4-20260715 |
| `experiment/tree2-spec-r5-20260715` | `01e58dc21bac76aad106a286ab542368fed3f066` | 2026-07-15 | 1/1667 | origin/experiment/tree2-spec-r5-20260715 |
| `experiment/tree2-spec-r6-20260715` | `bf63e742873538fa5fbfe6bfd24bc513326cfe43` | 2026-07-15 | 1/1667 | origin/experiment/tree2-spec-r6-20260715 |
| `experiment/tree2-spec-r7-20260715` | `ff57ab2750020b5fc1fac3e72134cb242a5c5fd8` | 2026-07-15 | 1/1667 | origin/experiment/tree2-spec-r7-20260715 |
| `feat/mixin-recursion` | `6640273fdbab687d5876b213527e721f877a68ea` | 2026-07-17 | 1/1500 | — |
| `feat/plugin-p3-preeval` | `dc0956764b07d1ab601fa4e84a949336e15e33af` | 2026-07-18 | 1/1326 | origin/feat/plugin-p3-preeval |
| `feat/pseudo-shared-consts` | `0cc4ee68a81cbadf86f474dc088b750ef2b8e1c8` | 2026-07-23 | 1/857 | — |
| `feature/active-atrule-import-facts` | `aeb0fc0dcf97f118eea7eccf3caf8723bdd44bc3` | 2026-07-19 | 1/1276 | — |
| `feature/append-extend-revalidation-20260715` | `91f4881d9336d4e5a3cbaa90556b52529fca116f` | 2026-07-15 | 1/1700 | — |
| `feature/ast-merge-importance` | `115ce8c77a646b0a28e250230f7a350f88500e50` | 2026-07-19 | 1/1237 | — |
| `feature/atomic-css-direct-root` | `aeb0fc0dcf97f118eea7eccf3caf8723bdd44bc3` | 2026-07-19 | 1/1276 | — |
| `feature/css-atomic-direct-design` | `92f29ffde54607b01cb498983afd38fb37d686aa` | 2026-07-19 | 2/1279 | — |
| `feature/css-direct-ast-declarations-20260719` | `23b77966dfb6c96e3fd4eb12b21e0d882cf6ca19` | 2026-07-19 | 14/1253 | — |
| `feature/css-direct-ast-layer-block-20260719` | `7ef5a0ee68f7ce5dd3efa3c879371df965837fbc` | 2026-07-19 | 1/1234 | — |
| `feature/css-direct-ast-statements-20260719` | `a6068e7baece5c1abb94ccff0ed2c093ad8c7e72` | 2026-07-19 | 1/1236 | — |
| `feature/css-direct-root-acceptance` | `06b1ece31ea30e3b54173c29ad70745f4fd12ac1` | 2026-07-19 | 1/1287 | — |
| `feature/css-ls-cst-colors` | `d111bcf8ad055576d02fd5c8d0875ef0c3fbc6dd` | 2026-07-19 | 2/1287 | — |
| `feature/css-ls-cst-diagnostics` | `410543536f8b5969287fb81a13f3f4f647893c5a` | 2026-07-19 | 4/1287 | — |
| `feature/css-ls-document-format` | `2bc8274c2c33528e7a5e473bc9864ad690c9cefb` | 2026-07-19 | 2/1287 | — |
| `feature/css-ordinary-direct-ast` | `c751c52403a50073c23920a59938678fd430daee` | 2026-07-19 | 1/1282 | — |
| `feature/direct-less-import-facts` | `5da7e32d265bcfd0c3270093e4cfbfc016cff95e` | 2026-07-19 | 19/1257 | — |
| `feature/grammar-artifact-externalization` | `0b3ec17eaf7c58df47b92d5160cd3abd4e8e5ecd` | 2026-07-18 | 1/1323 | — |
| `feature/less-atomic-direct-design` | `2d709817cd37e3b997777d01d6e4ac1b97b3b579` | 2026-07-19 | 1/1295 | — |
| `feature/less-import-direct-contract` | `a2401ef7807151214382cd1199ef6b9d7d8c8252` | 2026-07-19 | 1/1295 | — |
| `feature/less-import-facts` | `8ac0a4bf36672fae02459494bdd398b878c76090` | 2026-07-19 | 1/1282 | — |
| `feature/parser-runtime-boundary-hardening` | `70e8302043e321a963e7eda09b9477045434d20a` | 2026-07-18 | 2/1295 | — |
| `feature/parser-runtime-boundary-hardening-v2` | `112421712deac6df1db3e4388c211250f1456eac` | 2026-07-19 | 12/1291 | — |
| `feature/q40-child-rules-fastpath-20260715` | `a3661e7346bd13ae72f1a60954c997f9ac6e2c07` | 2026-07-15 | 2/1725 | — |
| `feature/q40-direct-lookup-miss-state-20260715` | `30565548e28f49ebfcce9612374655c9b320ef61` | 2026-07-15 | 1/1711 | — |
| `feature/q40-evaluator-serializer-frame-proof-20260715` | `04a230e891af850d4d99f351080e9cae12ba38a0` | 2026-07-15 | 1/1715 | — |
| `feature/q40-less-statement-dispatch-20260715` | `0d6879277e9ba3a9ba42761ac2d51bf5a0e734ba` | 2026-07-15 | 1/1711 | — |
| `feature/q40-parser-host-20260715` | `9f35c2921f036fe6872c72838993cd76d412c982` | 2026-07-15 | 1/1703 | — |
| `feature/q40-reference-surface-allocation-20260715` | `a69f51b5db81317437914c511112877d19976509` | 2026-07-15 | 1/1706 | — |
| `feature/q40-registration-prep-20260715` | `e9c08f4f5435dbe5b9eeee085be78e3b21075f69` | 2026-07-15 | 2/1691 | — |
| `feature/q40-root-writer-readback-20260715` | `763eb1535e19f98fd98e692b4c138c42e6775163` | 2026-07-15 | 1/1704 | — |
| `feature/q40-scope-frame-empty-pending-20260715` | `6dc929a36a10a58bbe9142446cecf6cf734f234f` | 2026-07-15 | 1/1704 | — |
| `feature/remove-compose-stats` | `d0779529e6b504a4b2fb777eceffa03dbbef4a6e` | 2026-07-19 | 1/1276 | — |
| `feature/remove-core-module-resolution` | `33706b371da593114712bb46a0ecf00e77a0e6cf` | 2026-07-19 | 3/1276 | — |
| `feature/scope-slot-proof` | `f6bca2ba406da2c8d5a557db5dc29ab54ab472be` | 2026-07-14 | 1/1811 | — |
| `fix-idiom-plan-032` | `bf306c509d00050b1a9704dc3bc5bd5c32cd37dc` | 2026-07-24 | 2/727 | origin/parseman-034-adoption |
| `fix/ampersand-compound-merge` | `f8f57f4b5ecb81f6651bd823feba859f510f1be2` | 2026-07-09 | 1/2018 | origin/fix/ampersand-compound-merge |
| `fix/nth-of-type-reject` | `2dc170873b9b784c7296b6496331feda31ef4fba` | 2026-07-23 | 4/851 | — |
| `fix/var-exclusion` | `c033ef87050b73bce0d662660dc60609d8062d07` | 2026-07-16 | 1/1537 | origin/fix/var-exclusion |
| `fns-sass-color` | `d19e794fc7427d39399f7bfbf240299d4750b5d5` | 2026-07-24 | 1/722 | origin/fns-sass-color |
| `gate/pseudo-1a` | `7ba099b9f7decdeb9e37147d85aba1c565a24329` | 2026-07-23 | 3/851 | — |
| `grammar-remediation-plan` | `a19209dd6b1ff233fe67eb496ef1fb76b48e3b49` | 2026-07-25 | 4/698 | origin/grammar-remediation-plan |
| `jess-alpha-curated` | `5a38338ca8de81d91a6ca648840e148a1fa3ee29` | 2026-07-11 | 15/7319 | — |
| `jess-hostmode` | `eaa5f3bc186a23c9d6617f2a86bd2402ae49905e` | 2026-07-25 | 2/696 | origin/jess-hostmode |
| `jess-perf-frame-fix` | `8c4bc1940fce11aafdd34b221760946232150f1d` | 2026-07-11 | 32/1983 | origin/work/deval-flip |
| `kill-grammar-duplication` | `aeb412b82a422d7a5bf2ef8f973b3ac99eaf0048` | 2026-07-25 | 4/698 | origin/kill-grammar-duplication |
| `land-scss-w1-v2` | `7638406f54f981d63c72d28c0df74d11329d66b6` | 2026-07-22 | 1/938 | — |
| `lane-a-value-alloc` | `b488ce46f35970f8d1529e1724af8bc409d12152` | 2026-07-11 | 29/1983 | — |
| `lane-a2-span-copy` | `0fd0703b1616cf61db3c6e4e8786e1d216773de8` | 2026-07-11 | 30/1983 | — |
| `lane-b-argalloc` | `4cb5989580c6a5423cc1c1b400dca931ab35c272` | 2026-07-11 | 29/1983 | — |
| `packages-restructure-plan` | `d995dc8f5738bfab0a1bd42dda56c5b8780a9c6f` | 2026-07-25 | 1/709 | origin/packages-restructure-plan |
| `parseman-034-adoption` | `a49ca59da17acbd807123b41f91627db40ca27e1` | 2026-07-24 | 1/727 | — |
| `perf/extend-lazy-chaining` | `bb92fa14dfc2114f4420dd6b76e1e9c3b3d06d7d` | 2026-07-15 | 1/1684 | — |
| `perf/extend-slice-work` | `dacd85fcd884bd30b6a5b6726b3b400299fc3ac8` | 2026-07-15 | 2/1684 | — |
| `perf/remeasure` | `7a7ce08c54bab415907a2862f5cd5a1d460442dd` | 2026-07-17 | 1/1435 | — |
| `perf/scss-parser-parse-refactors` | `b2d43002dd7d5a36c93feb14e6e8d3646aa405a8` | 2026-07-22 | 2/945 | — |
| `perf/walk-degen` | `c1b0174e43a09d980cb48aa663b19cc1fbc7e9db` | 2026-07-11 | 3/1929 | — |
| `poc/eval-dep-graph` | `32bfd8e1af1b0c51085f9eb49aabd68336e913f4` | 2026-07-15 | 1/1638 | — |
| `refactor/ampersand-merge-surface` | `04047d0a13dd169edd65042b8f35056b3f17b41b` | 2026-07-10 | 2/2018 | origin/refactor/ampersand-merge-surface |
| `root-vitest-lane` | `bb74014f9a98de231e227ea8f632b9157e53b7bc` | 2026-07-24 | 1/727 | origin/root-vitest-lane |
| `scss-cst-coverage` | `47160587800d19f3a9353825e5963dea58879829` | 2026-07-25 | 1/696 | origin/scss-cst-coverage |
| `survey/benchmark-perf-path` | `746b33ec8049b8808dc7b171820ca1f539326187` | 2026-07-16 | 1/1514 | — |
| `trace-dual-grammar` | `59af521c5b811ee517bdc606f1fadec1f6ff5a08` | 2026-07-25 | 1/710 | origin/trace-dual-grammar |
| `wip/jess-calc-grammar` | `db8bf09e1c8d8881972b2f89b12a97a3420b7907` | 2026-07-24 | 1/803 | origin/wip/jess-calc-grammar |
| `work/append-extend-gap` | `e1eac0409b8dc45e7356b4fb990109354ee226cf` | 2026-07-11 | 7/1983 | — |
| `work/dead-symbol-cleanup` | `4abb2c50a0f7646feaf78a61fd571bcd525472fb` | 2026-07-11 | 16/1983 | — |
| `work/deval-flip` | `bac41d24213b37c51fc4360de0e723257d1a4eec` | 2026-07-11 | 6/1983 | origin/work/leaky-nested-def-fold |
| `work/df-derisk2` | `b3f8dc8f5bc1633d2ce0a97174cf6fef1e5b2a31` | 2026-07-11 | 14/1983 | — |
| `work/df-hoisted-header` | `6d74da74fbaa2f192ce07f803c2a65af480e7408` | 2026-07-11 | 15/1983 | — |
| `work/docs-backtick-fix` | `acd60135f3adab8384da693c37405da46ae52037` | 2026-07-11 | 20/1983 | — |
| `work/docs-committed-direction` | `15ea93df580b46cc2a1ec3e1279e8eb948fb60de` | 2026-07-11 | 26/1983 | origin/work/docs-committed-direction |
| `work/docs-v5-visitor` | `f669cfe4d61324a02e9f7f19f73c77634e225fd2` | 2026-07-11 | 18/1983 | — |
| `work/extend-residual-fold` | `8616f4b5ffac190102c81354581fcac908269e42` | 2026-07-14 | 1/1763 | — |
| `work/extend-serialized-gap` | `e1eac0409b8dc45e7356b4fb990109354ee226cf` | 2026-07-11 | 7/1983 | — |
| `work/fix-minus-vs-vendor-ident` | `4abc097dbc98cd5d71ea355a3abf694b6a98b083` | 2026-07-11 | 26/1983 | origin/work/fix-minus-vs-vendor-ident |
| `work/fix-scss-calc-interp` | `2431c8f343f7de4ce213da3ee3cd157864226112` | 2026-07-11 | 25/1983 | — |
| `work/fix-scss-import-treectx` | `2431c8f343f7de4ce213da3ee3cd157864226112` | 2026-07-11 | 25/1983 | — |
| `work/fold-compound-ampersand-extend` | `bb3b3186324368dd0420123c8ad25b4cca3eda73` | 2026-07-11 | 28/1983 | — |
| `work/import-interp-fold` | `31ce6bd9104d1d2a542174f04adbdc5b54d85af6` | 2026-07-11 | 4/1983 | — |
| `work/import-nested-treectx` | `43dff4c3a8f319f81487e901f4e6fba1f31cac26` | 2026-07-11 | 8/1983 | — |
| `work/import-ref-cluster` | `43dff4c3a8f319f81487e901f4e6fba1f31cac26` | 2026-07-11 | 8/1983 | — |
| `work/import-ref-cluster2` | `5de9af12b874c4cdfffe1fe9238cc0eb5dec705e` | 2026-07-11 | 11/1983 | — |
| `work/import-ref-fold` | `31ce6bd9104d1d2a542174f04adbdc5b54d85af6` | 2026-07-11 | 4/1983 | — |
| `work/leaky-nested-def-fold` | `bac41d24213b37c51fc4360de0e723257d1a4eec` | 2026-07-11 | 6/1983 | origin/work/leaky-nested-def-fold |
| `work/ls-cst-analysis` | `0f0ca8d7d0d647fa7b5669f30a257dbc9fde2b58` | 2026-07-15 | 10/1925 | — |
| `work/merge-across-fold` | `7ad06ee4b9a3acdc3c2cf4cd981011e535e1c16c` | 2026-07-09 | 1/2034 | — |
| `work/mg-guarded-ns` | `6edfa7dcaa590fe56b9840806ade55359d29d69d` | 2026-07-11 | 10/1983 | — |
| `work/mg-ns-path-call` | `bac41d24213b37c51fc4360de0e723257d1a4eec` | 2026-07-11 | 6/1983 | origin/work/leaky-nested-def-fold |
| `work/mg-param-closure` | `a377eca34548a78968e397cfd6e73733ba508340` | 2026-07-11 | 9/1983 | — |
| `work/mixins-guards-df` | `a0e6d0351fd156ec454da7da39e1c40bd5f23939` | 2026-07-10 | 3/1983 | — |
| `work/p4-fold3a` | `683b5f19ef72af3f2dbe36b6269fbbd33622f949` | 2026-07-11 | 19/1983 | — |
| `work/p4-folds-12` | `2431c8f343f7de4ce213da3ee3cd157864226112` | 2026-07-11 | 25/1983 | — |
| `work/parser-error-hardening` | `e7f448467f79e14f6bbfdafda996b956b0a4b19c` | 2026-07-12 | 5/1944 | — |
| `work/perf-pass1-gate-walks` | `dcd99eb9f5a55e3ce881d714e6dd014995bb11ed` | 2026-07-11 | 27/1983 | — |
| `work/ref-sharedbody-close` | `b3f8dc8f5bc1633d2ce0a97174cf6fef1e5b2a31` | 2026-07-11 | 14/1983 | — |
| `work/refbody-flake-fix` | `3498eecdc5ef716d1d2b0674473c3f19d6da6da1` | 2026-07-11 | 24/1983 | — |
| `work/refext-mech2` | `3c85b9da5a06b8e9e2f38d00c3c8bc7b7a2551fd` | 2026-07-11 | 12/1983 | — |
| `work/refgate-open` | `03a43c270d4c0af1ac460b00a801c5d14b630cad` | 2026-07-11 | 13/1983 | — |
| `work/refimport-wire` | `03a43c270d4c0af1ac460b00a801c5d14b630cad` | 2026-07-11 | 13/1983 | — |
| `work/s3-cross-sibling-merge` | `50477fd0f4f1d595a639e550e2e5628a47eb7cd0` | 2026-07-11 | 5/1983 | — |
| `work/spine-visitor-hook` | `e5fb2a660bd4273cff42aed5091af45437760e6b` | 2026-07-11 | 17/1983 | — |
| `work/test-migration` | `71b13216ccfec4030e17cbd594165ff5ddfbb324` | 2026-07-11 | 23/1983 | — |
| `work/tier-c-native-fns` | `27be4d4ee02db82e0b1dd0715784125adbbf7144` | 2026-07-16 | 1/1577 | origin/work/tier-c-native-fns |
| `work/value-shape-bakeoff` | `1cd5afbf622decce820c17a29a7b3757484f35e4` | 2026-07-16 | 1/1592 | — |
| `work/value-shape-spec` | `b1ac2c393c3f5cfb363bff837bb23e0aef47060d` | 2026-07-16 | 1/1601 | — |
| `work/wrapper-root-spine` | `4abb2c50a0f7646feaf78a61fd571bcd525472fb` | 2026-07-11 | 16/1983 | — |
| `worktree-agent-a00486ceee36870d0` | `4668066a5bbb689c08219bdbe125e45fd50a4fda` | 2026-07-13 | 18/7319 | — |
| `worktree-agent-a494ac827a8785558` | `7cdc9865256e7b03143b35f64118d28a762c8a0a` | 2026-07-12 | 1/1903 | — |
| `worktree-agent-a8eb72dcf13b7daba` | `032753e48672a3db400efb9ade08ccaa237a9939` | 2026-07-22 | 1/914 | — |
