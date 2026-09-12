# Jess Releases

This file is the practical release guide for Jess package publishing.

For alpha publishing details and package scope, see `docs/process/releasing-alpha.md`.

## Alpha release quick start

An alpha is first cut as a **squash snapshot of validated `dev` on `alpha`**;
it is not an ordinary merge or rebase of `dev` into the release branch. Include
the owner-reviewed user-facing changelog/release notes in that squash commit.
The detailed cut procedure and its version-resolver caveat are in
[`docs/process/releasing-alpha.md`](./docs/process/releasing-alpha.md#cut-the-alpha-snapshot-from-dev).

Only after that committed snapshot is checked out on `alpha`, run from repo root:

```bash
pnpm run release:alpha:dry-run
```

If the dry-run is clean and you are on the `alpha` branch:

```bash
pnpm run release:alpha
```

## What `release:alpha` does

1. Verifies branch and working tree safety.
2. Runs the baseline gate and alpha allowlist checks.
3. Resolves and writes a fresh lockstep alpha version from the npm registry.
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
- Dry-run full flow: `pnpm run release:alpha:dry-run`

## If publish partially fails

1. Fix the package-level failure.
2. Re-run `pnpm run release:alpha:publish`.
3. Already-published versions are skipped automatically.

## Publishing via CI (OIDC trusted publishing)

- Workflow: `.github/workflows/publish-alpha.yml`
- Trigger: `workflow_dispatch` only (release ownership stays explicit — a publish
  is never a side effect of a push or merge).
- Publishes to npm with OIDC trusted publishing — no npm token is stored.
- Runs `release:alpha:check` (full preflight) first; a failing preflight stops it
  before anything reaches npm.
- On a successful publish it pushes the annotated release tag `vX.Y.Z-alpha.N`, so
  the repo mirrors npm exactly like the local `pnpm run release:alpha` flow does.
- Requires the `alpha` branch to already carry the cut's resolved version (the
  `update-alpha-from-dev` cut writes it), which it will on a correctly cut snapshot.

### First-time setup: register the trusted publisher (per package)

OIDC publishing only works once each allowlisted package has a GitHub Actions
trusted publisher registered on npmjs.com (repo `jesscss/jess`, workflow
`publish-alpha.yml`). Without it the publish fails with `npm error 404 … could not
be found or you do not have permission`. Configure all allowlisted packages at once
(npm CLI >= 11.10.0, logged in with publish rights):

```bash
npm login            # if `npm whoami` fails
pnpm run release:alpha:trust
```

This reads `scripts/release/alpha-allowlist.json`, so re-run it after adding a new
package to the release set.
