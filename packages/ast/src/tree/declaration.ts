import { Node, defineType } from './node'
import { Anonymous } from './anonymous'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type DeclarationValue = {
  name: Node | string
  value: Node
  /** The actual string representation of important, if it exists */
  important?: string
}

/**
 * A continuous collection of nodes
 */
export class Declaration extends Node<DeclarationValue> {
  get name() {
    return this.valueMap.get('name')
  }

  set name(v: Node | string) {
    this.valueMap.set('name', v)
  }

  get important() {
    return this.valueMap.get('important')
  }

  set important(v: string | undefined) {
    this.valueMap.set('important', v)
  }

  eval(context: Context) {
    const node = this.clone()
    node.name = this.name.eval(context)
    node.value = context.cast(this.value).eval(context)
    if (node.important) {
      node.important = new Anonymous(this.important.value)
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

export const decl = defineType<DeclarationValue>(Declaration, 'Declaration', 'decl')
Declaration.prototype.allowRuleRoot = true