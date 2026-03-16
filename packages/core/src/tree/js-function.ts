import { Node, defineType, type LocationInfo, type TreeContext, type NodeOptions } from './node.js';

type Fn = (...args: any[]) => any;
/**
 * A JS function.
 */
export interface JsFunction {
  type: 'JsFunction';
  shortType: 'jsfunc';
}
export class JsFunction extends Node<Fn> {
  static override childKeys = null as null;

  value!: Fn;
  name?: string | undefined;

  declare readonly data: Readonly<Fn>;

  constructor(
    value: { name: string; fn: Fn } | Fn,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    const fn = typeof value === 'function' ? value : value.fn;

    super(fn, options, location, treeContext);
    this.value = fn;
    this.name = typeof value === 'function' ? undefined : value.name;
  }
}

/** Compat: synthesize .data from instance fields */
Object.defineProperty(JsFunction.prototype, 'data', {
  get(this: JsFunction) {
    return this.value;
  },
  configurable: true,
  enumerable: true
});
export const jsfunc = defineType(JsFunction, 'JsFunction', 'jsfunc');