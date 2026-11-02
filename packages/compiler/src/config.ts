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

  /**
   * What the configs above each read root merge to, keyed by the folder just
   * above the root, which the sandbox cannot read: the config search from
   * there, run by the host. Every folder inside the root shares it. A chain
   * that cannot cross into the sandbox names its nearest config instead.
   */
  above: Record<string, ConfigWithMeta | { unsendable: string }>;
};

/** Set by the script sandbox's engine for the render it runs, and only there. */
const HOST_CONFIGS = Symbol.for('@jesscss/compiler/host-configs');

/** A folder's settings need a config the script sandbox cannot have. */
export class SandboxConfigError extends Error {
  readonly code = 'config/outside-read-root';

  constructor(message: string) {
    super(message);
    this.name = 'SandboxConfigError';
  }
}

/** The settings to send with a sandboxed render for the folder the host resolved (`above` is added beside the read roots). */
export const hostConfigsFor = (entryDir: string | undefined): HostConfigs => ({
  folders: entryDir === undefined ? {} : { [path.resolve(entryDir)]: getConfigWithMeta(entryDir) },
  above: {}
});

/**
 * The config search above a read root, for `HostConfigs.above`: none when the
 * root is a package root, where every search from inside it stops.
 */
export const configsAboveReadRoot = (root: string): ConfigWithMeta | undefined =>
  isPackageRoot(root) ? undefined : getConfigWithMeta(path.dirname(root));

const isHostConfigs = (value: unknown): value is HostConfigs =>
  typeof value === 'object' && value !== null
  && typeof Reflect.get(value, 'folders') === 'object' && typeof Reflect.get(value, 'above') === 'object';

/**
 * The folder at which a config search from `dir` leaves what the sandbox may
 * read (it answers "not found" there), or undefined when a package root ends
 * the search first. An ancestor of a folder in use exists, so one the sandbox
 * reports missing is one it may not read.
 */
const leavesReadRootAt = (dir: string): string | undefined => {
  for (let at = dir; ; at = path.dirname(at)) {
    if (!fs.existsSync(at)) {
      return at;
    }
    if (isPackageRoot(at) || path.dirname(at) === at) {
      return undefined;
    }
  }
};

/**
 * In the sandbox, a folder the host did not resolve (an import only the render
 * finds) loads the configs it may read itself, and merges them over the chain
 * the host sent for the configs above its read root: the settings it has in
 * Node. Only a search that leaves the readable folders where no chain was sent,
 * or whose chain could not cross, fails, naming why, instead of rendering
 * without it.
 */
const withConfigsAbove = (dir: string, host: HostConfigs): ConfigWithMeta => {
  const leaves = leavesReadRootAt(dir);
  if (leaves === undefined) {
    return loadConfigSyncWithMeta(dir);
  }
  const above = host.above[leaves];
  if (above === undefined) {
    throw new SandboxConfigError(`The styles.config settings of ${dir} cannot be resolved in the script sandbox: the config search leaves the folders it may read at ${leaves}, above no read root of this render.`);
  }
  if ('unsendable' in above) {
    throw new SandboxConfigError(`The styles.config settings of ${dir} include ${above.unsendable}, which cannot be sent into the script sandbox: it holds an object that does not record the factory that made it. A plugin factory records it with \`recordPluginModule\` from @jesscss/core.`);
  }
  return loadConfigSyncWithMeta(dir, above);
};

export const getConfigWithMeta = (searchFrom?: string): ConfigWithMeta => {
  const host: unknown = Reflect.get(globalThis, HOST_CONFIGS);
  if (searchFrom === undefined || !isHostConfigs(host)) {
    return loadConfigSyncWithMeta(searchFrom);
  }
  const dir = path.resolve(searchFrom);
  return host.folders[dir] ?? withConfigsAbove(dir, host);
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
