import type { Context } from '../context.js';
import { Node, defineType } from './node.js';

/**
 * A plain JS object.
 */
export class JsObject extends Node<Record<string, any>> {
  static override childKeys = null;

  override resolve(_context: Context): this {
    return this;
  }
}
export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');
