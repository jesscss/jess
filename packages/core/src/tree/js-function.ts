import { Node, defineType, type LocationInfo, type TreeContext, type NodeOptions } from './node.js';

type Fn = (...args: any[]) => any;
/**
 * A JS function.
 */
export class JsFunction extends Node<Fn> {
  type = 'JsFunction' as const;
  shortType = 'jsfunc' as const;

  name?: string | undefined;

  constructor(
    value: { name: string; fn: Fn } | Fn,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    const fn = typeof value === 'function' ? value : value.fn;

    super(fn, options, location, treeContext);
    this.name = typeof value === 'function' ? undefined : value.name;
  }
}
export const jsfunc = defineType(JsFunction, 'JsFunction', 'jsfunc');