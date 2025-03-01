import {
  Node,
  defineType
} from './node'
import { isNode } from './util'
import { Nil } from './nil'
import type { Context } from '../context'
import { Interpolated } from './interpolated'
import type { General } from './general'
import {
  type BaseDeclarationValue,
  type DeclarationName,
  BaseDeclaration,
  type BaseDeclarationOptions
} from './base-declaration'

export type DeclarationOptions = BaseDeclarationOptions & {
  semi?: boolean
}

export type DeclarationValue = BaseDeclarationValue & {
  value: Node
  /** The actual string representation of important, if it exists */
  important?: General<'Flag'>
}

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<
  O extends DeclarationOptions = DeclarationOptions,
  N extends DeclarationName = DeclarationName
> extends BaseDeclaration<N, DeclarationValue, O> {
  declare value: DeclarationValue
  type = 'Declaration' as const
  shortType = 'decl' as const
  override allowRuleRoot = true
  override requiredSemi = true

  override toTrimmedString(depth?: number) {
    const { name, value, important } = this.value
    const { assign = ':' } = this.options
    let a = assign === ':' ? ':' : ` ${assign}`
    if (isNode(value, 'Collection')) {
      return `${name}${a}${value.toString(depth)}`
    }
    return `${name}${a}${value.toString(depth)}${important ? `${important}` : ''}`
  }

  override async evalNode(context: Context) {
    /** @todo - don't clone */
    let node = this.clone()
    node.evaluated = true
    let { name, value } = node.value
    /**
     * Name may be a variable or a sequence containing a variable
     *
     * @todo - is this valid if rulesets pre-emptively evaluate names?
     */
    if (name instanceof Interpolated) {
      node.data.set('name', await name.eval(context) as N)
    } else {
      node.data.set('name', name)
    }
    if (value instanceof Node) {
      let newValue = await value.eval(context)
      if (newValue instanceof Nil) {
        return newValue.inherit(node)
      } else {
        node.data.set('value', newValue)
      }
    }
    return node
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

export const decl = defineType<DeclarationValue>(Declaration, 'Declaration', 'decl') as (
  value: DeclarationValue | DeclarationParams[0],
  options?: DeclarationParams[1],
  location?: DeclarationParams[2],
  treeContext?: DeclarationParams[3]
) => Declaration
