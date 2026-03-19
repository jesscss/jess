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

  constructor(value: readonly any[], options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
  }
}

export const jsarray = defineType(JsArray, 'JsArray', 'jsarray');