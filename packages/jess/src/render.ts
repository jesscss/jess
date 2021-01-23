import * as rollup from 'rollup'
import * as path from 'path'
import commonJs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import sucrase from '@rollup/plugin-sucrase'
import virtual from '@rollup/plugin-virtual'
import jess from './plugin/rollup'
import config from './config'

/**
 * @todo - add options
 */
export const render = async (filePath: string, opts = {}) => {
  const bundle = await rollup.rollup({
    input: filePath,
    plugins: [
      virtual({
        './config': `export default { options: ${JSON.stringify(config.options)}}`
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
    external: /node_modules/
  })

  const runtimeFile = filePath.replace(/\.jess$/, '__.js')
  await bundle.write({
    format: 'es',
    file: runtimeFile
  })
  
  const output = require(runtimeFile).default()

  return output
}