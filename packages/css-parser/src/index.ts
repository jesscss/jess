import {
  CharStream,
  CommonTokenStream,
  type ParserRuleContext,
  ErrorListener,
  type Recognizer,
  type RecognitionException
} from 'antlr4'
import CssLexer from './generated/CssLexer'
import CssParser from './generated/CssParser'
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
    const error = new SyntaxError(msg)
    error.line = line
    error.column = column
    error.symbol = offendingSymbol
    this.errors.push(error)
    console.log(`${line}:${column} - ${msg}`, offendingSymbol)
  }
}

export const parseTree = (input: string, startRule: ParserMethods = 'stylesheet') => {
  const chars = new CharStream(input)
  const lexer = new CssLexer(chars)
  const tokens = new CommonTokenStream(lexer)
  const parser = new CssParser(tokens)
  const errorListener = new CssParserErrorListener()
  parser.removeErrorListeners()
  parser.addErrorListener(errorListener)
  const tree = parser[startRule]()
  return { tree, parser, errors: errorListener.errors }
}

export const parse = (input: string, startRule: ParserMethods = 'stylesheet') => {
  const { tree, parser, errors } = parseTree(input, startRule)
  const output = tree.toStringTree(null, parser)
  return { tree, parser, errors, output }
}