import * as path from 'path'
import * as fs from 'fs'
import { getConfig } from './config'
import { getTree, type TreeContextOptions } from '@jesscss/core'
import merge from 'lodash-es/merge'

/**
 * Render CSS and (optionally) a runtime module
 */
export const render = async (filePath: string, config: TreeContextOptions = {}) => {
  const opts: TreeContextOptions = merge({}, getConfig(path.dirname(filePath)), config)
  const tree = getTree(filePath, opts)

  let compilerFile = filePath.replace(/\.jess$/, '__.js')
  const { output } = await bundle.generate({
    format: 'cjs',
    file: compilerFile,
    exports: 'named'
  })
  compilerFile = path.resolve(process.cwd(), compilerFile)

  const compiler = output[0].code

  fs.writeFileSync(compilerFile, compiler)
  let css: any
  try {
    css = require(compilerFile).default(opts.vars)
    fs.unlinkSync(compilerFile)
  } catch (e) {
    fs.unlinkSync(compilerFile)
    throw e
  }

  return {
    ...css,
    $js: output[1] && (output[1] as any).source
  }
}