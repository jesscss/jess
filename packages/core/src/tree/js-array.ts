import type { Context } from '../context.js';
import { Node, defineType } from './node.js';

/**
 * A plain JS array.
 */
export class JsArray extends Node<readonly any[]> {
  override resolve(_context: Context): this {
    return this;
  }
}
export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');
