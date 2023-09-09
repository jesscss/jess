import {
  Node,
  defineType
} from './node'
import { Nil } from './nil'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type DeclarationValue<T = Node | string, U extends Node = Node> = {
  name: T
  value: U
  /** The actual string representation of important, if it exists */
  important?: string
}

/** Used by Less */
export type DeclarationOptions = {
  merge?: boolean
}

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<T = Node | string, U extends Node = Node> extends Node<DeclarationValue<T, U>, DeclarationOptions> {
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

  eval(context: Context): Declaration<string> | Nil {
    const node = this.clone()
    node.evaluated = true
    const { name, value } = node
    /** Name may be a variable or a sequence containing a variable */
    if (name instanceof Node) {
      const evald = name.eval(context)
      if (typeof evald.value !== 'string') {
        throw new Error('Invalid name')
      }
      node.name = name
    } else {
      node.name = name
    }
    const newValue = value.eval(context)
    if (newValue instanceof Nil) {
      return newValue.inherit(node)
    } else {
      context.scope.set(node.name as string, node)
      node.value = newValue as U
    }
    return this.finishEval<Declaration<string>>(node)
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

export const decl = defineType<DeclarationValue>(Declaration, 'Declaration', 'decl')
Declaration.prototype.allowRuleRoot = true