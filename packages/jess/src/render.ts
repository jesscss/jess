import * as rollup from 'rollup'
import * as path from 'path'
import * as fs from 'fs'
import commonJs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import sucrase from '@rollup/plugin-sucrase'
import virtual from '@rollup/plugin-virtual'
import jess from './plugin/rollup'
import { default as defaultConfig } from './config'
import merge from 'lodash/merge'

/**
 * @todo - add options
 */
export const render = async (filePath: string, config = {}) => {
  const opts = merge({}, defaultConfig, config)
  const bundle = await rollup.rollup({
    input: filePath,
    plugins: [
      /**
       * @todo
       * For export bundling, stub out non-run-time AST nodes
       */
      virtual({
        './config': `export default { options: ${JSON.stringify(opts.options)}}`
      }),
      // nodeResolve({
      //   extensions: ['.js', '.ts']
      // }),
      // commonJs(),
      jess(),
      sucrase({
        exclude: ['node_modules/**'],
        transforms: ['typescript']
      })
    ],
    external: [
      /node_modules/,
      'jess'
    ]
  })

  let runtimeFile = filePath.replace(/\.jess$/, '__.js')
  const { output } = await bundle.generate({
    format: 'cjs',
    file: runtimeFile,
    exports: 'named'
  })
  runtimeFile = path.resolve(process.cwd(), runtimeFile)

  const runtime = output[0].code
  const code = (<any>output[1]).source
  fs.writeFileSync(runtimeFile, runtime)
  const css = require(runtimeFile).default(opts.vars)
  fs.unlinkSync(runtimeFile)
  
  return {
    ...css,
    $JS: code
  }
}