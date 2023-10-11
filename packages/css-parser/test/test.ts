import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { CssParser } from '../src'
import { stringify } from '../src/util/cst'

const testData = path.dirname(require.resolve('@less/test-data'))

/** @todo - demonstrate with / without `legacyMode` and/or `loose` */
const cssParser = new CssParser()

/**
 * @todo - write error cases
 */
describe('can parse all CSS stylesheets', () => {
  glob.sync(path.join(__dirname, 'css/**/*.css'))
    .sort()
    .forEach(file => {
      if (!file.includes('errors')) {
        it(`${file}`, () => {
          const result = fs.readFileSync(file)
          const contents = result.toString()
          const { lexerResult, errors } = cssParser.parse(contents)
          expect(lexerResult.errors.length).toBe(0)
          expect(errors.length).toBe(0)

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
  'css/_main/selectors.css',

  /** Contains an invalid Microsoft progid filter */
  'css/_main/strings.css',

  /**
   * All of these contain a property with no value,
   * and/or a list with no value
   */
  'css/_main/extract-and-length.css',
  'css/_main/comments.css',
  'css/_main/functions.css',
  'css/_main/javascript.css'
]

describe.only('can parse Less CSS output', () => {
  glob.sync(path.join(testData, 'css/_main/plugin.css'))
    .map(value => path.relative(testData, value))
    .filter(value => !invalidCSSOutput.includes(value))
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const contents = result.toString()
        // const parseStart = performance.now()
        const { tree, lexerResult, errors } = cssParser.parse(contents)
        // const parseEnd = performance.now()
        expect(lexerResult.errors.length).toBe(0)
        expect(errors.length).toBe(0)

        if (!(['test/css/custom-properties.css'].includes(file))) {
          const output = `${tree}`
          expect(output).toBe(contents)
        }
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
        const contents = result.toString()
        // const parseStart = performance.now()
        const { lexerResult, errors } = cssParser.parse(contents)
        // const parseEnd = performance.now()
        expect(lexerResult.errors.length).toBe(0)
        expect(errors.length).toBeGreaterThan(0)
      })
    })
})