import { defineConfig, type UserConfig } from 'tsdown';

// Two entry points: the programmatic engine API (`index`) and the LSP server
// binary (`server`, spawned by the VS Code extension). Both emit ESM + CJS into
// `lib/`, matching the package.json `exports` map. Mirrors the shared
// `createSingleEntryConfig` helper, but keeps code-splitting on (required for
// multiple entries — the shared engine code becomes a common chunk).
const config: UserConfig = {
  entry: ['./src/index.ts', './src/server.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: './lib',
  platform: 'node',
  fixedExtension: false,
  hash: false,
  deps: {
    onlyBundle: false
  },
  outputOptions(options, format) {
    if (format === 'cjs') {
      return { ...options, exports: 'named' };
    }
    return options;
  }
};

export default defineConfig(config);
