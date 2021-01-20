import { Node, NodeMap, LocationInfo, Nil } from '.'
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

  toCSS(context: Context, out: OutputCollector) {
    this.value.forEach(v => {
      v.toCSS(context, out)
      out.add('\n')
    })
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(
      `import * as $JESS from 'jess'\n` +
      `const $J = $JESS.tree\n` +
      `const $CONTEXT = new $JESS.Context\n` +
      `$CONTEXT.id = '${context.id}'\n`,
      this.location
    )
    const jsNodes = this.value.filter(n => n instanceof JsNode)
    jsNodes.forEach(node => {
      node.toModule(context, out)
      out.add('\n')
    })

    out.add(
      `function $DEFAULT ($VARS = {}, $RETURN_NODE) {\n`
    )
    context.indent++
    context.rootLevel++

    let pre = context.pre
    jsNodes.forEach(node => {
      out.add(pre)
      node.toModule(context, out)
      out.add('\n')
    })
  
    out.add(`${pre}const $TREE = $J.root((() => {\n`)
    out.add(`  ${pre}const $OUT = []\n`)
    context.indent++
    pre = context.pre

    this.value.forEach(node => {
      if (!(node instanceof JsNode)) {
        out.add(pre)
        out.add(`$OUT.push(`)
        node.toModule(context, out)
        out.add(`)\n`)
      }
    })
    context.indent--
    pre = context.pre
    out.add(`  ${pre}return $OUT\n${pre}})()\n`)
    out.add(`${pre}if ($RETURN_NODE) {\n`)
    out.add(`${pre}  return $TREE\n`)
    out.add(`${pre}}\n`)
    out.add(`${pre}return $JESS.render($TREE, $CONTEXT)\n`)
    out.add('}\n')
    const classMap = context.classMap
    for (let prop in classMap) {
      out.add(`$DEFAULT["${prop}"] = "${classMap[prop]}"\n`)
    }
    out.add('export default $DEFAULT')
    context.indent = 0
    context.rootLevel = 0
  }
}

export const root =
  (value: Node[] | NodeMap, location?: LocationInfo) =>
    new Root(value, location)