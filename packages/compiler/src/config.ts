import * as fs from 'fs';
import * as path from 'path';
import { isPackageRoot, knownSettings, loadConfigSync, loadConfigSyncWithMeta, SettingNotPlainDataError, type StylesConfig } from 'styles-config';

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
/** A config the script sandbox cannot have: the config it names, and why. */
export type UnusableConfig = { unsendable: string; reason?: string };

export type HostConfigs = {
  /** The settings of each folder the host resolved, by absolute path. */
  folders: Record<string, ConfigWithMeta | UnusableConfig>;

  /**
   * What the configs above each read root merge to, keyed by the folder just
   * above the root, which the sandbox cannot read: the config search from
   * there, run by the host. Every folder inside the root shares it. Sent
   * encoded; the engine decodes one only when a file first needs it.
   */
  above: Record<string, unknown>;
};

/** What the engine installs for a render: the host's settings, and how to decode a chain above a read root. */
type EngineHostConfigs = HostConfigs & {
  decode: (encoded: unknown) => Promise<unknown>;
  decoded: Map<string, ConfigWithMeta | UnusableConfig>;
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

/**
 * Only the settings Jess defines cross into the sandbox (`knownSettings`): a
 * config is code, and anything else it holds is not the stylesheet's to read.
 */
const knownSettingsOf = (meta: ConfigWithMeta, dir: string): ConfigWithMeta | UnusableConfig => {
  try {
    return {
      ...meta,
      config: knownSettings(meta.config),
      ...meta.ownConfig && { ownConfig: knownSettings(meta.ownConfig) }
    };
  } catch (err) {
    if (!(err instanceof SettingNotPlainDataError)) {
      throw err;
    }
    const files = meta.configFilePaths ?? [];
    return {
      unsendable: files.length > 0 ? files.join(', ') : dir,
      reason: `cannot be sent into the script sandbox: ${err.setting} holds a value that is not plain data (strings, numbers, booleans, arrays and plain objects).`
    };
  }
};

/** The settings to send with a sandboxed render for the folder the host resolved (`above` is added beside the read roots). */
export const hostConfigsFor = (entryDir: string | undefined): HostConfigs => ({
  folders: entryDir === undefined ? {} : { [path.resolve(entryDir)]: knownSettingsOf(getConfigWithMeta(entryDir), entryDir) },
  above: {}
});

/**
 * The config search above a read root, for `HostConfigs.above`: none when the
 * root is a package root, where every search from inside it stops.
 */
export const configsAboveReadRoot = (root: string): ConfigWithMeta | UnusableConfig | undefined =>
  isPackageRoot(root) ? undefined : knownSettingsOf(getConfigWithMeta(path.dirname(root)), path.dirname(root));

const isRecord = (value: unknown): value is object => typeof value === 'object' && value !== null;

const isUnusable = (value: unknown): value is UnusableConfig =>
  isRecord(value) && typeof Reflect.get(value, 'unsendable') === 'string';

const isConfigWithMeta = (value: unknown): value is ConfigWithMeta =>
  isRecord(value) && isRecord(Reflect.get(value, 'config'));

const isEngineHostConfigs = (host: unknown): host is EngineHostConfigs =>
  isRecord(host) && isRecord(Reflect.get(host, 'folders')) && isRecord(Reflect.get(host, 'above'))
  && typeof Reflect.get(host, 'decode') === 'function' && Reflect.get(host, 'decoded') instanceof Map;

const engineHostConfigs = (): EngineHostConfigs | undefined => {
  const host: unknown = Reflect.get(globalThis, HOST_CONFIGS);
  return isEngineHostConfigs(host) ? host : undefined;
};

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

const unusable = (dir: string, config: UnusableConfig): SandboxConfigError =>
  new SandboxConfigError(`The styles.config settings of ${dir} (from ${config.unsendable}) ${config.reason ?? 'cannot be sent into the script sandbox: they hold an object that does not record the factory that made it. A plugin factory records it with `recordPluginModule` from @jesscss/core.'}`);

/** The decode of each chain under way, per render's host settings, so two files that need one chain share it. */
const decoding = new WeakMap<EngineHostConfigs, Map<string, Promise<void>>>();

/**
 * In the sandbox, decodes the chain above the read root that the settings of
 * `searchFrom` need, once, before a file there is parsed: decoding loads a
 * recorded plugin factory, so it is asynchronous, and a chain no file needs
 * is never decoded. One that fails to decode is kept as the config it names.
 */
export const prepareConfigsFor = (searchFrom: string): Promise<void> | undefined => {
  const host = engineHostConfigs();
  const dir = path.resolve(searchFrom);
  const leaves = host === undefined || Object.hasOwn(host.folders, dir) ? undefined : leavesReadRootAt(dir);
  if (host === undefined || leaves === undefined || host.decoded.has(leaves) || !Object.hasOwn(host.above, leaves)) {
    return undefined;
  }
  let chains = decoding.get(host);
  if (chains === undefined) {
    chains = new Map();
    decoding.set(host, chains);
  }
  let pending = chains.get(leaves);
  if (pending === undefined) {
    pending = decodeChain(host, leaves);
    chains.set(leaves, pending);
  }
  return pending;
};

const decodeChain = async (host: EngineHostConfigs, leaves: string): Promise<void> => {
  const encoded = host.above[leaves];
  const files: unknown = isRecord(encoded) ? Reflect.get(encoded, 'configFilePaths') : undefined;
  const named = Array.isArray(files) && files.length > 0 ? files.join(', ') : leaves;
  host.decoded.set(leaves, await host.decode(encoded).then(
    chain => (isUnusable(chain) || isConfigWithMeta(chain) ? chain : { unsendable: named, reason: 'are not a styles.config chain' }),
    (err: unknown) => ({ unsendable: named, reason: `cannot be loaded in the script sandbox: ${err instanceof Error ? err.message : String(err)}` })
  ));
};

/**
 * In the sandbox, a folder the host did not resolve (an import only the render
 * finds) loads the configs it may read itself, and merges them over the chain
 * the host sent for the configs above its read root: the settings it has in
 * Node. Only a search that leaves the readable folders where no chain was sent,
 * or whose chain cannot be had, fails, naming why, instead of rendering
 * without it.
 */
const withConfigsAbove = (dir: string, host: EngineHostConfigs): ConfigWithMeta => {
  const leaves = leavesReadRootAt(dir);
  if (leaves === undefined) {
    return loadConfigSyncWithMeta(dir);
  }
  const above = host.decoded.get(leaves);
  if (above === undefined) {
    throw new SandboxConfigError(Object.hasOwn(host.above, leaves)
      ? `The styles.config settings of ${dir} were read before the chain above its read root was prepared (prepareConfigsFor).`
      : `The styles.config settings of ${dir} cannot be resolved in the script sandbox: the config search leaves the folders it may read at ${leaves}, above no read root of this render.`);
  }
  if (isUnusable(above)) {
    throw unusable(dir, above);
  }
  return loadConfigSyncWithMeta(dir, above);
};

export const getConfigWithMeta = (searchFrom?: string): ConfigWithMeta => {
  const host = searchFrom === undefined ? undefined : engineHostConfigs();
  if (searchFrom === undefined || host === undefined) {
    return loadConfigSyncWithMeta(searchFrom);
  }
  const dir = path.resolve(searchFrom);
  const folder = host.folders[dir];
  if (folder !== undefined && isUnusable(folder)) {
    throw unusable(dir, folder);
  }
  return folder ?? withConfigsAbove(dir, host);
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
