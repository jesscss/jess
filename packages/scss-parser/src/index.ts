export * from './scssTokens.js';
export { value as scssValueProduction } from './productions/values.js';

// The legacy Chevrotain parser (scssRecursiveParser / scssParser /
// ScssParserChevrotain) is no longer exported — the functional macro parser
// (ScssParser / scssGrammar) IS the parser now. Dropping the re-exports lets the
// bundler tree-shake the old parser out. (Source can be deleted as a follow-up.)

export { ScssGrammar } from './builders.js';
export { scssGrammar } from './grammar.js';

import { ScssParser } from './functional-parser.js';
export { ScssParser, parseScssFn, type ScssFnParseResult, type ScssFnParseOptions } from './functional-parser.js';

export const Parser = ScssParser;
export { parseScssCst, parseScssDoc } from './cst.js';
export type {
  ScssCstChild, ScssCstError, ScssCstLeaf, ScssCstNode, ScssCstParseResult, ScssCstType
} from './cst.js';
