import type { PluginInterface } from '@jesscss/core';
import type { ConfigOptions } from './index.js';
import * as path from 'path';
import { colorsByDefault } from './diagnostics.js';

/** The script plugin when it can run a whole compile in its sandbox (`jsSandbox: 'compile'`). */
export type CompileEnginePlugin = PluginInterface & {
  renderInEngine(request: {
    compiler: { module: string; exportName: string };
    filePath: string;
    compilerOptions: unknown;
    renderOptions: unknown;
    jsReadRoot: string;
    readRoots: readonly string[];
  }): Promise<string>;
};

const isCompileEnginePlugin = (plugin: PluginInterface): plugin is CompileEnginePlugin =>
  typeof Reflect.get(plugin, 'renderInEngine') === 'function';

/**
 * The compiler's engine: one script-plugin instance (one Deno process) for the
 * life of the compiler, created on its first `jsSandbox: 'compile'` render.
 * Undefined when the script plugin is not installed or cannot run a compile.
 */
export const openCompileEngine = (
  factory: Promise<{ create(config: { jsSandbox: 'compile' }): PluginInterface }> | undefined
): Promise<CompileEnginePlugin | undefined> | undefined =>
  factory?.then((record) => {
    const plugin = record.create({ jsSandbox: 'compile' });
    return isCompileEnginePlugin(plugin) ? plugin : undefined;
  });

/**
 * Runs one render in the engine and returns its CSS, or undefined when there
 * is no engine (or no compiler identity to rebuild there) and the render runs
 * in this process.
 */
export const renderInCompileEngine = async (
  engine: Promise<CompileEnginePlugin | undefined> | undefined,
  request: {
    compiler: { module: string; exportName: string } | undefined;
    filePath: string;
    options: Partial<ConfigOptions> | undefined;
    compilerOptions: ConfigOptions;
    jsReadRoot: string | undefined;
    searchPaths: readonly string[];
  }
): Promise<string | undefined> => {
  const plugin = await engine;
  if (plugin === undefined || request.compiler === undefined) {
    return undefined;
  }
  const entryDir = path.dirname(request.filePath);
  return plugin.renderInEngine({
    compiler: request.compiler,
    filePath: request.filePath,
    compilerOptions: request.compilerOptions,

    /* Colors follow THIS process's stderr, where the engine's diagnostics are written. */
    renderOptions: { ...request.options, colors: request.options?.colors ?? colorsByDefault(process.stderr) },
    jsReadRoot: request.jsReadRoot ?? entryDir,
    readRoots: request.searchPaths.map(searchPath => path.resolve(entryDir, searchPath))
  });
};
