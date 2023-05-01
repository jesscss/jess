import { CharStream, CommonTokenStream, type ParserRuleContext } from 'antlr4'
import CssLexer from './generated/CssLexer'
import CssParser from './generated/CssParser'
import { type ConditionalKeys } from 'type-fest'

type ParserMethods = ConditionalKeys<CssParser, () => ParserRuleContext>

export const parseTree = (input: string, startRule: ParserMethods = 'stylesheet') => {
  const chars = new CharStream(input)
  const lexer = new CssLexer(chars)
  const tokens = new CommonTokenStream(lexer)
  const parser = new CssParser(tokens)
  const tree = parser[startRule]()
  return { tree, parser }
}

export const parse = (input: string, startRule: ParserMethods = 'stylesheet') => {
  const { tree, parser } = parseTree(input, startRule)
  const output = tree.toStringTree(null, parser)
  return output
}