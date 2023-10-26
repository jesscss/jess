import * as glob from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { Parser } from '../src'

const testData = path.dirname(require.resolve('@less/test-data'))

const lessParser = new Parser()
const parse = lessParser.parse

describe('can parse any rule', () => {
  test('qualified rule with interpolation', () => {
    const { errors } = parse(
      'qw@{ident} { foo: bar }',
      'main'
    )
    expect(errors.length).toBe(0)
  })

  test('anonymous mixins', () => {
    const { errors } = parse(
      '.(@v;@i) {}',
      'anonymousMixinDefinition'
    )
    expect(errors.length).toBe(0)
  })

  test('comparison', () => {
    const { errors } = parse(
      '@a = white',
      'comparison'
    )
    expect(errors.length).toBe(0)
  })

  test('assignment', () => {
    const { errors } = parse(
      '@a: 1px;',
      'stylesheet'
    )
    expect(errors.length).toBe(0)
  })

  test('assignment to mixin', () => {
    const { errors } = parse(
      `@ruleset: {
        color: black;
        background: white;
      }`,
      'stylesheet'
    )
    expect(errors.length).toBe(0)
  })

  test('when guard', () => {
    const { errors } = parse(
      'when(@a = white)',
      'guard'
    )
    expect(errors.length).toBe(0)
  })

  test('declaration', () => {
    const { errors } = parse(
      'color: green',
      'declaration'
    )
    expect(errors.length).toBe(0)
  })

  test('accessors', () => {
    const { errors } = parse(
      'color: @p[accessor]',
      'declaration'
    )
    expect(errors.length).toBe(0)
  })

  test('qualified rule', () => {
    const { errors } = parse(
      `.light when (lightness(@a) > 50%) {
          color: green;
      }`,
      'qualifiedRule'
    )
    expect(errors.length).toBe(0)
  })

  test('parses mixin args', () => {
    const { errors } = parse(
      '(@v)',
      'mixinArgs',
      { isDefinition: true }
    )
    expect(errors.length).toBe(0)
  })

  test('non-nested at-rule', () => {
    const { errors } = parse(
      '@namespace @ns "http://lesscss.org";',
      'nonNestedAtRule'
    )
    expect(errors.length).toBe(0)
  })

  test('mixin definition', () => {
    // let lexerResult = lessParser.lexer.tokenize(
    //   `.mixin_def_with_colors(@a: white, // in
    //           @b: 1px //put in @b - causes problems! --->
    //           ) // the
    //           when (@a = white) {
    //       .test-rule {
    //           color: @b;
    //       }
    //   }`
    // )
    // let lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.mixinDefinition()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   `.mixin-definition(@a: {}, @b: {default: works;}) {
    //     @a();
    //     @b();
    //   }`
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.mixinDefinition()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '.m(@x) when (default()) and (@x = 3) {default: @x}'
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.mixinDefinition()
    // expect(parser.errors.length).toBe(0)

    const { errors } = parse(
      '.m(@v) when (@v)        {two: when true}',
      'mixinDefinition'
    )
    expect(errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '.mixin-args(@a: 1, 2, 3; @b: 3);'
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.stylesheet()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   `.mixin-definition(@a: {}; @b: {default: works;};) {
    //     @a();
    //     @b();
    //   }`
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.stylesheet()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '.b('
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testMixin()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '#mixin > .mixin ('
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testMixin()
    // expect(parser.errors.length).toBe(0)
  })

  test('mixin call', () => {
    let { errors } = parse(
      '.mixin-with-guard-inside(0px);',
      'mixinCall'
    )
    expect(errors.length).toBe(0)

    ;({ errors } = parse(
      `.wrap-mixin(@ruleset: {
        color: red;
      });`,
      'mixinCall'
    ))

    expect(errors.length).toBe(0)

    ;({ errors } = parse(
      '.mixin-takes-two(@a : d, e; @b : f);',
      'mixinCall'
    ))

    expect(errors.length).toBe(0)

    ;({ errors } = parse(
      '.mixin-call({direct: works;}; @b: {named: works;});',
      'stylesheet'
    ))
    expect(errors.length).toBe(0)

    ;({ errors } = parse(
      `.mixout ('left') {
        left: 1;
      }`,
      'mixinCall'
    ))
  })

  it('variable declaration', () => {
    // let lexerResult =
    //   lessParser.lexer.tokenize(`@ruleset:`)
    // let lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testVariable()
    // expect(parser.errors.length).to.equal(0)

    const { errors } = parse(
      `@ruleset: {}
      @a: 1px;`,
      /** @todo - add `variableDeclaration` as sugar */
      'stylesheet'
    )
    expect(errors.length).toBe(0)
  })
})

/**
 * These files contain invalid CSS which
 * the current production Less parser doesn't
 * catch. However, this parser extends a CSS
 * parser and therefore catches more errors.
 */
const invalidLess = [
  /** This file is full of errors. */
  'less/_main/css-3.less',

  'less/_main/css-guards.less',
  'less/_main/extract-and-length.less',
  'less/_main/functions.less',
  'less/_main/mixins-interpolated.less',

  /** @todo */
  'less/_main/permissive-parse.less',
  'less/_main/property-name-interp.less',
  'less/compression/compression.less',

  // 'less/math/parens-division/new-division.less',
  'less/math/strict/css.less',
  'less/_main/import/invalid-css.less',

  /** Contains invalid `[prop=10%]` */
  'less/_main/selectors.less',

  /**
   * This has a variable in a `@charset`, which definitely
   * should not be allowed.
   */
  'less/_main/variables-in-at-rules.less'
]

describe.only('can parse all Less stylesheets', () => {
  const files = glob.sync(path.join(testData, 'less/**/*.less'))
  files
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .sort()
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file))
        const contents = result.toString()
        // const parseStart = performance.now()
        const { lexerResult, errors } = lessParser.parse(contents)
        // const parseEnd = performance.now()
        // console.log(`${file} parse time: ${Math.round(parseEnd - parseStart)}ms`)
        // expect(`(${Math.round(parseEnd - parseStart)}ms)`).toBeDefined()
        if (lexerResult.errors.length || errors.length) {
          console.log('oops')
        }
        expect(lexerResult.errors.length).toBe(0)
        expect(errors.length).toBe(0)

        /** JavaScript tokens are skipped */
        // if (!([
        //   'less/_main/javascript.less',
        //   'less/no-js-errors/no-js-errors.less'
        // ].includes(file))) {
        //   const output = stringify(cst)
        //   expect(output).toBe(contents)
        // }
      })
      // }
    })
})

// Skipped until we fix these flows
describe.skip('should throw parsing errors', () => {
  const files = glob.sync(
    path.relative(process.cwd(), path.join(testData, 'errors/parse/**/*.less'))
  )
  files
    .sort()
    .map(value => path.relative(testData, value))
    .forEach(file => {
      it(`${file}`, () => {
        const result = fs.readFileSync(file)
        const { lexerResult, errors } = lessParser.parse(result.toString())
        expect(lexerResult.errors.length).toBe(0)
        expect(errors.length).toBe(1)
      })
    })
})