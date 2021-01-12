import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { Parser } from '../src'
import { stringify } from '@jesscss/css-parser'

const testData = path.dirname(require.resolve('@less/test-data'))

const jessParser = new Parser()
const parser = jessParser.parser

describe('can parse any rule', () => {
  it('declaration', () => {
    const lexerResult = jessParser.lexer.tokenize(`color: green;`)
    const lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.declaration()
    expect(parser.errors.length).to.equal(0)
  })

  it('qualified rule', () => {
    let lexerResult = jessParser.lexer.tokenize(
      `.light {
          color: green;
      }`
    )
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    let cst = parser.qualifiedRule()
    expect(parser.errors.length).to.equal(0)
  })

  it('mixin definition', () => {
    let lexerResult = jessParser.lexer.tokenize(
      `@mixin myMixin (@a: white, // test
            @b: 1px // line
          ) // comments {
        color: @b;
      }`
    )
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)

    /** Collections */
    lexerResult = jessParser.lexer.tokenize(
      `@mixin mixin-definition(@a: {}, @b: {default: works;}) {
        @let a: $a;
        @let b: $b;
      }`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)
    parser.input = lexedTokens
    parser.root()
    expect(parser.errors.length).to.equal(0)
  })

  it('include', () => {
    let lexerResult = jessParser.lexer.tokenize(`@include mixin(0px);`)
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.include()
    expect(parser.errors.length).to.equal(0)

    lexerResult = jessParser.lexer.tokenize(
      `@include wrapCollection({
        color: red;
      });`)
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.include()

    expect(parser.errors.length).to.equal(0)

    lexerResult = jessParser.lexer.tokenize(
      `@include mixinCall({direct: works;}, {collection: works;});`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.root()
    expect(parser.errors.length).to.equal(0)
  })

  it('variable declaration', () => {
    let lexerResult = jessParser.lexer.tokenize(
      `@let collection {
        color: red;
      }`)
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.unknownAtRule()
    expect(parser.errors.length).to.equal(0)
  })
})

describe('can parse all Less stylesheets', () => {
  const files = glob.sync(path.join(testData, 'less/**/*.less'))
  files
    .map(value => path.relative(testData, value))
    .filter(value => [
      'less/_main/import/invalid-css.less'
    ].indexOf(value) === -1)
    .sort()
    .forEach(file => {
      // if (file.indexOf('namespacing-') > -1) {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const contents = result.toString()
        const { cst, lexerResult } = jessParser.parse(contents)
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
      const { cst, lexerResult, parser } = jessParser.parse(result.toString())
      expect(lexerResult.errors.length).to.equal(0)
      expect(parser.errors.length).to.equal(1)
    })
  })
})
