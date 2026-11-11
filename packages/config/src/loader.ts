import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import type { CosmiconfigResult, OptionsSync, PublicExplorer, PublicExplorerSync } from 'cosmiconfig';
import { mergeConfigs } from './options.js';
import type { StylesConfig } from './types.js';

export interface LoadedConfigMeta {
  config: StylesConfig;
  configFilePath?: string;

  /** What the file at `configFilePath` sets by itself, before the configs above it merge in. */
  ownConfig?: StylesConfig;

  /** Every config file merged, nearest first. */
  configFilePaths?: string[];
}

/** Whether `dir` is a package root, where a search stops (it has a `package.json` or `package.yaml`). */
export const isPackageRoot = (dir: string): boolean =>
  ['package.json', 'package.yaml'].some(name => fs.existsSync(path.join(dir, name)));

const SEARCH_PLACES = [
  'styles.config.ts',
  'styles.config.js',
  'styles.config.mts',
  'styles.config.mjs',
  'styles.config.cjs',
  'styles.config.cts'
];

/**
 * The places cosmiconfig 9.0.2 reads its own meta-config from, each time an
 * explorer is made (`getUserDefinedOptionsFromMetaConfig`, cosmiconfig
 * `dist/index.js:19-51`): `metaSearchPlaces` (`dist/defaults.js:74-84`) in
 * the working directory only (`searchStrategy: 'none'`, `stopDir:
 * process.cwd()`). A `package.*` counts when it has a `cosmiconfig` key; any
 * other place counts when it exists, even empty (`ignoreEmptySearchPlaces:
 * false`).
 */
const META_CONFIG_PLACES = [
  'package.json',
  'package.yaml',
  '.config/config.json',
  '.config/config.yaml',
  '.config/config.yml',
  '.config/config.js',
  '.config/config.ts',
  '.config/config.cjs',
  '.config/config.mjs'
];

/** Whether cosmiconfig would find a meta-config at `file`. Unsure (a `package.yaml`, an unreadable `package.json`) counts as found. */
const isMetaConfig = (file: string): boolean => {
  if (!fs.existsSync(file)) {
    return false;
  }
  if (path.basename(file) !== 'package.json') {
    return true;
  }
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof manifest !== 'object' || manifest === null || Reflect.get(manifest, 'cosmiconfig') != null;
  } catch {
    return true;
  }
};

let metaConfigFound: boolean | undefined;

/** Whether cosmiconfig finds a meta-config, which can change any search: then it always loads. Looked up once per process. */
const hasMetaConfig = (): boolean =>
  (metaConfigFound ??= META_CONFIG_PLACES.some(place => isMetaConfig(path.join(process.cwd(), place))));

const stylesConfigFrom = new Map<string, boolean>();

/**
 * Whether a `styles.config.*` lies in `dir` or a folder above it, up to and
 * including the package root (or the file-system root, when there is none).
 * Answered once per folder for the process, as cosmiconfig caches its searches.
 */
const hasStylesConfig = (dir: string): boolean => {
  let found = stylesConfigFrom.get(dir);
  if (found === undefined) {
    const parent = path.dirname(dir);
    found = SEARCH_PLACES.some(name => fs.existsSync(path.join(dir, name)))
      || (parent !== dir && !isPackageRoot(dir) && hasStylesConfig(parent));
    stylesConfigFrom.set(dir, found);
  }
  return found;
};

/**
 * Whether a search from `searchFrom` can find a config: a `styles.config.*`
 * ({@link hasStylesConfig}), or a cosmiconfig meta-config ({@link hasMetaConfig}).
 * The search itself is cosmiconfig's; this only decides whether to load it.
 */
const mayFindConfig = (searchFrom: string = process.cwd()): boolean =>
  hasMetaConfig() || hasStylesConfig(path.resolve(searchFrom));

let explorers: { search: PublicExplorer; searchSync: PublicExplorerSync } | undefined;

