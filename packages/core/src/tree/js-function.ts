import type { Context } from '../context.js';
import { Node, defineType, type LocationInfo, type NodeOptions } from './node.js';

type Fn = (...args: any[]) => any;
/**
 * A JS function.
 */
export class JsFunction extends Node<Fn> {
  name?: string | undefined;

  constructor(
    value: { name: string; fn: Fn } | Fn,
    options?: NodeOptions,
    location?: LocationInfo
  ) {
    const fn = typeof value === 'function' ? value : value.fn;

    super(fn, options, location);
    this.name = typeof value === 'function' ? undefined : value.name;
  }

  override resolve(_context: Context): this {
    return this;
  }
}
export const jsfunc = defineType(JsFunction, 'JsFunction', 'jsfunc');
