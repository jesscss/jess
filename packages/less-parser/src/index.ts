export * from './lessTokens.js';
export * from './lessRecursiveParser.js';
// Explicit exports from lessParser.ts — LessParser (Chevrotain) re-exported as
// LessParserChevrotain so the functional LessParser can own the LessParser name.
export type { LessRules, SyntacticContentAssistSuggestion } from './lessParser.js';
export { LessParser as LessParserChevrotain } from './lessParser.js';

export { LessGrammar } from './builders.js';

import { LessParser } from './grammar.js';
export { LessParser };
export { parseLessFn, type LessFnParseResult } from './grammar.js';
export { lessGrammarRules, type LessGrammarDeps } from './grammar-rules.js';

export const Parser = LessParser;
