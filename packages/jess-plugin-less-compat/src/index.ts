/**
 * @jesscss/plugin-less-compat
 * 
 * Less.js compatibility layer for Jess.
 * Enables Less.js plugins and visitors to work with Jess AST.
 */

export { LessCompatPlugin, default as lessCompatPlugin, type LessCompatPluginOptions } from './plugin';
export * from './transform';
export { isLessPlugin, isJessPlugin, filterPlugins } from './plugin-utils';
