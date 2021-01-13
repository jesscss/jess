import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { expect } from 'chai'
import 'mocha'
import { Parser } from '../src'
import { stringify } from '@jesscss/css-parser'

const testData = path.dirname(path.resolve('./data'))

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
      `@mixin mixin (a: white, // test
            b: 1px // line
          ) // comments {
      {
        color: $b;
      }`
    )
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.mixin()
    expect(parser.errors.length).to.equal(0)

    /** Collections */
    lexerResult = jessParser.lexer.tokenize(
      `@mixin someMixin (a: {}, b: {default: works;}) {
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

    lexerResult = jessParser.lexer.tokenize(
      `@mixin someMixin {
        one: 1;
        two: 2;
      }`
    )
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.root()
    expect(parser.errors.length).to.equal(0)
  })

  it('include', () => {
    let lexerResult = jessParser.lexer.tokenize(`@include mixin(0px);`)
    let lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.atInclude()
    expect(parser.errors.length).to.equal(0)

    lexerResult = jessParser.lexer.tokenize(
      `@include wrapCollection({
        color: red;
      });`)
    lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    parser.atInclude()

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
    parser.root()
    expect(parser.errors.length).to.equal(0)
  })
})

describe('can parse all Jess stylesheets', () => {
  const files = glob.sync(path.join(testData, '**/*.jess'))
  files
    .map(value => path.relative(testData, value))
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const contents = result.toString()
        const { cst, lexerResult } = jessParser.parse(contents)
        expect(lexerResult.errors.length).to.equal(0)
        expect(parser.errors.length).to.equal(0)
      })
    })
})
