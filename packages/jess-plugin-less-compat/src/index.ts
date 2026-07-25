/**
 * @jesscss/plugin-less-compat
 *
 * Less.js compatibility layer for Jess.
 * Enables Less.js plugins and visitors to work with Jess AST.
 */

export { LessCompatPlugin, default as lessCompatPlugin, type LessCompatPluginOptions } from './plugin.js';
export {
  LessApiBridge,
  fromNativeLessValue,
  toNativeLessValue,
  type ContextualPluginFunction,
  type NativeLessApi,
  type NativeLessFunction,
  type NativeLessFunctionRegistry,
  type NativeLessPlugin
} from './less-api-bridge.js';
export { default } from './plugin.js';
