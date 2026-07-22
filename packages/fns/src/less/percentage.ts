/**
 * Less `percentage()` is the canonical AST-v2 value function.  Keep this
 * dialect-facing module as a compatibility-shaped export only; the function
 * body and metadata live in `builtins/percentage.ts` and are the same object
 * registered by the Less value evaluator.
 */
export { percentage } from '../builtins/percentage.js';
export { percentage as default } from '../builtins/percentage.js';
