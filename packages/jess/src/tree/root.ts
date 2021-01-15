import { Node, NodeMap, ILocationInfo, Nil } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import { JsNode } from './js-node'

/**
 * The root node. Contains a collection of nodes
 */
export class Root extends Node {
  value: Node[]

  eval(context: Context) {
    const node = this.clone()
    const rules: Node[] = []
    this.value.forEach(rule => {
      rule = rule.eval(context)
      if (rule && !(rule instanceof Nil)) {
        rules.push(rule)
      }
      context.rootRules.forEach(rule => rules.push(rule))
      context.rootRules = []
    })
    node.value = rules
    return node
  }

  toCSS(context: Context, output: OutputCollector) {
    this.value.forEach(v => v.toCSS(context, output))
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(
      `import * as _JESS from 'jess'\n` +
      `const _J = _JESS.tree\n` +
      `const __CONTEXT = new _JESS.Context\n`,
      this.location
    )
    const jsNodes = this.value.filter(n => n instanceof JsNode)
    jsNodes.forEach(node => {
      node.toModule(context, out)
      out.add('\n')
    })

    out.add(
      `export default (__VARS = {}, __RETURN_NODE) => {\n` +
      `  const { module, ...rest } = __VARS\n`
    )
    context.indent++
    context.rootLevel++

    let pre = context.pre
    jsNodes.forEach(node => {
      out.add(pre)
      node.toModule(context, out)
      out.add('\n')
    })
  
    out.add(`${pre}const __TREE = _J.root((() => {\n`)
    out.add(`  ${pre}const __OUT = []\n`)
    context.indent++
    pre = context.pre

    this.value.forEach(node => {
      if (!(node instanceof JsNode)) {
        out.add(pre)
        out.add(`__OUT.push(`)
        node.toModule(context, out)
        out.add(`)\n`)
      }
    })
    context.indent--
    pre = context.pre
    out.add(`  ${pre}return __OUT\n${pre}})()\n`)
    out.add(`${pre}if (__RETURN_NODE) {\n`)
    out.add(`${pre}  return __TREE\n`)
    out.add(`${pre}}\n`)
    out.add(`${pre}return _JESS.render(__TREE, __CONTEXT)\n`)
    out.add('}')
    context.indent = 0
    context.rootLevel = 0
  }
}

export const root =
  (value: Node[] | NodeMap, location?: ILocationInfo) =>
    new Root(value, location)