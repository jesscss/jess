import { Context } from '../context'
import { IFileInfo, Node } from '../tree'
import { Parser as CstParser } from '@jesscss/parser'
import { ICstVisitor } from 'chevrotain'
import CstVisitor from './cst-visitor'

/**
 * This is an abstraction between the Jess CST parser
 * and the Jess AST. Essentially, this forwards parsing to
 * the @jesscss/parser package, and, if successful, builds an
 * AST out of the returned CST.
 */
export class AstParser {
  context: Context
  fileInfo: IFileInfo
  static cstParser: CstParser
  static cstVisitor: ICstVisitor<any, any>

  /** Are these constructor vars necessary? */
  constructor(context?: Context, fileInfo?: IFileInfo) {
    this.fileInfo = fileInfo

    if (!AstParser.cstParser) {
      const parser = new CstParser()
      AstParser.cstParser = parser
    }
  }

  async parse(input: string) {
    const { cst, lexerResult, parser } = AstParser.cstParser.parse(input)
    if (lexerResult.errors.length > 0) {
      throw {
        fileInfo: this.fileInfo,
        errors: lexerResult.errors
      }
    }
    if (parser.errors.length > 0) {
      throw {
        fileInfo: this.fileInfo,
        errors: parser.errors
      }
    }

    try {
      const node = CstVisitor.visit(cst)
      return node
    } catch (e) {
      throw {
        fileInfo: this.fileInfo,
        errors: [e]
      }
    }
  }
}
