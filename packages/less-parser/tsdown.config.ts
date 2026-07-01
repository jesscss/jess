import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';
import { createSingleEntryConfig } from '../../tools/tsdown/single-entry.mts';

export default defineConfig(createSingleEntryConfig({
  plugins: [parseman.rolldown()]
}));
