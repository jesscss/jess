import type { Context } from '../context.js';
import { Node, defineType, type LocationInfo, type NodeOptions } from './node.js';

/**
 * A plain JS object.
 */
export class JsObject extends Node<Record<string, any>> {
  // Value is a record that may hold Node children; childKeys=['value'] lets the
  // canonical factory parent them (one level) and clone traverse them. Raw
  // `new JsObject` still shares (invariant 7) — e.g. eval-time cast().
  static override childKeys = ['value'];
  readonly value: Record<string, any>;

  constructor(value: Record<string, any>, options?: NodeOptions, location?: LocationInfo) {
    super(value, options, location);
    // Invariant 7: each node owns its value; the base stores nothing.
    this.value = value;
  }

  override resolve(_context: Context): this {
    return this;
  }

  // JS-interop value, not CSS output: renders empty. (childKeys=['value'] is for
  // parenting/clone of Node children, not for emitting them as syntax.)
  override toTrimmedString(): string {
    return '';
  }
}
export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');
