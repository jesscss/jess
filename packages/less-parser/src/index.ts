export * from './lessTokens.js';
export * from './lessRecursiveParser.js';
// Explicit exports from lessParser.ts — LessParser (Chevrotain) re-exported as
// LessParserChevrotain so the functional LessParser can own the LessParser name.
export type { LessRules, SyntacticContentAssistSuggestion } from './lessParser.js';
export { LessParser as LessParserChevrotain } from './lessParser.js';

export { LessGrammar } from './builders.js';

import { LessParser } from './functional-parser.js';
export { LessParser };
export { lessGrammar } from './grammar.js';
export { parseLessFn, type LessFnParseResult } from './functional-parser.js';

export const Parser = LessParser;
