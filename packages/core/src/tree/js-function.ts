import { Node, defineType } from './node';

/**
 * A JS function.
 */
export class JsFunction extends Node<(...args: any[]) => any> {
  type = 'JsFunction' as const;
  shortType = 'jsfunc' as const;
}
export const jsfunc = defineType(JsFunction, 'JsFunction', 'jsfunc');