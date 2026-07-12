export * from './lessTokens.js';

// The legacy Chevrotain parser (lessRecursiveParser / lessParser / productions) is
// no longer exported — the functional macro parser (LessParser / lessGrammar below)
// IS the parser now. Dropping these re-exports lets the bundler tree-shake ~130 KB
// of the old parser out of the shipped library. (The source files can be deleted
// as a follow-up.)

export { LessGrammar } from './builders.js';

import { LessParser } from './functional-parser.js';
export { LessParser };
export { lessGrammar } from './grammar.js';
export { parseLessFn, type LessFnParseResult } from './functional-parser.js';
export { parseLessCst, parseLessDoc } from './cst.js';
export type {
  LessCstChild, LessCstError, LessCstLeaf, LessCstNode, LessCstParseResult, LessCstType
} from './cst.js';
export const Parser = LessParser;
