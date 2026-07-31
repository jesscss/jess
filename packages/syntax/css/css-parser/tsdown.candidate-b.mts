import { defineConfig } from 'tsdown';
import parseman from 'parseman/plugin';

/** Candidate-B tournament scaffolding: isolated builds for byte measurement. */
export default defineConfig([
  {
    entry: { 'probe-floor-with': './src/probe-floor-with.ts' },
    format: ['esm'],
    dts: false,
    outDir: './probe',
    platform: 'node',
    fixedExtension: false,
    hash: false,
    clean: false,
    deps: { onlyBundle: false },
    plugins: [parseman.rolldown()]
  },
  {
    entry: { 'probe-floor-all': './src/probe-floor-all.ts' },
    format: ['esm'],
    dts: false,
    outDir: './probe',
    platform: 'node',
    fixedExtension: false,
    hash: false,
    clean: false,
    deps: { onlyBundle: false },
    plugins: [parseman.rolldown()]
  }
,
  {
    entry: { 'grammar-candidate-b': './src/grammar-candidate-b.ts' },
    format: ['esm'],
    dts: false,
    outDir: './probe',
    platform: 'node',
    fixedExtension: false,
    hash: false,
    clean: false,
    deps: { onlyBundle: false },
    plugins: [parseman.rolldown()]
  }
,
  {
    entry: { 'probe-childindex': './src/probe-childindex.ts' },
    format: ['esm'], dts: false, outDir: './probe', platform: 'node',
    fixedExtension: false, hash: false, clean: false,
    deps: { onlyBundle: false }, plugins: [parseman.rolldown()]
  }
]);
