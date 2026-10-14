import { cosmiconfig, cosmiconfigSync, defaultLoadersSync, type CosmiconfigResult, type OptionsSync } from 'cosmiconfig';
import fs from 'fs';
import path from 'path';
import { mergeConfigs } from './options.js';
import type { StylesConfig } from './types.js';

export interface LoadedConfigMeta {
  config: StylesConfig;
  configFilePath?: string;

  /** What the file at `configFilePath` sets by itself, before the configs above it merge in. */
  ownConfig?: StylesConfig;
}

/**
 * A search finds the nearest `styles.config.*`: in the start folder, else the
 * nearest folder above it, stopping at the first folder with a `package.json`
 * (the package root), which is searched too (DESIGN-DECISIONS O19).
 */
const explorerOptions: Partial<OptionsSync> = {
  searchStrategy: 'project',
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
};

const explorer = cosmiconfig('styles', explorerOptions);

const explorerSync = cosmiconfigSync('styles', explorerOptions);

/**
 * Where to look for the next config above the one at `filepath`: its folder's
 * parent, or none when its folder is the package root (has a `package.json` or
 * `package.yaml`, where cosmiconfig's `project` search stops) or the file-system root.
 */
function searchAbove({ filepath }: { filepath: string }): string | undefined {
  const dir = path.dirname(filepath);
  const parent = path.dirname(dir);
  const packageRoot = ['package.json', 'package.yaml'].some(name => fs.existsSync(path.join(dir, name)));
  return parent === dir || packageRoot ? undefined : parent;
}

/** The configs found, nearest first, merged: the nearest wins setting by setting ({@link mergeConfigs}). */
function mergeFound(found: ReadonlyArray<{ config: unknown; filepath: string }>): LoadedConfigMeta {
  const configs = found.map(result => normalizeConfig(result.config));
  return {
    config: configs.reduceRight<StylesConfig>((merged, config) => mergeConfigs(merged, config), {}),
    configFilePath: found[0]?.filepath,
    ownConfig: configs[0] ?? {}
  };
}

/**
 * Load styles configuration from the file system (async): every config from
 * `searchFrom` up to the package root, merged ({@link loadConfigSyncWithMeta}).
 * @param searchFrom - Directory to search from (defaults to process.cwd())
 * @returns Configuration object or null if not found
 */
export async function loadConfig(searchFrom?: string): Promise<StylesConfig | null> {
  const found: Array<NonNullable<CosmiconfigResult>> = [];
  let result = await explorer.search(searchFrom);
  while (result) {
    found.push(result);
    const above = searchAbove(result);
    result = above === undefined ? null : await explorer.search(above);
  }
  return found.length > 0 ? mergeFound(found).config : null;
}

/**
 * Load styles configuration from the file system (sync): every config from
 * `searchFrom` up to the package root, merged ({@link loadConfigSyncWithMeta}).
 * @param searchFrom - Directory to search from (defaults to process.cwd())
 * @returns Configuration object or empty object if not found
 */
export function loadConfigSync(searchFrom?: string): StylesConfig {
  return loadConfigSyncWithMeta(searchFrom).config;
}

/**
 * Load styles configuration with metadata (sync). Every `styles.config.*` from
 * `searchFrom` up to the package root (the first folder with a `package.json`,
 * itself included) is merged, the nearest winning setting by setting
 * (DESIGN-DECISIONS O19). `configFilePath` is the nearest one, and `ownConfig`
 * what that file sets by itself.
 */
export function loadConfigSyncWithMeta(searchFrom?: string): LoadedConfigMeta {
  const found: Array<NonNullable<CosmiconfigResult>> = [];
  let result = explorerSync.search(searchFrom);
  while (result) {
    found.push(result);
    const above = searchAbove(result);
    result = above === undefined ? null : explorerSync.search(above);
  }
  return mergeFound(found);
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
function isStylesConfig(value: unknown): value is StylesConfig {
  return typeof value === 'object' && value !== null;
}

function normalizeConfig(config: unknown): StylesConfig {
  // Handle default export (common in ES modules)
  if (isStylesConfig(config) && 'default' in config) {
    return normalizeConfig(config.default);
  }
  if (isStylesConfig(config)) {
    return config;
  }
  return {};
}
