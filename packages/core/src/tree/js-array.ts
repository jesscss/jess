import { Node, defineType } from './node.js';

/**
 * A plain JS array.
 */
export class JsArray extends Node<readonly any[]> {
}
export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');