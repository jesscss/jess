/**
 * @jesscss/plugin-less-compat
 *
 * Less.js compatibility layer for Jess.
 * Runs Less 4 function plugins on the Jess AST. The Less 4 plugin-manager hooks
 * (visitors, pre/post-processors, file managers) are refused with a diagnostic
 * that names the native replacement.
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
  type NativeLessPlugin,
  type NativeLessPluginManager
} from './less-api-bridge.js';
export { default } from './plugin.js';
