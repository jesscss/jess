# Releasing Jess alpha packages to npm

This runbook defines the alpha release process for the Less v5 support track.

Before using the publish commands, check
[`less-v5-alpha-readiness.md`](./less-v5-alpha-readiness.md). That tracker owns
the current readiness gates for API stability, expanded Less API coverage, and
CI guard work.

The candidate must also keep the F5 deferred CSS color-call gate recorded there
green: CSS-shaped three-or-more-slot and un-operated relative `rgb()`/`hsl()`
calls are verbatim until value demand, while Less one-/two-slot overloads
dispatch normally and malformed arities use the existing evaluator
`functionMode` policy. The focused evidence is 17/17 in
`function-error-public-semantics.test.ts`.

## Initial publish scope

The alpha stream publishes only allowlisted packages in `scripts/release/alpha-allowlist.json`:

- `@jesscss/awaitable-pipe`
- `@jesscss/core`
- `@jesscss/css-parser`
- `@jesscss/plugin-css`
- `@jesscss/jess-parser`
- `@jesscss/less-parser`
- `@jesscss/scss-parser`
- `@jesscss/fns`
- `styles-config`
- `@jesscss/style-resolver`
- `@jesscss/plugin-jess`
- `@jesscss/plugin-less`
- `@jesscss/plugin-scss`
- `@jesscss/plugin-node-modules`
- `@jesscss/plugin-js`
- `@jesscss/plugin-less-compat`
- `@jesscss/patch-css`
- `jess`

> **Dialect closure.** `jess` statically registers the direct AST parser plugins
> for `.jess`, `.less`, and `.scss`, so their parser/plugin dependency closures
> are in the alpha set. `@jesscss/plugin-css` is also shipped so consumers can
> explicitly configure CSS document parsing/inlining through Context. Jess does
> not install or route it by default, and it does not make CSS a separate
> compilation mode. `@jesscss/css-parser` remains in the set because the shipped
> dialect grammars depend on its shared CSS grammar.
>
> **`@jesscss/scss-parser` + `@jesscss/plugin-scss` were promoted into the alpha
> set** (owner decision, commit `d939fb3`): `jess` statically imports
> `plugin-scss` and registers it on every render, and `plugin-scss` depends on
> `scss-parser`, so both must publish for `jess` to resolve. They are live on npm
> at the current alpha. SCSS remains a non-goal for the alpha's *feature* scope —
> these are shipped only to satisfy `jess`'s dependency graph. If the owner
> prefers to keep SCSS entirely out of the published set, the alternative is to
> make `jess`'s `plugin-scss` dependency non-blocking (optional/peer, or a
> lazy/guarded registration) and drop both from the allowlist; that is a separate
> product decision and is NOT assumed here.

Blocked from the initial alpha set (do not publish yet):

- `rollup-plugin-jess` (depends on `jess`; it is a separate bundler integration,
  not part of the runtime package closure)

## Branch and version policy

- Publish alpha packages from branch `alpha`.
- Cut each Jess alpha by **squash-merging the validated current `dev` snapshot
  into `alpha`**. `alpha` is a release-snapshot branch, not a normal integration
  branch: do not ordinary-merge or rebase `dev` into it.
- Use lockstep versions for publishable packages (Changesets fixed group already configured).
- Alpha publishes use npm dist-tag `alpha`.
- For alpha publishes, package versions must include `-alpha.N`.
- Hard guardrails:
  - `--tag alpha` publishes are allowed only from `alpha`.
  - non-alpha tags (future stable releases) are allowed only from `main`.

## Publish order for the external Less alpha

The Jess alpha and the external `less@5.0.0-alpha.1` package are separate
releases. Jess `2.0.0-alpha.9` must be published and verified in the packed
consumer first. The sibling Less repository keeps `link:` dependencies during
local development; its alpha publish script requires `JESS_VERSION` and
temporarily rewrites the four Jess runtime dependencies (`@jesscss/core`,
`@jesscss/plugin-less`, `@jesscss/plugin-less-compat`, and `jess`) to that
exact registry version while packing/publishing, then restores the local
manifest. Publish Less only after the Jess alpha.9 artifacts are queryable:

```bash
JESS_VERSION=2.0.0-alpha.9 npm publish --tag alpha --access public
```

The Less package's built `lessc` smoke test and typecheck are the publish
preflight. Its full upstream node suite still reports the classified v5
known-limitations inventory; those failures are documented in
[`less-v5-alpha-readiness.md`](./less-v5-alpha-readiness.md) and must not be
silently relabeled as passing.

## Cut the alpha snapshot from `dev`

Do this only after the exact `dev` candidate has passed its intended readiness
and release checks. Start from an up-to-date, clean `alpha` worktree, then make
one squash commit containing the current `origin/dev` state:

