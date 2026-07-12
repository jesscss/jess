import type { UserConfig } from 'tsdown';

export function createSingleEntryConfig(overrides: UserConfig = {}): UserConfig {
  return {
    entry: './src/index.ts',
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
      const nextOptions = {
        ...options,
        codeSplitting: false
      };

      if (format === 'cjs') {
        return {
          ...nextOptions,
          exports: 'named'
        };
      }

      return nextOptions;
    },
    ...overrides
  };
}
