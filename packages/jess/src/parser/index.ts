import { IFileInfo, Node } from '../tree'
import { Parser as CstParser } from '@jesscss/parser'
import { CstVisitor } from './cst-visitor'

const cstParser = new CstParser()

/**
 * This is an abstraction between the Jess CST parser
 * and the Jess AST. Essentially, this forwards parsing to
 * the @jesscss/parser package, and, if successful, builds an
 * AST out of the returned CST.
 */
export const parse = async (input: string, fileInfo: IFileInfo = {}) => {
  const { cst, lexerResult, parser } = cstParser.parse(input)
  if (lexerResult.errors.length > 0) {
    throw {
      fileInfo,
      errors: lexerResult.errors
    }
  }
  if (parser.errors.length > 0) {
    throw {
      fileInfo,
      errors: parser.errors
    }
  }

  try {
    const node: Node = new CstVisitor(parser).visit(cst)
    return node
  } catch (e) {
    throw {
      fileInfo,
      errors: [e]
    }
  }
}
