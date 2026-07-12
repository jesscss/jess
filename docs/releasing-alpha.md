# Releasing Jess alpha packages to npm

This runbook defines the alpha release process for the Less v5 support track.

## Initial publish scope

The alpha stream publishes only allowlisted packages in `scripts/release/alpha-allowlist.json`:

- `@jesscss/awaitable-pipe`
- `@jesscss/core`
- `@jesscss/css-parser`
- `@jesscss/less-parser`
- `@jesscss/fns`
- `styles-config`
- `@jesscss/style-resolver`
- `@jesscss/plugin-less`
- `@jesscss/plugin-node-modules`
- `@jesscss/plugin-js`
- `@jesscss/plugin-less-compat`
- `@jesscss/patch-css`
- `jess`

Blocked (do not publish in alpha yet):

- `@jesscss/plugin-scss` (runtime dependencies on `@jesscss/style-resolver` and `@jesscss/scss-parser`)
- `@jesscss/parser` (runtime dependency on `@jesscss/scss-parser`)
- `rollup-plugin-jess` (depends on `jess`)

## Branch and version policy

- Publish alpha packages from branch `alpha`.
- Use lockstep versions for publishable packages (Changesets fixed group already configured).
- Alpha publishes use npm dist-tag `alpha`.
- For alpha publishes, package versions must include `-alpha.N`.
- Hard guardrails:
  - `--tag alpha` publishes are allowed only from `alpha`.
  - non-alpha tags (future stable releases) are allowed only from `main`.

## One-command release

Run this from repo root on branch `alpha`:

```bash
pnpm run release:alpha
```

What it does for you:

1) Safety checks (`alpha` branch + clean working tree except `.cursor/*`)
2) Full preflight (`release:alpha:check`: baseline + allowlist validation + dry-run publish)
3) Versioning (`changeset version`)
4) Commit + annotated tag (`vX.Y.Z-alpha.N`)
5) Push branch + tag to origin
6) Publish allowlisted packages to npm tag `alpha`
7) Smoke-check npm `@alpha` dist-tags

Practice first without touching git/npm:

```bash
pnpm run release:alpha:dry-run
```

## First publish (2.0.0-alpha.1)

To publish the current versions as-is without bumping:

- **Option A:** Ensure no changeset files in `.changeset/` (only `README.md`). Then `pnpm run release:alpha`. With no changesets, `changeset version` does nothing and versions stay at 2.0.0-alpha.1.
- **Option B:** `pnpm run release:alpha -- --skip-version` — skips the version step entirely.

For subsequent releases, add changesets (`pnpm changeset add`) before running `release:alpha`; the version step will bump to 2.0.0-alpha.2, etc.

## Modular commands (advanced/manual flow)

- Preflight only:

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
- `--skip-version` (skip changeset version step if already versioned)
- `--skip-publish` (prepare commit/tag/push without npm publish)

## Promoting blocked packages into alpha

Before adding any blocked package to `scripts/release/alpha-allowlist.json`:

1) Remove runtime dependency blockers (`private: true` or non-allowlisted workspace dependencies).
2) Confirm the package is not `private` and has valid publish metadata.
3) Run `pnpm run release:alpha:check` to validate the set.
4) Update this runbook's publish scope list in the same PR.
