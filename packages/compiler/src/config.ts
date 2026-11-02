import * as fs from 'fs';
import * as path from 'path';
import { isPackageRoot, loadConfigSync, loadConfigSyncWithMeta, type StylesConfig } from 'styles-config';

/**
 * Get configuration from every styles.config.* file from the given directory up through parent
 * directories to the package root (the first one with a package.json), merged: the nearest wins
 * setting by setting.
 *
 * @param searchFrom - Directory to start searching from
 * @returns Configuration object, or empty object if no config found
 */
export const getConfig = (searchFrom?: string): StylesConfig => {
  return loadConfigSync(searchFrom);
};

export interface ConfigWithMeta {
  config: StylesConfig;
  configFilePath?: string;

  /** What the file at `configFilePath` sets by itself, before the configs above it merge in. */
  ownConfig?: StylesConfig;

  /** Every config file merged, nearest first. */
  configFilePaths?: string[];
}

/**
 * The settings the host resolved for a render that runs in the script sandbox,
 * sent with it as data (`docs/design/DENO-SANDBOX-COMPILE.md` §4): the sandbox
 * cannot read a `styles.config` above its read root.
 */
export type HostConfigs = {
  /** The settings of each folder the host resolved, by absolute path. */
  folders: Record<string, ConfigWithMeta>;

  /** Each config search the host ran: from a folder up to where it stopped, and the config files it merged. */
  searches: Array<{ from: string; to: string; files: string[] }>;
};

/** Set by the script sandbox's engine for the render it runs, and only there. */
const HOST_CONFIGS = Symbol.for('@jesscss/compiler/host-configs');

/** A folder's settings would need a config the script sandbox cannot read. */
export class SandboxConfigError extends Error {
  readonly code = 'config/outside-read-root';

