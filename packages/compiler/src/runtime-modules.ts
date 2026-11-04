import type { ExportRecipe, ExportRuntimeData, PluginInterface } from '@jesscss/core';

/**
 * `runtime` with each function's module as the browser runtime module imports
 * it (ledger A4): a private path a plugin provides (`#less`) becomes its package
 * module (`@jesscss/fns/less`); a package spelling stays as written.
 *
 * ponytail: a relative module is refused, because a `@use` in an imported file
 * resolves against that file, which the recipe does not record; record the
 * resolved file at bind time if a relative function module is ever needed.
 */
export function packageRuntime(runtime: ExportRuntimeData, plugins: readonly PluginInterface[]): ExportRuntimeData {
  const derived: Record<string, ExportRecipe> = {};
  for (const [name, recipe] of Object.entries(runtime.derived)) {
    derived[name] = packageRecipe(recipe, plugins);
  }
  return { ...runtime, derived };
}

function packageRecipe(recipe: ExportRecipe, plugins: readonly PluginInterface[]): ExportRecipe {
  if ('export' in recipe) {
    return recipe;
  }
  const { module, name } = recipe.fn;
  const provided = plugins.reduce<string | undefined>((found, plugin) => found ?? plugin.packageModule?.(module), undefined);
  if (provided === undefined && (module.startsWith('.') || module.startsWith('/'))) {
    throw new Error(`${name}() reads an exported variable, and the browser runtime cannot import it from the relative module "${module}"; import it from a package.`);
  }
  return {
    fn: { module: provided ?? module, name },
    args: recipe.args.map(arg => typeof arg === 'string' ? arg : packageRecipe(arg, plugins))
  };
}
