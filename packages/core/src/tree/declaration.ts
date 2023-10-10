import {
  Node,
  defineType
} from './node'
import { isNode } from './util'
import { Nil } from './nil'
import type { Context } from '../context'
import { Interpolated } from './interpolated'
import type { Anonymous } from './anonymous'
import {
  type BaseDeclarationValue,
  type Name,
  BaseDeclaration,
  type BaseDeclarationOptions
} from './base-declaration'

export type DeclarationOptions = BaseDeclarationOptions & {
  semi?: boolean
}

export type DeclarationValue = BaseDeclarationValue & {
  value: Node
  /** The actual string representation of important, if it exists */
  important?: Anonymous
}

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<O extends DeclarationOptions = DeclarationOptions, N extends Name = Name> extends BaseDeclaration<N, DeclarationValue, O> {
  get name(): N {
    return this.data.get('name')
  }

  set name(v: N) {
    this.data.set('name', v)
  }

  get value(): Node {
    return this.data.get('value')
  }

  set value(v: Node) {
    this.data.set('value', v)
  }

  get important() {
    return this.data.get('important')
  }

  set important(v: Anonymous | undefined) {
    this.data.set('important', v)
  }

  toTrimmedString(depth?: number) {
    const { name, value, important } = this
    const { assign = ':' } = this.options ?? {}
    let a = assign === ':' ? ':' : ` ${assign}`
    let semi = this.options?.semi !== true ? '' : ';'
    if (isNode(value, 'Collection')) {
      return `${name}${a}${value.toString(depth)}`
    }
    return `${name}${a}${value.toString(depth)}${important ? `${important}` : ''}${semi}`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let node = this.clone()
      node.evaluated = true
      let { name, value } = node
      /**
       * Name may be a variable or a sequence containing a variable
       *
       * @todo - is this valid if rulesets pre-emptively evaluate names?
       */
      if (name instanceof Interpolated) {
        node.name = await name.eval(context) as N
      } else {
        node.name = name
      }
      if (value instanceof Node) {
        let newValue = await value.eval(context)
        if (newValue instanceof Nil) {
          return newValue.inherit(node)
        } else {
          node.value = newValue
        }
      }
      return node
    })
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.name.toCSS(context, out)
  //   out.add(': ')
  //   context.cast(this.value).toCSS(context, out)
  //   if (this.important) {
  //     out.add(' ')
  //     this.important.toCSS(context, out)
  //   }
  //   out.add(';')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   const loc = this.location
  //   out.add('$J.decl({\n', loc)
  //   context.indent++
  //   out.add(`  ${pre}name: `)
  //   this.name.toModule(context, out)
  //   out.add(`,\n  ${pre}value: `)
  //   this.value.toModule(context, out)
  //   if (this.important) {
  //     out.add(`,\n  ${pre}important: `)
  //     this.important.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n${pre}})`)
  // }
}

type DeclarationParams = ConstructorParameters<typeof Declaration>

const origDefine = defineType<DeclarationValue>(Declaration, 'Declaration', 'decl') as (
  value: DeclarationValue | DeclarationParams[0],
  options?: DeclarationParams[1],
  location?: DeclarationParams[2],
  treeContext?: DeclarationParams[3]
) => Declaration

export const decl = (
  value: DeclarationValue | DeclarationParams[0],
  options?: DeclarationParams[1],
  location?: DeclarationParams[2],
  treeContext?: DeclarationParams[3]
) => {
  /**
   * For convenience, add pre-whitespace to value node
   * @todo - for custom properties, this should be handled differently
  */
  const node = origDefine(value, options, location, treeContext)
  node.value.pre = 1
  return node
}

Declaration.prototype.allowRuleRoot = true