  constructor(message: string) {
    super(message);
    this.name = 'SandboxConfigError';
  }
}

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Where a config search from `from` stops: its package root, else the file-system root. */
const searchTop = (from: string): string => {
  let dir = from;
  while (!isPackageRoot(dir) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  return dir;
};

/** The settings and searches to send with a sandboxed render, for the folders the host knows. */
export const hostConfigsFor = (entryDir: string | undefined, searchDirs: ReadonlyArray<string | undefined>): HostConfigs => {
  const folders: Record<string, ConfigWithMeta> = {};
  if (entryDir !== undefined) {
    folders[path.resolve(entryDir)] = getConfigWithMeta(entryDir);
  }
  const dirs = [...new Set(searchDirs.filter((dir): dir is string => dir !== undefined).map(dir => path.resolve(dir)))];
  return {
    folders,
    searches: dirs.map(from => ({ from, to: searchTop(from), files: getConfigWithMeta(from).configFilePaths ?? [] }))
  };
};

const isHostConfigs = (value: unknown): value is HostConfigs =>
  typeof value === 'object' && value !== null
  && typeof Reflect.get(value, 'folders') === 'object' && Array.isArray(Reflect.get(value, 'searches'));

/**
 * In the sandbox, a folder the host did not resolve (an import only the render
 * finds) loads its own configs, and the sandbox answers "not found" above its
 * read root. A search that leaves the read root before its package root would
 * miss a config there, so it fails, naming the config, instead of rendering
 * without it.
 */
const assertSearchStaysReadable = (dir: string, host: HostConfigs): void => {
  for (let at = dir; ; at = path.dirname(at)) {
    /* An ancestor of a folder in use exists; the sandbox reports one it may not read as missing. */
    if (!fs.existsSync(at)) {
      const search = host.searches.find(known => isInside(known.from, at) && isInside(at, known.to));
      if (search === undefined) {
        throw new SandboxConfigError(`The styles.config settings of ${dir} cannot be checked in the script sandbox: the config search leaves the render's read root at ${at}. Set compile.jsReadRoot to a folder that contains the configs this file uses.`);
      }
      const hidden = search.files.find(file => isInside(at, path.dirname(file)));
      if (hidden !== undefined) {
        throw new SandboxConfigError(`The styles.config settings of ${dir} include ${hidden}, which the script sandbox cannot read: it lies outside the render's read root. Set compile.jsReadRoot to a folder that contains it.`);
      }
      return;
    }
    if (isPackageRoot(at) || path.dirname(at) === at) {
      return;
    }
  }
};

export const getConfigWithMeta = (searchFrom?: string): ConfigWithMeta => {
  const host: unknown = Reflect.get(globalThis, HOST_CONFIGS);
  if (searchFrom === undefined || !isHostConfigs(host)) {
    return loadConfigSyncWithMeta(searchFrom);
  }
  const dir = path.resolve(searchFrom);
  const known = host.folders[dir];
  if (known !== undefined) {
    return known;
  }
  assertSearchStaysReadable(dir, host);
  return loadConfigSyncWithMeta(dir);
};

export interface OutputTestConfig {
  file: string;
  config: Partial<StylesConfig>;
}

/**
 * Get the expected output CSS file(s) and config(s) for testing.
 *
 * Supports:
 * - No output config: Returns default {name}.css with empty config
 * - Single output object: `output: { file: "{name}.css", collapseNesting: false, ... }`
 *   - Returns the file and uses those options for compilation
 * - Multiple outputs array: `output: [{ file: "{name}.css", ... }, ...]`
 *   - Returns array of {file, config} objects - test should iterate and test each
 * - Default options: First object in array without `file` property provides defaults
 *
 * @param sourceFilePath - Path to the stylesheet source file
 * @returns Single output config, or array of output configs if multiple outputs defined
 */
export function getExpectedOutputFiles(sourceFilePath: string): OutputTestConfig | OutputTestConfig[] {
  // getConfig expects a directory, so pass the directory of the source file.
  const config = getConfig(path.dirname(sourceFilePath));
  const outputConfig = config.output;

  /*
   * Preserve non-output config (compile/language/etc.) so fixture-level styles.config
   * can drive compiler behavior in tests.
   */
  const { output: outputIgnored, ...baseConfig } = config;
  void outputIgnored;

  // Extract file name without extension for {name} replacement
  const dir = path.dirname(sourceFilePath);
  const name = path.basename(sourceFilePath, path.extname(sourceFilePath));

  // No output config, default to {name}.css
  if (!outputConfig) {
    return {
      file: path.join(dir, `${name}.css`),
      config: baseConfig
    };
  }

  // Handle single output object
  if (!Array.isArray(outputConfig)) {
    const file = outputConfig.file || '{name}.css';
    const outputFile = file.replace('{name}', name);

    // Extract config options (everything except 'file')
    const configOptions = Object.fromEntries(Object.entries(outputConfig).filter(([key]) => key !== 'file'));
    return {
      file: path.join(dir, outputFile),
      config: { ...baseConfig, output: configOptions }
    };
  }

  // Handle array of outputs
  if (outputConfig.length === 0) {
    return {
      file: path.join(dir, `${name}.css`),
      config: {}
    };
  }

  // First object without 'file' property is default options
  let defaultOptions: Record<string, unknown> = {};
  let startIndex = 0;

  if (outputConfig[0] && !('file' in outputConfig[0])) {
    defaultOptions = { ...outputConfig[0] };
    startIndex = 1;
  }

  // Build array of output configs
  const outputs: OutputTestConfig[] = [];

  for (let i = startIndex; i < outputConfig.length; i++) {
    const output = outputConfig[i];
    if (!output || typeof output !== 'object' || !('file' in output)) {
      continue;
    }

    // Merge default options with this output's options
    const { file: outputFile, ...outputOptions } = output;
    const mergedOptions = { ...defaultOptions, ...outputOptions };

    const file = outputFile || '{name}.css';
    const finalFile = file.replace('{name}', name);

    outputs.push({
      file: path.join(dir, finalFile),
      config: { ...baseConfig, output: mergedOptions }
    });
  }

  // If only one output, return it directly (not as array)
  if (outputs.length === 1) {
    return outputs[0]!;
  }

  // Return array if multiple outputs
  return outputs.length > 0
    ? outputs
    : [{
        file: path.join(dir, `${name}.css`),
        config: baseConfig
      }];
}
