export * from './less/index.js';

// AST-v2 built-in Less fn set (value-domain). Additive to the legacy root export
// above (which the plugin's legacy render path still consumes); an array, so the
// plugin's `typeof value === 'function'` filter skips it. Kept alongside the legacy
// set until Sass converts.
export { builtinLessFns } from './builtins/index.js';

// The built-in fn set packaged as a ready-to-use dispatch registry (the single
// production assembly point; the ast/ render path builds its value evaluator from
// this). See `builtins/registry.ts`.
export { makeBuiltinRegistry } from './builtins/registry.js';

// export * from './math'
