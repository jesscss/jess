import { Node, NodeMap, LocationInfo } from './node'
import { Ruleset } from './ruleset'
import { JsNode } from './js-node'
import { Nil } from './nil'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * The root node. Contains a collection of nodes
 */
export class Root extends Node {
  value: Node[]

  eval(context: Context) {
    const node = this.clone()
    const rules: Node[] = []
    context.depth++
    this.value.forEach(rule => {
      rule = rule.eval(context)
      if (rule) {
        if (rule instanceof Ruleset) {
          rules.push(...rule.value)
        }
        else if (!(rule instanceof Nil)) {
          rules.push(rule)
        }
      }

      const rootRules = this.collectRoots()
      rootRules.forEach(rule => rules.push(rule))
    })
    context.depth--
    node.value = rules
    return node
  }

  toCSS(context: Context, out: OutputCollector) {
    this.value.forEach(v => {
      v.toCSS(context, out)
      /** Another root will add its own line breaks */
      if (!(v instanceof Root)) {
        out.add('\n')
      }
    })
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(
      `import * as $J from 'jess'\n` +
      `const $CONTEXT = new $J.Context(${JSON.stringify(context.originalOpts)})\n` +
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
    context.depth++

    let pre = context.pre
    jsNodes.forEach(node => {
      out.add(pre)
      node.toModule(context, out)
      out.add('\n')
    })
  
    if (!context.opts.dynamic && context.isRuntime) {
      out.add(`${pre}return {\n`)
      let i = 0
      context.exports.forEach(key => {
        if (i !== 0) {
          out.add(',\n')
        }
        i++
        out.add(`${pre}  ${key}`)
      })
      out.add(`\n${pre}}\n`)
    } else {
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
      out.add(`  ${pre}return $OUT\n${pre}})(),${JSON.stringify(this.location)})\n`)
      out.add(`${pre}if ($RETURN_NODE) {\n`)
      out.add(`${pre}  return $TREE\n`)
      out.add(`${pre}}\n`)
      out.add(`${pre}return {\n`)
      out.add(`${pre}  ...$J.renderCss($TREE, $CONTEXT)`)
      context.exports.forEach(key => {
        out.add(`,\n${pre}  ${key}`)
      })
      out.add(`\n${pre}}\n`)
    }
    out.add('}\n')
    // out.add(`$DEFAULT.$IS_NODE = true\n`)
    out.add('const $DEFAULT_PROXY = $J.proxy($DEFAULT, $CONTEXT)\n')
    out.add('$DEFAULT_PROXY(undefined, true)\n')
    out.add('export default $DEFAULT_PROXY')
    context.indent = 0
    context.depth = 0
  }
}
Root.prototype.type = 'Root'

export const root =
  (value: Node[] | NodeMap, location?: LocationInfo) =>
    new Root(value, location)