```bash
git fetch origin
git switch alpha
git pull --ff-only origin alpha
git merge --squash origin/dev
# Review the snapshot and add the curated user-facing changelog/release notes.
git commit
```

The squash commit must include proper, owner-reviewed release notes/changelog
for the user-visible changes in that alpha. Do not rely on commit history being
preserved by the squash, and do not silently omit this step because the version
bump is performed later.

For the first Less-focused alpha, the release notes must also include a
discoverable **Known limitations** section linking
[`less-v5-alpha-readiness.md`](./less-v5-alpha-readiness.md). The 30 runnable
upstream expected-failure markers are classified compatibility evidence, not a
requirement to drain before alpha. Do not omit them or call them passing; block
only on the advertised public-route, package/CLI, and core-safety gates.

The current draft source for the next cut is
[`docs/releases/jess-2.0.0-alpha.9.md`](./releases/jess-2.0.0-alpha.9.md).
It is deliberately marked as a draft: update it from the exact gate evidence
before the squash, and do not use it as a substitute for the readiness trackers.

The current `release:alpha` scripts do **not** run `changeset version` or
generate package `CHANGELOG.md` files. They resolve a fresh lockstep alpha
version from npm before the preflight, but defer writing package versions until
the preflight succeeds. During that preflight the fresh candidate is passed to
the nested publish dry-run through an internal environment hand-off; this keeps
the clobber guard active without treating the post-squash snapshot's previous
manifest version as the candidate. The real package-version write happens just
before the release commit.
The repository's Changesets configuration remains useful for future changelog
automation, but is not evidence that a changelog was generated by this release
flow.

After the squash snapshot is committed, run the preflight and release commands
from `alpha` as described below. Do not copy `dev`'s placeholder version onto
`alpha` manually: the release script's registry-aware resolver selects a fresh
version. Its alpha-clobber guard deliberately rejects a squashed snapshot whose
manifest version is at or behind an already-published alpha.

### Moving the `latest` dist-tag during the alpha phase (gated, off by default)

By default the alpha flow only touches the `alpha` dist-tag, so a package's
`latest` tag can drift far behind (e.g. `jess@latest` stuck on an old `1.0.8`
build while `jess@alpha` is `2.0.0-alpha.N`). During this pre-stable phase that
means `npm install jess` pulls an ancient build, and newly-created packages —
which npm auto-tags `latest` on first publish — end up inconsistent with the
rest of the set.

To also move `latest` to the just-published alpha version, opt in explicitly:

```bash
pnpm run release:alpha -- --set-latest
# or, publish step only:
node scripts/release/publish-alpha.mjs --tag alpha --set-latest
# or via env (CI): ALPHA_SET_LATEST=1
```

This is **off by default and gated behind the flag on purpose**: it deliberately
relaxes the "non-alpha tags only from `main`" guardrail for the pre-stable phase.
Enable it only when you intend `latest` to track the current alpha. Once stable
releases begin from `main`, stop using `--set-latest` so `latest` follows stable.

### Smoke check tolerates registry propagation lag

After publishing, the orchestrator smoke-checks each package's `alpha` tag on
npm. Newly-created scoped packages (and fresh versions) can take tens of seconds
to become queryable via `npm view`, so the check **polls with backoff** before
reporting anything missing. A package that has not appeared yet is reported as a
propagation warning — not a failed publish. Do not treat a transient smoke-check
miss as an E404/publish failure; re-check with `npm view <pkg>@alpha version` or
re-run `pnpm run release:alpha:publish` (already-published versions are skipped).

## One-command release

Run this from repo root on branch `alpha`:

```bash
pnpm run release:alpha
```

What it does for you:

1) Safety checks (`alpha` branch + clean working tree except `.cursor/*`)
2) Registry-aware lockstep alpha-version resolution (without mutating manifests)
3) Full preflight (`release:alpha:check`: release build, strict production
   types, bounded production-source lint, Less-alpha, AST-v2 production-route
   ratchet, baseline, aggressive-cutting, allowlist, packed clean-consumer, and
   dry-run publish checks) against that resolved candidate
4) Apply the lockstep version and update the lockfile
5) Commit + annotated tag (`vX.Y.Z-alpha.N`)
6) Push branch + tag to origin
7) Publish allowlisted packages to npm tag `alpha`
8) Smoke-check npm `@alpha` dist-tags

Practice first without touching git/npm:

```bash
pnpm run release:alpha:dry-run
```

### Packed clean-consumer proof

`pnpm run verify:alpha:packed-consumer` packs every allowlisted package and
installs only those tarballs into an empty temporary npm consumer. It then
checks ESM and CJS package roots, the packed `jess` and `lessc` commands
(stdin, files, sibling imports, and a malformed-input diagnostic), and the
optional `@jesscss/plugin-js` sandbox-runtime gate. The install uses no workspace
links; this is the release gate that proves the package closure a user will
actually receive. Pass `-- --keep` only while debugging to retain its temporary
consumer directory.

