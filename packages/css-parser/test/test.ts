import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { Parser } from '../src'
import { stringify } from '../src/util/cst'

const testData = path.dirname(require.resolve('@less/test-data'))

const cssParser = new Parser()

/**
 * @todo - write error cases
 */
describe.only('can parse all CSS stylesheets', () => {
  glob.sync(path.join(__dirname, 'css/**/*.css'))
    .sort()
    .forEach(file => {
      if (!file.includes('errors')) {
        it(`${file}`, () => {
          const result = fs.readFileSync(file)
          const contents = result.toString()
          const { cst, lexerResult, parser } = cssParser.parse(contents)
          expect(lexerResult.errors.length).toBe(0)
          expect(parser.errors.length).toBe(0)

          /** This contains CDO tokens, which are skipped */
          // if (!(['test/css/custom-properties.css'].includes(file))) {
          //   const output = stringify(cst)
          //   expect(output).toBe(contents)
          // }
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
  'css/_main/property-name-interp.css',

  /** invalid attribute selector */
  'css/_main/css-3.css',

  /** Invalid class selector .123 */
  'css/_main/mixins-interpolated.css',

  /** invalid attribute selector */
  'css/_main/selectors.css'
]

describe('can parse Less CSS output', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
    .map(value => path.relative(testData, value))
    .filter(value => !invalidCSSOutput.includes(value))
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const { lexerResult, parser } = cssParser.parse(result.toString())
        expect(lexerResult.errors.length).toBe(0)
        expect(parser.errors.length).toBe(0)
      })
    })
})

describe('returns errors on invalid Less CSS output', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
    .map(value => path.relative(testData, value))
    .filter(value => invalidCSSOutput.includes(value))
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const { lexerResult, parser } = cssParser.parse(result.toString())
        expect(lexerResult.errors.length).toBe(0)
        expect(parser.errors.length).toBeGreaterThan(0)
      })
    })
})