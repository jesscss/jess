import type { Context } from '../context.js';
import { Node, defineType, type LocationInfo, type NodeOptions } from './node.js';

/**
 * A plain JS array.
 */
export class JsArray extends Node<readonly any[]> {
  static override childKeys = null;
  readonly value: readonly any[];

  constructor(value: readonly any[], options?: NodeOptions, location?: LocationInfo) {
    super(value, options, location);
    // Invariant 7: each node owns its value; the base stores nothing.
    this.value = value;
  }

  override resolve(_context: Context): this {
    return this;
  }
}
export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');
