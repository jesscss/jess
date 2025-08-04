import { Node, defineType } from './node';

/**
 * A plain JS array.
 */
export class JsArray extends Node<readonly any[]> {
  type = 'JsArray' as const;
  shortType = 'jsarray' as const;
}
export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');