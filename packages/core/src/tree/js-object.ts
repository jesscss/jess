import { Node, defineType } from './node';

/**
 * A plain JS object.
 */
export class JsObject extends Node<Record<string, any>> {
  type = 'JsObject' as const;
  shortType = 'jsobj' as const;
}
export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');