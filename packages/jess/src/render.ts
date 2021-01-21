import type { Node } from './tree'
import { Context } from './context'
import { OutputCollector } from './output'
import * as fs from 'fs'
import * as path from 'path'
import { parse } from './parser'

const hashCode = (str: string) => {
  var hash = 0
  for (let i = 0; i < str.length; i++) {
    let chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0 // Convert to 32bit integer
  }
  return hash
}

export const renderModule = async (filePath: string) => {
  const readPath = path.resolve(process.cwd(), filePath)
  try {
    const contents = await fs.promises.readFile(readPath)
    const root = await parse(contents.toString(), {
      filename: filePath,
      rootpath: process.cwd()
    })
    const context = new Context
    context.id = hashCode(readPath).toString()
    const out = new OutputCollector
    /** 
     * We evaluate the tree but don't return it.
     * We just want to attach eval'd classes to
     * the default function. 
     */
    root.eval(context)
    root.toModule(context, out)
    return {
      code: out.toString()
    }
  } catch (e) {
    console.log(e)
  }
}

/**
 * Given a root node (usually from a module) render to CSS
 */
export const renderCss = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  const out = new OutputCollector
  evaldRoot.toCSS(context, out)
  const result = {
    $CSS: out.toString(),
    ...context.classMap
  }
  return result
}