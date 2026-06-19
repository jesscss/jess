import type { Context } from '../context.js';
import { Node, defineType, type LocationInfo, type NodeOptions } from './node.js';

type Fn = (...args: any[]) => any;
/**
 * A JS function.
 */
export class JsFunction extends Node<Fn> {
  static override childKeys = null;

  readonly fn: Fn;
  name?: string | undefined;

  constructor(
    value: { name: string; fn: Fn } | Fn,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    const fn = typeof value === 'function' ? value : value.fn;

    super(fn, options, location, false);
    this._treeContext = treeContext;
    this.fn = fn;
    this.name = typeof value === 'function' ? undefined : value.name;
  }

  override resolve(_context: Context): this {
    return this;
  }
}
export const jsfunc = defineType(JsFunction, 'JsFunction', 'jsfunc');
