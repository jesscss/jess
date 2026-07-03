/**
 * @jesscss/plugin-less-compat
 *
 * Less.js compatibility layer for Jess.
 * Enables Less.js plugins and visitors to work with Jess AST.
 */

export { LessCompatPlugin, default as lessCompatPlugin, type LessCompatPluginOptions } from './plugin.js';
export { default } from './plugin.js';
export * from './transform/index.js';
export { isLessPlugin, isJessPlugin, filterPlugins } from './plugin-utils.js';
export { LessTreeConstructors, createLessMock } from './less-compat-structures.js';
