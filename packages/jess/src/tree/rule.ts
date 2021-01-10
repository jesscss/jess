import { Node, NodeMap, ILocationInfo, Let } from '.'
import type { Context } from '../context'

type RuleValue = NodeMap & {
  sels: Node
  value: Node[]
}
/**
 * A qualified rule
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Rule extends Node {
  sels: Node
  value: Node[]

  eval(context: Context) {
    if (!this.evaluated) {
      const rule = this.clone()
      rule.sels = this.sels.eval(context)
      
      context.frames.unshift(rule)
      rule.value = this.value.map(rule => rule.eval(context))
      context.frames.shift()

      rule.evaluated = true
      return rule
    }
    return this
  }

  toString() {
    const { sels, value } = this
    let out = `${sels} {\n`
      + value.map(v => `  ${v}`).join('\n')
      + '\n}\n'
    return out
  }

  toModule(context: Context) {
    let isRoot = context.isRoot
    context.isRoot = false

    let out = `J.rule({\n`
    context.indent++
    let pre = context.pre
    out += `${pre}sels: ${this.sels.toModule(context)},\n`
      + `${pre}value: (() => {\n`
    context.indent++
    out += `  ${pre}const __OUT = []\n`
      + this.value.map(node => 
      node instanceof Let
        ? `  ${pre}${node.toModule(context)}`
        : `  ${pre}__OUT.push(${node.toModule(context)})`
    ).join('\n')
      + `\n  ${pre}return __OUT\n`
      + `${pre})()`
    context.indent -= 2
    pre = context.pre
    out += `\n${pre}})`

    context.isRoot = isRoot
    return out
  }
}

export const rule =
  (value: RuleValue, location?: ILocationInfo) =>
    new Rule(value, location)