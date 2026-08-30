# Jess Docs Site

This package is the Jess-facing Docusaurus renderer.

Canonical docs content lives in `packages/docs/docs-content` and is shared with the Less-facing site.

## Local development

```bash
pnpm --filter jess-docs dev
```

## Build

```bash
pnpm --filter jess-docs build
```

## Deploy

The Pages site publishes the generated Docusaurus site from the root of the
`master` branch in `jesscss/jesscss.github.io`. The source content comes from
the `alpha` branch of this repository. Deploy it with:

```bash
pnpm --filter jess-docs run deploy:matthew
```

## Canonical content workflow

- Author docs in `packages/docs/docs-content/docs/**`
- Sync current Jess docs baseline into canonical package: **not currently wired.**
  The `migrate:jess` script referenced here (and the root
  `docs:content:migrate:jess` alias) does not exist in
  `packages/docs/docs-content/package.json`. The scripts that do exist are
  `import:less`, `normalize`, `validate`, and `build:facings`.
- Import the Less docs corpus:
  - `pnpm --filter @jesscss/docs-content run import:less -- --source /path/to/less-docs`
- Validate docs metadata:
  - `pnpm --filter @jesscss/docs-content run validate`
