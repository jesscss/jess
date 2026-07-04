export * from './scssTokens.js';
export * from './scssRecursiveParser.js';
export * from './scssParser.js';
export { value as scssValueProduction } from './productions/values.js';

export { ScssGrammar } from './builders.js';
export { scssGrammarRules } from './grammar-rules.js';

import { ScssParser, parseScssFn, scssRules, build, type ScssFnParseResult, type ScssFnParseOptions } from './grammar.js';
export { ScssParser, ScssParserParseman, parseScssFn, scssRules, build, type ScssFnParseResult, type ScssFnParseOptions };

// Chevrotain parser — kept for lexer/token tests and gradual migration.
export type { ScssRules, SyntacticContentAssistSuggestion } from './scssParser.js';
export { ScssParser as ScssParserChevrotain } from './scssParser.js';

export const Parser = ScssParser;
