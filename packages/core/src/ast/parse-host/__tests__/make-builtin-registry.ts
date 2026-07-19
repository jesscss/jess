/**
 * Test re-export of the built-in Less {@link FnRegistry} assembly, now homed in
 * `@jesscss/fns` (`makeBuiltinRegistry`) so test and production (`@jesscss/plugin-less`)
 * share ONE assembly point. Core production imports zero fns; this thin re-export
 * lives under `__tests__` (tests may import `@jesscss/fns`) and preserves every
 * existing `makeBuiltinRegistry()` call site.
 */
export { makeBuiltinRegistry } from '@jesscss/fns';
