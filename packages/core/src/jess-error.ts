import chalk from 'chalk'
import { type IRecognitionException, type ILexingError } from 'chevrotain'

export const getErrorFromParser = (
  error: IRecognitionException | ILexingError,
  filePath: string,
  source: string
) => {
  let message = error.message
  let line = 'token' in error ? error.token.startLine! : error.line!
  let column = 'token' in error ? error.token.startColumn! : error.column!
  let type = 'token' in error ? 'LexingError' : 'SyntaxError'
  return new JessError(
    message,
    filePath,
    line,
    column,
    source,
    type
  )
}

export class JessError extends Error {
  constructor(
    message: string,
    public filePath: string,
    public line: number,
    public column: number,
    public source: string,
    public type: string = 'SyntaxError'
  ) {
    super(message)
  }

  toString() {
    let { line, column, source, filePath } = this
    const lines = source.split('\n')

    /** Lines are 1-based, arrays are 0-based */
    let extract = [
      lines[line - 2],
      lines[line - 1],
      lines[line]
    ]

    let message = chalk.red(`${this.type}: ${this.message}`)
    if (filePath) {
      message += chalk.red(' in ')
    }
    if (line) {
      message += chalk.grey(` on line ${line}, column ${column}:\n`)
    }
    let numDisplay: string

    if (typeof extract[0] === 'string') {
      numDisplay = String(line - 1).padStart(3, ' ')
      message += chalk.grey(`${numDisplay}| ${extract[0]}\n`)
    }

    numDisplay = String(line).padStart(3, ' ')
    message += chalk.bold(`${numDisplay}| ${extract[1]}\n`)
    message += chalk.grey('   |', chalk.red('^'.padStart(column, ' ')), '\n')

    if (typeof extract[2] === 'string') {
      numDisplay = String(line + 1).padStart(3, ' ')
      message += chalk.grey(`${numDisplay}| ${extract[2]}\n`)
    }
    return message
  }
}