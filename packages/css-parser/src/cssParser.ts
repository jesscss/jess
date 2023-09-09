import {
  CssCstParser,
  type CssRules,
  type IParseResult
} from './cssCstParser'
import { type Node } from '@jesscss/core'

export type CssParseResult = Omit<IParseResult, 'cst' | 'lexerResult'> & {
  tree: Node
}

/**
 * This parser applies a CST visitor to the returned CST,
 * and transforms it to a Jess AST.
 */
export class CssParser extends CssCstParser {
  parse(text: string, rule: CssRules = 'stylesheet'): CssParseResult {
    const { cst, errors } = super.parse(text, rule)

    return { tree, errors }
  }
}