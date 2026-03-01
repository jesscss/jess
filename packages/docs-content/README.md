# Canonical Docs Content

`@jesscss/docs-content` is the single source of truth for docs content used by:

- `jess-docs` (`packages/docs`) for the Jess-facing site
- `@jesscss/docs-less` (`packages/docs-less`) for the Less-facing site

## Content layout

- `docs/jess/**` - Jess docs content
- `docs/less/**` - Less docs content imported from `less/less-docs`

## Scripts

- `pnpm --filter @jesscss/docs-content run migrate:jess`
  - Copies `packages/docs/docs/**` into `packages/docs-content/docs/jess/**`
- `pnpm --filter @jesscss/docs-content run import:less -- --source /path/to/less-docs`
  - Imports markdown from `less-docs/content/**` into `packages/docs-content/docs/less/**`
- `pnpm --filter @jesscss/docs-content run normalize`
  - Normalizes frontmatter defaults for docs metadata
- `pnpm --filter @jesscss/docs-content run validate`
  - Validates docs have required frontmatter and non-empty content

## Authoring policy

Edit docs in this package only. Site packages should be renderers, not source stores.
