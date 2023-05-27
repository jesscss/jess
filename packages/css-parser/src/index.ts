import {
  CharStream,
  CommonTokenStream,
  type ParserRuleContext,
  ErrorListener,
  type Recognizer,
  type RecognitionException,
  DefaultErrorStrategy
} from 'antlr4'
import CssLexer from './generated/CssLexer'
import CssParser from './generated/CssParser'
import CssParserListener from './generated/CssParserListener'
import { type ConditionalKeys } from 'type-fest'

type ParserMethods = ConditionalKeys<CssParser, () => ParserRuleContext>

class SyntaxError<T> extends Error {
  line!: number
  column!: number
  symbol!: T
}
class CssParserErrorListener<T> extends ErrorListener<T> {
  errors: Error[] = []
  syntaxError(recognizer: Recognizer<T>, offendingSymbol: T, line: number, column: number, msg: string, e: RecognitionException | undefined) {
    const error = new SyntaxError<T>(msg)
    error.line = line
    error.column = column
    error.symbol = offendingSymbol
    this.errors.push(error)
    console.log(`${line}:${column} - ${msg}`, offendingSymbol)
  }

  reset() {
    this.errors = []
  }
}

class CssParserErrorStrategy extends DefaultErrorStrategy {

}

const errorStrategy = new CssParserErrorStrategy()
const errorListener = new CssParserErrorListener()

/**
 * Creates better warnings and errors for the parser
 */
class CssParserNormalizeListener extends CssParserListener {
  enterInnerQualifiedRule = (ctx: ParserRuleContext): void => {
    console.log(ctx)
  }
}

const parseListeners = [new CssParserNormalizeListener()]

/**
 * This exposes the parser, so that anyone downstream can
 * alter error listeners or parse strategies before
 * processing.
 */
export const getParser = (input: string) => {
  const chars = new CharStream(input)
  const lexer = new CssLexer(chars)
  const tokens = new CommonTokenStream(lexer)
  const parser = new CssParser(tokens)
  parser._errHandler = errorStrategy
  errorListener.reset()
  parser.removeErrorListeners()
  parser.addErrorListener(errorListener)
  parser._parseListeners = parseListeners
  return parser
}

export const parseTree = (input: string, startRule: ParserMethods = 'stylesheet') => {
  const parser = getParser(input)
  const tree = parser[startRule]()
  return { tree, parser, errors: errorListener.errors }
}

export const parse = (input: string, startRule: ParserMethods = 'stylesheet') => {
  const { tree, parser, errors } = parseTree(input, startRule)
  const output = tree.toStringTree(null, parser)
  return { tree, parser, errors, output }
}