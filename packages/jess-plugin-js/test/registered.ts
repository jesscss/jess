import type { ContextualPluginFunction } from '../src/index.js';

/** The function a loaded `@plugin` registered as `name`; a missing one fails the test. */
export function registered(
  loaded: { readonly functions: Readonly<Record<string, ContextualPluginFunction>> },
  name: string
): ContextualPluginFunction {
  const fn = loaded.functions[name];
  if (fn === undefined) {
    throw new Error(`The plugin registered no ${name}() function.`);
  }
  return fn;
}
