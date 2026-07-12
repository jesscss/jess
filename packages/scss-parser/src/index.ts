export * from './scssTokens.js';
export * from './scssRecursiveParser.js';
export * from './scssParser.js';
export { value as scssValueProduction } from './productions/values.js';

// Parséman-based SCSS grammar — migration in progress. NOT yet the default
// Parser: the scss test suite still targets the Chevrotain node model (parent
// pointers, BasicSelector nodes, lexerResult), so switching the default requires
// adapting those tests to the strings-not-nodes model first (as done for css/less).
export { ScssGrammar } from './parseman/index.js';

import { ScssParser } from './scssParser.js';
export { ScssParser as Parser };
