import { Node, defineType } from './node';

export type JsFunctionValue = ((...args: any[]) => any) & {
  evalArgs?: boolean;
};

/**
 * A JS function.
 */
export class JsFunction extends Node<JsFunctionValue> {
  type = 'JsFunction' as const;
  shortType = 'jsfunc' as const;
}
export const jsfunc = defineType(JsFunction, 'JsFunction', 'jsfunc');