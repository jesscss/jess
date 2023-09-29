import {
  type Node,
  type NodeOptions,
  defineType
} from './node'
import { isNode } from './util'
import {
  type BaseDeclarationValue,
  type Name,
  BaseDeclaration
} from './base-declaration'

export type DeclarationValue = BaseDeclarationValue & {
  value: Node
  /** The actual string representation of important, if it exists */
  important?: string
}

/** Used by Less */
export type DeclarationOptions = {
  /**
   * This is mostly backwards-compatibility with this Less
   * feature, and mostly isn't needed in Jess.
   *
   * It is represented as `!merge` or `!merge-spaced` when parsing
   * or converting from Less, since the `+:` syntax is not exactly
   * the same feature and operates more like JavaScript.
  */
  merge?: 'list' | 'spaced'
}

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<O extends NodeOptions = DeclarationOptions, N extends Name = Name> extends BaseDeclaration<N, DeclarationValue, O> {
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

  set important(v: string | undefined) {
    this.data.set('important', v)
  }

  toTrimmedString(depth?: number) {
    const { name, value, important } = this
    if (isNode(value, 'Collection')) {
      return `${name}: ${value.toString(depth)}`
    }
    return `${name}: ${value.toString(depth)}${important ? ` ${important}` : ''};`
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
Declaration.prototype.allowRuleRoot = true