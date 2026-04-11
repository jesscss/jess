import { Node, defineType } from './node.js';

/**
 * A plain JS object.
 */
export class JsObject extends Node<Record<string, any>> {
}
export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');