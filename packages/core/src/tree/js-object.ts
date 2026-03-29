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

  /** @internal */ _value!: Record<string, any>;

  constructor(value: Record<string, any>, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this._value = value;
  }
}

export const jsobj = defineType(JsObject, 'JsObject', 'jsobj');