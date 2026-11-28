/**
 * Sass meta module (`sass:meta`).
 *
 * Members carry their module name (`type-of`, `calc-name`). The functions here
 * read only their arguments; the members that read the evaluator's scope
 * (`variable-exists`, `get-function`, `call`, …) and `keywords`, which reads an
 * argument list, are not implemented yet.
 */
export { featureExists } from './feature-exists.js';
export { inspect } from './inspect.js';
export { typeOf } from './type-of.js';
export { calcName, calcArgs } from './calc.js';
