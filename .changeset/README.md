# Changesets

This folder configures [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

## What's in here

- **config.json** — Changeset configuration (fixed group, changelog, etc.)
- **README.md** — This file (not a changeset; ignored by `changeset version`)
- **\*.md** (e.g. `brave-moles-work.md`) — Changeset files that describe version bumps

## How it works

1. **Add a changeset** when you make a change: `pnpm changeset add`
2. **Version** (during release): `pnpm run release:alpha:version` runs `changeset version`, which:
   - Reads all changeset files
   - Bumps package versions according to the changes
   - Deletes the changeset files (they're consumed)
3. **If there are no changeset files** — `changeset version` does nothing; versions stay the same. That's why the first alpha publish (2.0.0-alpha.1) works with an "empty" folder: README and config aren't changesets.

## First publish

For the first alpha (2.0.0-alpha.1), don't add changesets. Run `pnpm run release:alpha` — versions stay as-is.

For subsequent releases, add changesets before running release.
