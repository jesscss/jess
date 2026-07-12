import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

// The parseman macro plugin compiles grammars that import `with { type: 'macro' }`
// to optimized JS at build time. No-op for sources without the macro attribute.
export default defineConfig(createSingleEntryConfig({
  plugins: [parseman.rolldown()]
}));
