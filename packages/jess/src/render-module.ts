import { Context } from './context'
import { OutputCollector } from './output'
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

/**
 * Used by the Rollup pre-processor
 * 
 * @param {string} contents - Full file contents
 * @param {string} filePath - absolute path to file
 */
export const renderModule = async (contents: string, filePath: string) => {
  try {
    const root = await parse(contents, {
      filename: filePath,
      rootpath: process.cwd()
    })
    const context = new Context
    context.id = hashCode(filePath).toString(16)
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
    /**
     * @todo - format errors a la eslint
     */
    throw e
  }
}
