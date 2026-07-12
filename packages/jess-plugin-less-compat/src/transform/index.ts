/**
 * Transformation utilities for converting between Jess and Less AST nodes
 */

export { toLessNode, toLessTree, type ToLessOptions } from './to-less.js';
export { fromLessNode, fromLessPluginReturnValue, fromLessTree, type FromLessOptions } from './from-less.js';
export { createLessProxy, isLessProxy, getJessNodeFromProxy } from './proxy.js';
export { mapJessTypeToLessType, mapLessTypeToJessType, getLessTypeIndex } from './type-map.js';
