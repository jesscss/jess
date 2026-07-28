/**
 * `@jesscss/fns` root.
 *
 * Each dialect owns its globals: `@jesscss/fns/less` and `@jesscss/fns/sass`
 * are the dialect indexes, and a dialect index is simultaneously the importable
 * module surface AND the registration unit (see `registry.ts`). Nothing here
 * merges them — there is no combined built-in set.
 */
export * as less from './less/index.js';
export * as sass from './sass/index.js';
export * as shared from './shared/index.js';

export { fnsOf, registryOf } from './registry.js';
export { lessFns, makeLessRegistry } from './less/registry.js';
export { sassFns, makeSassRegistry } from './sass/registry.js';
export type { Fn, FnSpec, ParamSpec, Kind } from '@jesscss/core/value';