/**
 * The config explorers, created on first use. cosmiconfig and the parsers it
 * loads are about a fifth of the modules a compile imports, and most compiles
 * have no config file, so it loads only when there is one to read.
 *
 * A search finds the nearest `styles.config.*`: in the start folder, else the
 * nearest folder above it, stopping at the first folder with a `package.json`
 * (the package root), which is searched too (DESIGN-DECISIONS O19).
 */
const configExplorers = (): { search: PublicExplorer; searchSync: PublicExplorerSync } => {
  if (explorers === undefined) {
    const { cosmiconfig, cosmiconfigSync, defaultLoadersSync }: typeof import('cosmiconfig') = createRequire(import.meta.url)('cosmiconfig');
    const explorerOptions: Partial<OptionsSync> = {
      searchStrategy: 'project',
      searchPlaces: SEARCH_PLACES,
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
    explorers = { search: cosmiconfig('styles', explorerOptions), searchSync: cosmiconfigSync('styles', explorerOptions) };
  }
  return explorers;
};

/**
 * Where to look for the next config above the one at `filepath`: its folder's
 * parent, or none when its folder is the package root (has a `package.json` or
 * `package.yaml`, where cosmiconfig's `project` search stops) or the file-system root.
 */
function searchAbove({ filepath }: { filepath: string }): string | undefined {
  const dir = path.dirname(filepath);
  const parent = path.dirname(dir);
  return parent === dir || isPackageRoot(dir) ? undefined : parent;
}

/**
 * The configs found, nearest first, merged: the nearest wins setting by setting
 * ({@link mergeConfigs}). `below` is what the configs above the last one found
 * merged to, when that part of the search was run elsewhere: the found configs
 * merge over it exactly as they would over the configs themselves.
 */
function mergeFound(found: ReadonlyArray<{ config: unknown; filepath: string }>, below?: LoadedConfigMeta): LoadedConfigMeta {
  const configs = found.map(result => normalizeConfig(result.config));
  if (below !== undefined && configs.length === 0) {
    return below;
  }
  return {
    config: configs.reduceRight<StylesConfig>((merged, config) => mergeConfigs(merged, config), below?.config ?? {}),
    configFilePath: found[0]?.filepath ?? below?.configFilePath,
    ownConfig: configs[0] ?? below?.ownConfig ?? {},
    configFilePaths: [...found.map(result => result.filepath), ...below?.configFilePaths ?? []]
  };
}

/**
 * Load styles configuration from the file system (async): every config from
 * `searchFrom` up to the package root, merged ({@link loadConfigSyncWithMeta}).
 * @param searchFrom - Directory to search from (defaults to process.cwd())
 * @returns Configuration object or null if not found
 */
export async function loadConfig(searchFrom?: string): Promise<StylesConfig | null> {
  if (!mayFindConfig(searchFrom)) {
    return null;
  }
  const explorer = configExplorers().search;
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
export function loadConfigSyncWithMeta(searchFrom?: string, below?: LoadedConfigMeta): LoadedConfigMeta {
  if (!mayFindConfig(searchFrom)) {
    return mergeFound([], below);
  }
  const explorerSync = configExplorers().searchSync;
  const found: Array<NonNullable<CosmiconfigResult>> = [];
  let result = explorerSync.search(searchFrom);
  while (result) {
    found.push(result);
    const above = searchAbove(result);
    result = above === undefined ? null : explorerSync.search(above);
  }
  return mergeFound(found, below);
}

/**
 * Load styles configuration from a specific file path (async)
 * @param filePath - Path to the config file
 * @returns Configuration object or null if not found
 */
export async function loadConfigFromPath(filePath: string): Promise<StylesConfig | null> {
  const result = await configExplorers().search.load(filePath);
  return result?.config ? normalizeConfig(result.config) : null;
}

/**
 * Load styles configuration from a specific file path (sync)
 * @param filePath - Path to the config file
 * @returns Configuration object or empty object if not found
 */
export function loadConfigFromPathSync(filePath: string): StylesConfig {
  const result = configExplorers().searchSync.load(filePath);
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
