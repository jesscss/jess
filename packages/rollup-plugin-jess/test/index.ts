import * as rollup from 'rollup'
import * as path from 'path'
import * as fs from 'fs'
import jess from '../src/index'
import commonJs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'

/**
 * @todo - test making a bundle with CSS / JS output
 */
const buildFile = async (filePath: string) => {
  const input = path.resolve(__dirname, filePath)
  const bundle = await rollup.rollup({
    input,
    plugins: [
      nodeResolve(),
      commonJs(),
      jess()
    ]
  })
  const { output } = await bundle.generate({
    format: 'umd',
    name: 'jess'
  })
  return output
}

describe('test', () => {
  it('produces a bundle', async () => {
    const result = await buildFile('./test.jess')
    // fs.writeFileSync(path.resolve(__dirname, 'test.js'), result[0].code)
    // console.log(result)
  })
})