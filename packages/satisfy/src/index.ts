import { CssParser } from '@jesscss/css-parser'
import { isNode, type Rules } from '@jesscss/core'

import jsdom from 'jsdom'
const { JSDOM } = jsdom

const parser = new CssParser()

export default function satisfy(css: string) {
  const { tree } = parser.parse(css)
  const dom = new JSDOM('')
  const { window: { document } } = dom

  const processRules = (rule: Rules, currentNode: Element) => {
    tree.walkNodes((node) => {
      if (isNode(node, 'Ruleset')) {
        const node = currentNode.appendChild(document.createElement('div'))
      }
    }, true)
  }

  processRules(tree, document.body)
  return document.body.innerHTML
}