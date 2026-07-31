import { defineConfig } from 'tsdown';
import { readdirSync } from 'node:fs';
import parseman from 'parseman/plugin';

const probes = readdirSync(new URL('.', import.meta.url))
  .filter(name => /^p\d+-.*\.ts$/.test(name))
  .map(name => name.replace(/\.ts$/, ''));

export default defineConfig(probes.map(name => ({
  entry: { [name]: `./${name}.ts` },
  format: ['esm'] as const,
  dts: false,
  outDir: './probe-lib',
  platform: 'node' as const,
  fixedExtension: false,
  hash: false,
  clean: false,
  deps: { onlyBundle: false },
  plugins: [parseman.rolldown()]
})));
