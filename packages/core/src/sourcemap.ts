/**
 * Source-map generation, on its own entry: it is the only part of
 * `@jesscss/core` that needs `@jridgewell/gen-mapping` (and the three modules
 * that package loads), and only a render that asks for a map needs it, so the
 * root entry does not load it. The compiler imports this entry when a render
 * requests a map.
 */
export { buildAstSourceMap, removeSourceMapBasepath } from './ast/sourcemap.js';
export type { AstSourceMapOptions } from './ast/sourcemap.js';
