import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { Parser } from '../src'
import { stringify } from '@jesscss/css-parser'

const testData = path.dirname(require.resolve('@less/test-data'))

const lessParser = new Parser()
const parser = lessParser.parser

describe('can parse any rule', () => {
  it('declaration', () => {
    const lexerResult = lessParser.lexer.tokenize(`color: green;`)
    const lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.declaration()
    expect(parser.errors.length).to.equal(0)
  })

  it('qualified rule', () => {
    let lexerResult = lessParser.lexer.tokenize(
      `light when (`
    )
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    let cst = parser.testQualifiedRule()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `.light when (lightness(@a) > 50%) {
          color: green;
      }`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    cst = parser.qualifiedRule()
    expect(parser.errors.length).to.equal(0)
  })

  it('mixin definition', () => {
    let lexerResult = lessParser.lexer.tokenize(
      `.mixin_def_with_colors(@a: white, // in
              @b: 1px //put in @b - causes problems! --->
              ) // the
              when (@a = white) {
          .test-rule {
              color: @b;
          }
      }`
    )
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `.mixin-definition(@a: {}, @b: {default: works;}) {
        @a();
        @b();
      }`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `.m(@x) when (default()) and (@x = 3) {default: @x}`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `.mixin-args(@a: 1, 2, 3; @b: 3);`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.root()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `.mixin-definition(@a: {}; @b: {default: works;};) {
        @a();
        @b();
      }`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.root()
    expect(parser.errors.length).to.equal(0)


    lexerResult = lessParser.lexer.tokenize(
      `.b(`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.testMixin()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `#mixin > .mixin (`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.testMixin()
    expect(parser.errors.length).to.equal(0)
  })

  it('mixin call', () => {
    let lexerResult = lessParser.lexer.tokenize(`.mixin-with-guard-inside(0px);`)
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(`.wrap-mixin(@ruleset: {
        color: red;
      });`)
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()

    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(`.mixin-call({direct: works;}; @b: {named: works;});`)
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.root()
    expect(parser.errors.length).to.equal(0)

    lexerResult = lessParser.lexer.tokenize(
      `.parenthesisNot(`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.testMixin()
    expect(parser.errors.length).to.equal(0)
  })

  it('variable declaration', () => {
    // let lexerResult =
    //   lessParser.lexer.tokenize(`@ruleset:`)
    // let lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testVariable()
    // expect(parser.errors.length).to.equal(0)

    let lexerResult = lessParser.lexer.tokenize(`@ruleset: {
        color: red;
      }`)
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.unknownAtRule()
    expect(parser.errors.length).to.equal(0)
  })
})

/**
 * These files contain invalid CSS which
 * the current production Less parser doesn't
 * catch. However, this parser extends a CSS
 * parser and therefore catches more errors.
 */
const invalidLess = [
  'less/_main/css-3.less',
  'less/_main/css-guards.less',
  'less/_main/extract-and-length.less',
  'less/_main/functions.less',
  'less/_main/mixins-interpolated.less',

  /** @todo */
  'less/_main/permissive-parse.less',
  'less/_main/property-name-interp.less',
  'less/compression/compression.less',
  'less/main/always/no-sm-operations.less',

  /**
   * This one uses a valid CSS number '+4' as a math expression.
   * This is an ambiguous error in Less which doesn't recognize
   * '+4' as a single unit.
   */
  'less/math/always/mixins-guards.less',

  'less/math/always/no-sm-operations.less',
  'less/math/parens-division/new-division.less',
  'less/math/strict/css.less',
  'less/_main/import/invalid-css.less'

]

describe('can parse all Less stylesheets', () => {
  const files = glob.sync(path.join(testData, 'less/**/*.less'))
  files
    .map(value => path.relative(testData, value))
    .filter(value => invalidLess.indexOf(value) === -1)
    .sort()
    .forEach(file => {
      // if (file.indexOf('namespacing-') > -1) {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const contents = result.toString()
        const { cst, lexerResult } = lessParser.parse(contents)
        expect(lexerResult.errors.length).to.equal(0)
        if (parser.errors.length > 0) {
          console.log(parser.errors)
        }
        expect(parser.errors.length).to.equal(0)
        
        /** JavaScript tokens are skipped */
        if (!([
          'less/_main/javascript.less',
          'less/no-js-errors/no-js-errors.less'
        ].includes(file))) {
          const output = stringify(cst)
          expect(output).to.equal(contents)
        }
      })
      // }
    })
})

// Skipped until we fix these flows
describe.skip('should throw parsing errors', () => {
  const files = glob.sync(
    path.relative(process.cwd(), path.join(testData, 'errors/parse/**/*.less'))
  )
  files.sort()
  files.forEach(file => {
    it(`${file}`, () => {
      const result = fs.readFileSync(file)
      const { cst, lexerResult, parser } = lessParser.parse(result.toString())
      expect(lexerResult.errors.length).to.equal(0)
      expect(parser.errors.length).to.equal(1)
    })
  })
})
