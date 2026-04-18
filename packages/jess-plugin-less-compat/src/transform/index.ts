/**
 * Transformation utilities for converting between Jess and Less AST nodes
 */

export { toLessNode, toLessTree, type ToLessOptions } from './to-less.js';
export { fromLessNode, fromLessPluginReturnValue, fromLessTree, type FromLessOptions } from './from-less.js';
export { createLessAdapter, LessAdapterBase } from './less-adapter.js';
export { mapJessTypeToLessType, mapLessTypeToJessType, getLessTypeIndex } from './type-map.js';
