import { Node, defineType } from './node'
import { type List } from './list'
import { type Context } from '../context'
import { isNode } from './util'
import { cast } from './util/cast'

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin or variable lookup
   *   e.g. #mixin > .class() is [Call (#mixin ())] -> [Call (class ())]
   */
  value: string | Node
  args?: List
  /**
   * Legacy Less feature -- if a ruleset is returned,
   * all the properties can be marked as important.
   */
  important?: boolean
}

/**
 * This is an exported type that allows extra properties
 * and specifies the shape of `this` for a function call.
 */
export type ExtendedFn<T extends any[] = any[], R = any> = ((this: Context, ...args: T) => R) & {
  /**
   * Allow for optional calling, which means an optional
   * reference to a function will output a stringified
   * function representation if there's an evaluation error.
   *
   * This is done for Less, which sets this for functions
   * that have a CSS equivalent.
   */
  allowOptional?: boolean
  evalArgs?: boolean
}

/**
 * @note In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export class Call<T extends CallValue = CallValue> extends Node<T> {
  type = 'Call'
  shortType = 'call'
  override requiredSemi = true

  override toTrimmedString() {
    let { value, args, important } = this.value
    return `${value}(${args ?? ''})${important ? ' !important' : ''}`
  }

  override async evalNode(context: Context): Promise<Node> {
    let canOperate = context.canOperate
    /** Reset parentheses "state" */
    context.canOperate = false
    let { value, args } = this.value
    if (value instanceof Node) {
      value = await value.eval(context)
    }

    if (isNode(value, 'FunctionValue')) {
      // try {
      const func = value.value
      let result: any
      if (func.evalArgs !== false) {
        if (args) {
          args = await args?.eval(context)
        }
      }
      if (args) {
        result = await value.value.call(context, ...args.value)
      } else {
        result = await value.value.call(context)
      }

      /** @todo - mark results as important */
      return cast(result).inherit(this)
      // } catch (e) {
      /** Do something with JS errors */
      // console.log(e)
      // }
    } else {
      args = await args?.eval(context)
    }
    context.canOperate = canOperate
    let node = this.clone()
    node.value = value
    node.data.set('args', args)
    return node
  }
}

export const call = defineType<CallValue>(Call, 'Call')