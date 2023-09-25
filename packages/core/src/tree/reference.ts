import { defineType, Node } from './node'
import type { Interpolated } from './interpolated'
import { type Context } from '../context'
import { cast } from './util/cast'
import { Declaration } from './declaration'

/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` (or #($foo)) refers to a variable
 *    - `$.foo` (or #($.foo) refers to a property
 *    - in `@include foo()`, `foo` refers to a mixin
 *   in Less
 *   - `@foo` refers to a variable
 *   - `$foo` refers to a property
 *   - `.foo` refers to a mixin
 */
export type ReferenceOptions = {
  type: 'variable' | 'property' | 'mixin'
}

type NodeType = typeof Node<string | Interpolated, ReferenceOptions>
type ReferenceParams = ConstructorParameters<NodeType>
/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<string | Interpolated, ReferenceOptions> {
  options: ReferenceOptions

  constructor(...args: ReferenceParams) {
    /** Default to a variable-type reference */
    args[1] ??= { type: 'variable' }
    super(...args)
  }

  toTrimmedString(): string {
    const { type } = this.options ?? {}
    const { value } = this
    switch (type) {
      case 'variable':
        return `$${value}`
      case 'property':
        return `$.${value}`
      case 'mixin':
        return `${value}`
    }
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to another reference
   */
  async eval(context: Context): Promise<Node> {
    let { value } = this
    let { type } = this.options
    if (value instanceof Node) {
      const resolved = await value.eval(context)
      value = resolved.value
    }
    let opts = context.declarationScope ? { filter: context.declarationScope } : {}
    let returnVal: any
    switch (type) {
      case 'variable':
        returnVal = context.scope.getVar(value, opts)
        break
      case 'property':
        returnVal = context.scope.getProp(value, opts)
        break
      case 'mixin':
        returnVal = context.scope.getMixin(value, opts)
    }
    if (returnVal instanceof Declaration) {
      context.declarationScope = returnVal
      returnVal = returnVal.value
      returnVal = await returnVal.eval(context)
      context.declarationScope = undefined
      return returnVal.inherit(this)
    } else {
      return cast(returnVal).inherit(this)
    }
  }
}

export const ref = defineType(Reference, 'Reference', 'ref')