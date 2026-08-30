import { defineConfig } from 'tsdown';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

/*
 * linecraft is ESM-only (its package `exports` expose only an `import`
 * condition), so a CJS consumer that `require()`s @jesscss/lint cannot resolve
 * it. Bundle it into the output — the same treatment @jesscss/compiler gives it
 * — so the published CJS root is self-contained.
 */
export default defineConfig(createSingleEntryConfig({
  deps: {
    alwaysBundle: ['linecraft'],
    onlyBundle: ['linecraft']
  }
}));
