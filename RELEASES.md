# Jess Releases

This file is the practical release guide for Jess package publishing.

For alpha publishing details and package scope, see `docs/releasing-alpha.md`.

## Alpha release quick start

From repo root:

```bash
pnpm run release:alpha:friendly:dry-run
```

If the dry-run is clean and you are on the `alpha` branch:

```bash
pnpm run release:alpha
```

## What `release:alpha` does

1. Verifies branch and working tree safety.
2. Runs the baseline gate and alpha allowlist checks.
3. Runs lockstep versioning via Changesets.
4. Creates a release commit and annotated tag.
5. Pushes branch + tag to origin.
6. Publishes allowlisted packages to npm with `alpha` tag.
7. Runs npm tag smoke checks.

## Safety rules

- Do not publish from non-`alpha` branch.
- Keep blocked packages out of `scripts/release/alpha-allowlist.json`.
- If baseline fails, fix baseline first; do not bypass.
- Avoid unpublish; prefer shipping the next `-alpha.N+1`.
- Branch/tag policy is enforced by script:
  - `alpha` tag -> only from `alpha` branch
  - non-alpha tags -> only from `main` branch

## Useful commands

- Preflight only: `pnpm run release:alpha:check`
- Version only: `pnpm run release:alpha:version`
- Publish only: `pnpm run release:alpha:publish`
- Dry-run publish only: `pnpm run release:alpha:dry-run`

## If publish partially fails

1. Fix the package-level failure.
2. Re-run `pnpm run release:alpha:publish`.
3. Already-published versions are skipped automatically.

## CI backup (manual only)

- Workflow: `.github/workflows/publish-alpha.yml`
- Trigger: `workflow_dispatch` only
- Recommended default is still CLI (`pnpm run release:alpha`) so release ownership stays explicit.
