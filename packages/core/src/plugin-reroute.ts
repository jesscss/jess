import type { Stylesheet } from './ast/nodes.js';
import type { Context } from './context.js';

/**
 * Moves a render into the script sandbox as soon as a document it parses has a
 * top-level `@plugin` that the sandbox runs: the move evaluation makes when it
 * reaches the `@plugin`, made before the rest of the import graph is parsed in
 * this process only to be thrown away (`docs/design/DENO-SANDBOX-COMPILE.md`
 * §2). Only a target written as a plain string, which is exactly what
 * evaluation loads, and only when the plugin that loads it sandboxes every
 * script. Loads nothing; a `@plugin` that does not resolve, or a compile with
 * scripts disabled, is left to evaluation, which reports it.
 */
export const rerouteForPlannedPlugins = async (document: Stylesheet, context: Context): Promise<void> => {
  const route = context.opts.scriptSandbox;
  if (route === undefined || context.opts.disableScriptModules || context.opts.disablePluginRule) {
    return;
  }
  for (const statement of document.rules) {
    if (statement.type !== 'Plugin') {
      continue;
    }
    const target = statement.target.type === 'Url' ? statement.target.value : statement.target;
    if (target.type === 'Quoted' && target.interp === null
      && (await context.pluginModuleLoader(target.value))?.sandboxesScripts === true) {
      await route.reroute();
    }
  }
};
