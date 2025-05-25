import { defineType, type Node } from './node'
import type { Interpolated } from './interpolated'
import { type Context } from '../context'
import { cast } from './util/cast'
import { Declaration } from './declaration'
import type { GetterOptions } from '../scope'
import { General } from './general'
import { Selector } from './selector'
import { isNode } from './util'

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
  /**
   * Optional references just resolve to the string
   * representation if the fallback value is set to true.
   *
   * @note - Used by Less for function references
   */
  fallbackValue?: Node | true
  filter?: (node: Node) => boolean
}

type NodeType = typeof Node<string | Interpolated, ReferenceOptions>
type ReferenceParams = ConstructorParameters<NodeType>
/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Selector<string | Interpolated, ReferenceOptions> {
  declare value: string | Interpolated
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
    let { type, fallbackValue, filter: originalFilter } = this.options
    let key: string
    if (isNode(value)) {
      key = (await value.eval(context)).value
    } else {
      key = value
    }
    originalFilter ??= () => true
    let filter = (n: Node) =>
      originalFilter(n) && !context.declarationScope.has(n as Declaration)
    let opts: GetterOptions = { filter }

    let returnVal: any
    switch (type) {
      case 'variable':
        returnVal = context.rulesContext.findDeclaration(key, 'VarDeclaration', opts)
        break
      case 'property':
        returnVal = context.rulesContext.findDeclaration(key, 'Declaration', opts)
        break
      // case 'mixin':
      //   returnVal = context.rulesContext.getMixin(key, opts)
    }

    if (returnVal === undefined) {
      if (!fallbackValue) {
        throw new ReferenceError(`"${key}" is not defined`)
      }
      if (fallbackValue === true) {
        return new General(key, { type: 'Name' })
      }
      return fallbackValue
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