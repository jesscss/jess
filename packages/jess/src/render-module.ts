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
 * 
 * @todo - format errors a la eslint
 */
export const renderModule = async (contents: string, filePath: string) => {
  const contextOpts = /\.m(odule)?\.jess/.test(filePath) ? { module: true } : {}
  const root = await parse(contents, {
    filename: filePath,
    rootpath: process.cwd()
  })
  const context = new Context(contextOpts)
  context.id = hashCode(filePath).toString(16)
  const out = new OutputCollector
  root.toModule(context, out)
  return {
    code: out.toString()
  }
}
