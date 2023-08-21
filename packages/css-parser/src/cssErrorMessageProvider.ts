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
   */
  buildNoViableAltMessage(
    options: Parameters<IParserErrorMessageProvider['buildNoViableAltMessage']>[0]
  ) {
    const initialTokens: string[] = []
    options.expectedPathsPerAlt.forEach(expectedPath => {
      expectedPath.forEach(path => {
        if (!initialTokens.includes(path[0].name)) {
          initialTokens.push(path[0].name)
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
    err += `but found '${options.actual[0].image}'`
    return err
  }

  buildEarlyExitMessage(
    options: Parameters<IParserErrorMessageProvider['buildEarlyExitMessage']>[0]
  ) {
    return `Expected a ${camelToSpaces(options.ruleName)}, but found '${options.actual[0].image}'`
  }
}