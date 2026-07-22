/**
 * Direct AST-v2 built-in registry entrypoint.
 *
 * Unlike the package root, this entrypoint deliberately does not re-export the
 * legacy JavaScript-callable Less/Sass wrapper modules. Compiler consumers use
 * it to stay on the canonical value-domain function contract.
 */
export { builtinLessFns } from './builtins/index.js';
export { makeBuiltinRegistry } from './builtins/registry.js';
export type { Fn, FnSpec, ParamSpec, Kind } from '@jesscss/core/value';
