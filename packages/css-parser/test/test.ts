import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { Parser } from '../src'
import { stringify } from '../src/util/cst'

const testData = path.dirname(require.resolve('@less/test-data'))

const cssParser = new Parser()

/**
 * @todo - write error cases
 */
describe('can parse all CSS stylesheets', () => {
  glob.sync('test/css/**/*.css')
    .sort()
    .forEach(file => {
      if (file.indexOf('errors') === -1) {
        it(`${file}`, () => {
          const result = fs.readFileSync(file)
          const contents = result.toString()
          const { cst, lexerResult, parser } = cssParser.parse(contents)
          expect(lexerResult.errors.length).to.equal(0)
          expect(parser.errors.length).to.equal(0)
          
          /** This contains CDO tokens, which are skipped */
          if (!(['test/css/custom-properties.css'].includes(file))) {
            const output = stringify(cst)
            expect(output).to.equal(contents)
          }
        })
      }
    })
})

/**
 * These are Less output CSS test files that Less 3.x
 * doesn't recognize as containing invalid CSS, or which
 * are invalid when output.
 */
const invalidCSSOutput = [
  /** Contains a less unquoted string in root */
  'css/_main/css-escapes.css',
  
  /** Intentionally produces invalid CSS */
  'css/_main/import-inline.css',
  'css/_main/import-reference.css',

  /** intentionally invalid property name */
  'css/_main/property-name-interp.css'
]

describe('can parse Less CSS output', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
    .map(value => path.relative(testData, value))
    .filter(value => invalidCSSOutput.indexOf(value) === -1)
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const { cst, lexerResult, parser } = cssParser.parse(result.toString())
        expect(lexerResult.errors.length).to.equal(0)
        expect(parser.errors.length).to.equal(0)
      })
    })
})

describe('returns errors on invalid Less CSS output', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
    .map(value => path.relative(testData, value))
    .filter(value => invalidCSSOutput.indexOf(value) !== -1)
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const { cst, lexerResult, parser } = cssParser.parse(result.toString())
        expect(lexerResult.errors.length).to.equal(0)
        expect(parser.errors.length).to.be.gt(0)
      })
    })
})