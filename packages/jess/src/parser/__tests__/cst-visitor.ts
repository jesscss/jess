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

describe('CST-to-AST', () => {
  // it(`rule #1`, async () => {
  //   const node = await parse(`.box { a: b; }`)
  //   expect(node.toString()).to.eq('.box {\n  a: b;\n}\n')
  // })

  // it(`rule #2`, async () => {
  //   const node = await parse(`.box> #foo.bar { a: b; }`)
  //   expect(node.toString()).to.eq('.box > #foo.bar {\n  a: b;\n}\n')
  // })

  // it(`rule #3`, async () => {
  //   const node = await parse(`.box  > #foo.bar { a: b; }`)
  //   expect(node.toString()).to.eq('.box > #foo.bar {\n  a: b;\n}\n')
  // })

  // it(`rule #4`, async () => {
  //   const node = await parse(`a { b: -1px; }`)
  //   expect(node.toString()).to.eq('a {\n  b: -1px;\n}\n')
  // })

  // it(`rule #5`, async () => {
  //   const node = await parse(`a { b: calc(-1px); }`)
  //   expect(node.toString()).to.eq('a {\n  b: calc(-1px);\n}\n')
  // })

  // it(`rule #6`, async () => {
  //   const node = await parse(`a { b: calc((-1px)); }`)
  //   expect(node.toString()).to.eq('a {\n  b: calc((-1px));\n}\n')
  // })

  // it(`rule #7`, async () => {
  //   const node = await parse(`a { b: rgb(1, 2, 3); }`)
  //   expect(node.toString()).to.eq('a {\n  b: rgb(1, 2, 3);\n}\n')
  // })

  // it(`rule #8`, async () => {
  //   const node = await parse(`a { b: rgb(0 1 2 / 50%); }`)
  //   expect(node.toString()).to.eq('a {\n  b: rgb(0 1 2 / 50%);\n}\n')
  // })

  it(`rule #9`, async () => {
    const node = await parse(`@import url("something.css");`)
    expect(node.toString()).to.eq('a {\n  b: rgb(0 1 2 / 50%);\n}\n')
  })
})

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

describe.skip('can turn CSS into an AST', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
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

