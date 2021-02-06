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
 * @param contents - Full file contents
 * @param filePath - absolute path to file
 * 
 * @todo - format errors a la eslint
 */
export const renderModule = async (
  contents: string,
  filePath: string,
  opts: {[k: string]: any } = {}
) => {
  const contextOpts = /\.m(odule)?\.jess/.test(filePath)
    ? {
      module: true,
      ...opts
    } : opts
  const root = await parse(contents, {
    filename: filePath,
    rootpath: process.cwd()
  })

  /** Create compile-time module */
  let context = new Context(contextOpts)
  const contextId = hashCode(filePath).toString(16)
  context.id = contextId
  let out = new OutputCollector
  let $js: string
  let $js_runtime: string
  root.toModule(context, out)
  $js = out.toString()

  /** Create run-time module */
  out = new OutputCollector
  context = new Context(contextOpts)
  context.id = contextId
  context.isRuntime = true
  root.toModule(context, out)
  $js_runtime = out.toString()

  /** @todo - sourcemaps for runtime */
  return {
    $js, $js_runtime
  }
}
