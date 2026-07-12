import { Node, defineType } from './node.js';

/**
 * A plain JS object.
 */
export interface JsObject {
  type: 'JsObject';
  shortType: 'jsobj';
}

export class JsObject extends Node<Record<string, any>> {
}
export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');