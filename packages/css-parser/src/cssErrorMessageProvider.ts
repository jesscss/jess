import { type IParserErrorMessageProvider, defaultParserErrorProvider } from 'chevrotain'

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

  buildNoViableAltMessage(
    options: Parameters<IParserErrorMessageProvider['buildNoViableAltMessage']>[0]
  ) {
    return defaultParserErrorProvider.buildNoViableAltMessage(options)
  }

  buildEarlyExitMessage(
    options: Parameters<IParserErrorMessageProvider['buildEarlyExitMessage']>[0]
  ) {
    return `Expected a ${camelToSpaces(options.ruleName)}, but found '${options.actual[0].image}'`
  }
}