import type { Statement } from './ast/nodes.js';
import type { Context } from './context.js';

/**
 * Moves a render into the script sandbox as soon as import planning places a
 * document (the root, or one reached through placed imports, outside any
 * at-rule, reference import or module) whose top level has a `@plugin` the
 * sandbox runs: evaluation is certain to reach that `@plugin` and make the
 * same move, after this process had parsed the rest of the import graph for
 * nothing (`docs/design/DENO-SANDBOX-COMPILE.md` §2). `rules` is null for a
 * document whose evaluation is not certain. Only a target written as a plain
 * string, which is what evaluation loads, and only when the plugin that loads
 * it runs every script in the sandbox. Loads nothing; a `@plugin` that does
 * not load, or a compile with scripts disabled, is left to evaluation.
 */
export const rerouteForPlacedPlugins = async (rules: readonly Statement[] | null, context: Context | undefined): Promise<void> => {
  if (rules === null || context === undefined) {
    return;
  }
  const route = context.opts.scriptSandbox;
  if (route === undefined || context.opts.disableScriptModules || context.opts.disablePluginRule) {
    return;
  }
  for (const statement of rules) {
    if (statement.type !== 'Plugin') {
      continue;
    }
    const target = statement.target.type === 'Url' ? statement.target.value : statement.target;
    if (target.type === 'Quoted' && target.interp === null && await context.sandboxesPluginScript(target.value)) {
      await route.reroute();
    }
  }
};
