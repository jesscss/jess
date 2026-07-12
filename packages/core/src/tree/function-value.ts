import { Node, defineType } from './node'

type FunctionValueValue = ((...args: any[]) => any) & {
  evalArgs?: boolean
}
/**
 * A node representing an external function, or another node
 * that resolves to a function value, such as a mixin reference.
 */
export class FunctionValue extends Node<FunctionValueValue> {}
export const functionvalue = defineType(FunctionValue, 'FunctionValue')