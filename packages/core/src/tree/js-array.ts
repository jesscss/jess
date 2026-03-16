import { Node, defineType } from './node.js';

/**
 * A plain JS array.
 */
export interface JsArray {
  type: 'JsArray';
  shortType: 'jsarray';
}
export class JsArray extends Node<readonly any[]> {
  static override childKeys = null as null;

  value!: readonly any[];

  declare readonly data: Readonly<readonly any[]>;

  constructor(value: readonly any[], options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
  }
}

/** Compat: synthesize .data from instance fields */
Object.defineProperty(JsArray.prototype, 'data', {
  get(this: JsArray) {
    return this.value;
  },
  configurable: true,
  enumerable: true
});
export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');