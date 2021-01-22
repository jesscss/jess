import rollup from 'rollup'
import commonJs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import sucrase from '@rollup/plugin-sucrase'
import jess from './plugin/rollup'

/**
 * @todo - add options
 */
export const render = async (filePath: string, opts = {}) => {
  const bundle = rollup.rollup({
    input: filePath,
    plugins: [
      nodeResolve({
        extensions: ['.js', '.ts']
      }),
      commonJs(),
      sucrase({
        exclude: ['node_modules/**'],
        transforms: ['typescript']
      }),
      jess()
    ]
  })
}