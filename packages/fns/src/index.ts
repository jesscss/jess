// Public JavaScript-callable module surface used by documented `@-from
// '@jesscss/fns' import (...)` consumers. These exports remain callable functions;
// they are not the compiler's built-in registration mechanism.
export * from './less/index.js';

// The direct AST engine registers this typed value-domain set through
// `makeBuiltinRegistry()`. It never enumerates the callable module barrel above.
// Keeping the two explicit avoids treating a JavaScript module export as a second
// evaluator path or a dialect-specific fallback.
export { builtinLessFns } from './builtins/index.js';

// The built-in fn set packaged as a ready-to-use dispatch registry (the single
// production assembly point; the ast/ render path builds its value evaluator from
// this). See `builtins/registry.ts`.
export { makeBuiltinRegistry } from './builtins/registry.js';

// export * from './math'
