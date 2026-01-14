/**
 * Transformation utilities for converting between Jess and Less AST nodes
 */

export { toLessNode, toLessTree, type ToLessOptions } from './to-less';
export { fromLessNode, fromLessTree, type FromLessOptions } from './from-less';
export { createLessProxy, isLessProxy, getJessNodeFromProxy } from './proxy';
export { mapJessTypeToLessType, mapLessTypeToJessType, getLessTypeIndex } from './type-map';
