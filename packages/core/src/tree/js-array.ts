import { Node, defineType } from './node.js';

/**
 * A plain JS array.
 */
export interface JsArray {
  type: 'JsArray';
  shortType: 'jsarray';
}
export class JsArray extends Node<readonly any[]> {
}
export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');