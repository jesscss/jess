import { type IParserErrorMessageProvider, defaultParserErrorProvider } from 'chevrotain'

const camelToSpaces = (str: string) => str.replace(/([A-Z])/g, ' $1').toLowerCase()

export const CssErrorMessageProvider: IParserErrorMessageProvider = {
  buildMismatchTokenMessage(options) {
    return defaultParserErrorProvider.buildMismatchTokenMessage(options)
  },
  buildNotAllInputParsedMessage(options) {
    return defaultParserErrorProvider.buildNotAllInputParsedMessage(options)
  },
  buildNoViableAltMessage(options) {
    return defaultParserErrorProvider.buildNoViableAltMessage(options)
  },
  buildEarlyExitMessage(options) {
    return `Expected a ${camelToSpaces(options.ruleName)}, but found '${options.actual[0].image}'`
  }
}