import jessRollupPlugin, { type JessRollupPluginOptions } from 'rollup-plugin-jess';
import type { Plugin } from 'vite';

export type JessVitePluginOptions = JessRollupPluginOptions;

/**
 * `vite-plugin-jess`: `rollup-plugin-jess`, which runs under Vite as it is.
 * There the stylesheet's module imports its CSS, so Vite injects it in dev and
 * bundles it in a build.
 */
export default function jessVitePlugin(options: JessVitePluginOptions = {}): Plugin {
  return jessRollupPlugin(options);
}
