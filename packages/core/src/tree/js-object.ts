import { Node, defineType } from './node.js';

/**
 * A plain JS object.
 */
export interface JsObject {
  type: 'JsObject';
  shortType: 'jsobj';
}

export class JsObject extends Node<Record<string, any>> {
  static override childKeys = null as null;

  value!: Record<string, any>;

  declare readonly data: Readonly<Record<string, any>>;

  constructor(value: Record<string, any>, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
  }
}

/** Compat: synthesize .data from instance fields */
Object.defineProperty(JsObject.prototype, 'data', {
  get(this: JsObject) {
    return this.value;
  },
  configurable: true,
  enumerable: true
});
export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');