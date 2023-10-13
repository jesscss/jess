import {
  type IParserErrorMessageProvider,
  defaultParserErrorProvider
} from 'chevrotain'

const camelToSpaces = (str: string) => str.replace(/([A-Z])/g, ' $1').toLowerCase()

export class CssErrorMessageProvider implements IParserErrorMessageProvider {
  buildMismatchTokenMessage(
    options: Parameters<IParserErrorMessageProvider['buildMismatchTokenMessage']>[0]
  ) {
    return defaultParserErrorProvider.buildMismatchTokenMessage(options)
  }

  buildNotAllInputParsedMessage(
    options: Parameters<IParserErrorMessageProvider['buildNotAllInputParsedMessage']>[0]
  ) {
    return defaultParserErrorProvider.buildNotAllInputParsedMessage(options)
  }

  /**
   * This error message needs to be reduced, because the lookahead strategy
   * can generate thousands of possible paths.
   *
   * @todo - we may be able to eliminate this by addressing all ambiguity in the parser
   * from chevrotain-allstar
   */
  buildNoViableAltMessage(
    options: Parameters<IParserErrorMessageProvider['buildNoViableAltMessage']>[0]
  ) {
    const initialTokens: string[] = []
    options.expectedPathsPerAlt.forEach(expectedPath => {
      expectedPath.forEach(path => {
        let pathStr = path[0]?.name
        if (path && !initialTokens.includes(pathStr!)) {
          initialTokens.push(pathStr!)
        }
      })
    })
    const firstOfTokens = initialTokens.slice(0, 4)
    const rest = initialTokens.slice(5)
    // eslint-disable-next-line @typescript-eslint/quotes
    let err = `Error in ${camelToSpaces(options.ruleName)}: Expected '${firstOfTokens.join(`', '`)}' `
    if (rest.length > 0) {
      err += `(and ${rest.length} more) `
    }
    err += `but found '${options.actual[0]!.image}'`
    return err
  }

  buildEarlyExitMessage(
    options: Parameters<IParserErrorMessageProvider['buildEarlyExitMessage']>[0]
  ) {
    return `Expected a ${camelToSpaces(options.ruleName)}, but found '${options.actual[0]!.image}'`
  }
}