### Strict source-quality proof

The release build may use declaration/bundle tooling that passes `--noCheck`.
That build success is not a type-quality result. Immediately after the release
build, `pnpm run verify:types` runs `tsc -p tsconfig.build.json --noEmit` for
every workspace build config in dependency order, without `--noCheck`. Every
invocation selects the root workspace's pinned TypeScript compiler; a nested or
package-local binary cannot change the accepted syntax or manufacture toolchain
diagnostics. It runs all configs before failing so the release report identifies
every package that still owns source diagnostics.

`pnpm run lint:production` checks only the bounded production surfaces under
`packages/*/src/**` and `scripts/**`; repository-root scratch files and build
artifacts cannot enter through a worktree-wide shell glob. Test files and test
directories are intentionally outside that release gate and remain available
through the separate `pnpm run lint:test` command. A candidate is not green
unless both strict production checks pass.

## First publish (2.0.0-alpha.1)

When no allowlisted package has been published on the `alpha` tag, the normal
resolver preserves the intended `2.0.0-alpha.1` manifest version. Run the normal
release command after cutting the snapshot; no separate Changesets version step
is part of this script:

```bash
pnpm run release:alpha
```

For subsequent releases, repeat the validated `dev` → `alpha` squash-cut and
changelog step. The resolver selects the next unpublished lockstep alpha version
when the snapshot's manifest version is stale. `--skip-version` is a recovery
option for an already-prepared manifest, not the normal release procedure.

## Modular commands (advanced/manual flow)

- Preflight only (when run directly, alpha manifests must already carry a fresh
  candidate; the one-command orchestrator resolves and forwards that candidate
  automatically):

```bash
pnpm run release:alpha:check
```

- Version only:

```bash
pnpm run release:alpha:version
```

- Publish only:

```bash
pnpm run release:alpha:publish
```

## CI publishing

- Workflow: `.github/workflows/publish-alpha.yml`
- Trigger: manual `workflow_dispatch` only
- CI runs:
  - install
  - `release:alpha:check`
  - `release:alpha:publish`
- Purpose: manual backup path when you want GitHub Actions to perform publish, not the default daily flow.
- The workflow itself also enforces branch `alpha` before publish.

## CI readiness

- Workflow: `.github/workflows/less-alpha-readiness.yml`
- Triggers: pull requests, pushes to `main` and `alpha`, and manual `workflow_dispatch`
- CI runs `pnpm run verify:less-alpha`, which covers:
  - publishable `jess` build
  - package export validation
  - API Extractor public declaration/API report validation
  - public `jess` API contract tests
  - Node path-resolution tests
  - expanded Less unit and config fixture readiness lanes

This workflow does not publish. It is the normal guard that should fail before
the manual publish path is attempted.

The publish script is idempotent for existing versions: if `<pkg>@<version>` already exists on npm, it is skipped.

## Rollback and incident handling

- Avoid unpublish except for truly accidental immediate publishes and only within npm policy windows.
- Preferred recovery:
  - ship a new `-alpha.N+1` version
  - keep the existing bad alpha as historical
- If one package fails during publish:
  - fix root cause
  - rerun `pnpm run release:alpha:publish` (already-published packages are skipped)

Useful orchestrator flags:

- `--no-push` (keep commit/tag local for inspection)
- `--skip-version` (skip registry-aware manifest version resolution when the
  manifests already contain the intended fresh alpha version)
- `--skip-publish` (prepare commit/tag/push without npm publish)
- `--skip-check` (skip the heavy step-2 preflight `release:alpha:check` — use only for a republish when the current tree was already verified; the default remains full-check)

`--skip-check` is the canonical way to skip the preflight while still running the
normal release orchestrator: it resolves/applies the registry-aware version,
commits and tags the snapshot, explicitly builds each publishable package, and
publishes with `pnpm publish --ignore-scripts`. The publish script intentionally
does not invoke package `prepublishOnly` hooks; the explicit build step is the
release build. Use this only for a republish whose candidate has already passed
the full checks. The separate `release:alpha:ship-no-checks`
(`scripts/release/ship-alpha-no-checks.mjs`) is an emergency fast path with its
own manifest bump logic and no preflight; it also publishes with
`--ignore-scripts` and should not be the normal alpha path.

## Promoting blocked packages into alpha

Before adding any blocked package to `scripts/release/alpha-allowlist.json`:

1) Remove runtime dependency blockers (`private: true` or non-allowlisted workspace dependencies).
2) Confirm the package is not `private` and has valid publish metadata.
3) Run `pnpm run release:alpha:check` to validate the set.
4) Update this runbook's publish scope list in the same PR.
