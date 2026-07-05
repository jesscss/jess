export * from './scssTokens.js';
export * from './scssRecursiveParser.js';
export * from './scssParser.js';
export { value as scssValueProduction } from './productions/values.js';

export { ScssGrammar } from './builders.js';
export { scssGrammar } from './grammar.js';

import { ScssParser } from './functional-parser.js';
export { ScssParser, ScssParserParseman, parseScssFn, type ScssFnParseResult, type ScssFnParseOptions } from './functional-parser.js';

// Chevrotain parser — kept for lexer/token tests and gradual migration.
export type { ScssRules, SyntacticContentAssistSuggestion } from './scssParser.js';
export { ScssParser as ScssParserChevrotain } from './scssParser.js';

export const Parser = ScssParser;
