import { expect } from 'chai'
import 'mocha'

import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
const testData = path.dirname(require.resolve('@less/test-data'))

import { parse } from '..'
import { Context } from '../../context'

const context = new Context()

const serialize = (str: string) => {
  return async () => {
    const node = await parse(str)
    expect(node.toString()).to.eq(str)
  }
}

// describe('CST-to-AST', () => {
//   it(`rule #1`, done => {
//     parser.parse(`@foo: bar`, (err, node) => {
//       const val = node.nodes[0].nodes[0]
//       expect(val.type).to.eq('Value')
//       expect(val.value).to.eq('bar')
//       done()
//     })
//   })
// })

const invalidCSSOutput = [
  /** Contains a less unquoted string in root */
  'css/_main/css-escapes.css',
  
  /** Intentionally produces invalid CSS */
  'css/_main/import-inline.css',
  'css/_main/import-reference.css',

  /** intentionally invalid property name */
  'css/_main/property-name-interp.css',

  /** invalid attribute selector */
  'css/_main/css-3.css',

  /** Invalid class selector .123 */
  'css/_main/mixins-interpolated.css',

  /** invalid attribute selector */
  'css/_main/selectors.css'
]

describe('can turn CSS into an AST', () => {
  glob.sync(path.join(testData, 'css/_main/calc.css'))
    .map(value => path.relative(testData, value))
    .filter(value => invalidCSSOutput.indexOf(value) === -1)
    .sort()
    .forEach(file => {
      it(`${file}`, async () => {
        const result = fs.readFileSync(path.join(testData, file))
        const node = await parse(result.toString())
        console.log(node.toString())
      })
    })
})

