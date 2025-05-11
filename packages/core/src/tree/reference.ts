import { defineType, Node } from './node'
import type { Interpolated } from './interpolated'
import { type Context } from '../context'
import { cast } from './util/cast'
import { Declaration } from './declaration'
import type { GetterOptions } from '../scope'
import { General } from './general'
import { Selector } from './selector'

/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` refers to a variable
 *    - `$.foo` refers to a propert
 *    - `$foo$bar` refers to a variable in a variable
 *    - `$foo.bar` refers to a property in a variable
 *    - in `$ > .foo()`, `.foo` refers to a mixin
 *    - in `$foo > .mixin()` `.mixin` refers to a mixin in `$foo`
 *    - Resolution:
 *      - `$` searches scope,
 *      - `$$` searches in declaration order
 *   in Less
 *   - `@foo` refers to a variable
 *   - `$foo` refers to a property
 *   - `.foo` refers to a mixin
 */
export type ReferenceOptions = {
  type: 'variable' | 'property' | 'mixin'
  resolution?: 'scope' | 'linear'
}

/**
 * Optional references just resolve to the string
 * representation if the fallback is set to true.
 * 
 * @note - Used by Less for function references
 */
type NodeType = typeof Node<[key: string | Interpolated, fallback?: Node | true], ReferenceOptions>
type ReferenceParams = ConstructorParameters<NodeType>
/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Selector<[key: string | Interpolated, fallback?: Node | true], ReferenceOptions> {
  declare value: [key: string | Interpolated, fallback?: Node | true]
  type = 'Reference'
  shortType = 'ref'

  constructor(...args: ReferenceParams) {
    /** Default to a variable-type reference */
    args[1] ??= { type: 'variable' }
    super(...args)
  }

  override get keySet(): Set<string> {
    return (this._keySet ??= new Set())
  }

  find(needle: Selector): Selector[] | undefined {
    throw new Error('Method not implemented.')
  }

  override valueOf() {
    return ''
  }

  override toTrimmedString(): string {
    const { type, resolution } = this.options
    const { value } = this
    const preChar = resolution === 'linear' ? '$$' : '$'
    switch (type!) {
      case 'variable':
        return `${preChar}${value}`
      case 'property':
        return `${preChar}.${value}`
      case 'mixin':
        return `${value}`
    }
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to another reference
   */
  override async evalNode(context: Context): Promise<Node> {
    let { value } = this
    let { type } = this.options
    let [name, fallback] = value
    let key: string
    if (name instanceof Node) {
      key = (await name.eval(context)).value
    } else {
      key = name
    }
    let opts: GetterOptions = context.declarationScope
    ? {
      ignoreRules: context.declarationScope
    } : {}

    let returnVal: any
    switch (type) {
      case 'variable':
        returnVal = context.scope.getVar(key, opts)
        break
      case 'property':
        returnVal = context.scope.getProp(key, opts)
        break
      case 'mixin':
        returnVal = context.scope.getMixin(key, opts)
    }

    if (returnVal === undefined && fallback) {
      if (fallback === true) {
        return new General(key, { type: 'Name' })
      }
      return fallback
    }
    if (returnVal instanceof Declaration) {
      context.declarationScope.add(returnVal)
      const evald = await returnVal.value.value.eval(context)
      context.declarationScope.delete(returnVal)
      return evald
    } else {
      return cast(returnVal)
    }
  }
}

export const ref = defineType(Reference, 'Reference', 'ref')