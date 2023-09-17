import {
  Node,
  type NodeOptions,
  defineType
} from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { Interpolated } from './interpolated'
import type { Anonymous } from './anonymous'
// import type { OutputCollector } from '../output'

// type NameType<T> = T extends Interpolated
//   ? Interpolated
//   : T extends string
//     ? string
//     : never

export type Name = Interpolated | Anonymous | string

export type DeclarationValue<U extends Node = Node, T extends Name = Name> = {
  name: T
  value: U
  /** The actual string representation of important, if it exists */
  important?: string
}

/** Used by Less */
export type DeclarationOptions = {
  merge?: 'list' | 'spaced'
}

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<
  T extends Name = Name,
  U extends Node = Node,
  O extends NodeOptions = DeclarationOptions
> extends Node<DeclarationValue<U, T>, O> {
  get name(): T {
    return this.data.get('name')
  }

  set name(v: T) {
    this.data.set('name', v)
  }

  get important() {
    return this.data.get('important')
  }

  set important(v: string | undefined) {
    this.data.set('important', v)
  }

  toTrimmedString() {
    return `${this.name}: ${this.value}${this.important ? ` ${this.important}` : ''};`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let node = this.clone() as Declaration
      node.evaluated = true
      let { name, value } = node
      /**
       * Name may be a variable or a sequence containing a variable
       *
       * @todo - is this valid if rulesets pre-emptively evaluate names?
       */
      if (name instanceof Interpolated) {
        node.name = await name.eval(context)
      } else {
        node.name = name
      }
      let newValue = await value.eval(context)
      if (newValue instanceof Nil) {
        return newValue.inherit(node)
      } else {
        node.value = newValue as U
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

export const decl = defineType<DeclarationValue<Node, Name>>(Declaration, 'Declaration', 'decl')
Declaration.prototype.allowRuleRoot = true