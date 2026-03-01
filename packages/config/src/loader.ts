import { cosmiconfig, cosmiconfigSync, defaultLoadersSync } from 'cosmiconfig';
import type { StylesConfig } from './types.js';

export interface LoadedConfigMeta {
  config: StylesConfig;
  configFilePath?: string;
}

const explorer = cosmiconfig('styles', {
  searchPlaces: [
    'styles.config.ts',
    'styles.config.js',
    'styles.config.mts',
    'styles.config.mjs',
    'styles.config.cjs',
    'styles.config.cts'
  ],
  loaders: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.mts': defaultLoadersSync['.ts'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.cts': defaultLoadersSync['.ts'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.mjs': defaultLoadersSync['.js'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.cjs': defaultLoadersSync['.cjs']
  }
});

const explorerSync = cosmiconfigSync('styles', {
  searchPlaces: [
    'styles.config.ts',
    'styles.config.js',
    'styles.config.mts',
    'styles.config.mjs',
    'styles.config.cjs',
    'styles.config.cts'
  ],
  loaders: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.mts': defaultLoadersSync['.ts'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.cts': defaultLoadersSync['.ts'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.mjs': defaultLoadersSync['.js'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.cjs': defaultLoadersSync['.cjs']
  }
});

/**
 * Load styles configuration from the file system (async)
 * @param searchFrom - Directory to search from (defaults to process.cwd())
 * @returns Configuration object or null if not found
 */
export async function loadConfig(searchFrom?: string): Promise<StylesConfig | null> {
  const result = await explorer.search(searchFrom);
  return result?.config ? normalizeConfig(result.config) : null;
}

/**
 * Load styles configuration from the file system (sync)
 * @param searchFrom - Directory to search from (defaults to process.cwd())
 * @returns Configuration object or empty object if not found
 */
export function loadConfigSync(searchFrom?: string): StylesConfig {
  const result = explorerSync.search(searchFrom);
  return result?.config ? normalizeConfig(result.config) : {};
}

/**
 * Load styles configuration with metadata (sync).
 * Includes config file path when a config file is discovered.
 */
export function loadConfigSyncWithMeta(searchFrom?: string): LoadedConfigMeta {
  const result = explorerSync.search(searchFrom);
  return {
    config: result?.config ? normalizeConfig(result.config) : {},
    configFilePath: result?.filepath
  };
}

/**
 * Load styles configuration from a specific file path (async)
 * @param filePath - Path to the config file
 * @returns Configuration object or null if not found
 */
export async function loadConfigFromPath(filePath: string): Promise<StylesConfig | null> {
  const result = await explorer.load(filePath);
  return result?.config ? normalizeConfig(result.config) : null;
}

/**
 * Load styles configuration from a specific file path (sync)
 * @param filePath - Path to the config file
 * @returns Configuration object or empty object if not found
 */
export function loadConfigFromPathSync(filePath: string): StylesConfig {
  const result = explorerSync.load(filePath);
  return result?.config ? normalizeConfig(result.config) : {};
}

/**
 * Normalize config object - handle default exports and ensure proper type
 */
function normalizeConfig(config: any): StylesConfig {
  // Handle default export (common in ES modules)
  if (typeof config === 'object' && config !== null && 'default' in config) {
    return config.default as StylesConfig;
  }
  return config as StylesConfig;
}
