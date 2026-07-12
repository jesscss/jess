# Jess Docs Site

This package is the Jess-facing Docusaurus renderer.

Canonical docs content lives in `packages/docs-content` and is shared with the Less-facing site.

## Local development

```bash
pnpm --filter jess-docs dev
```

## Build

```bash
pnpm --filter jess-docs build
```

## Canonical content workflow

- Author docs in `packages/docs-content/docs/**`
- Sync current Jess docs baseline into canonical package:
  - `pnpm --filter @jesscss/docs-content run migrate:jess`
- Validate docs metadata:
  - `pnpm --filter @jesscss/docs-content run validate`
