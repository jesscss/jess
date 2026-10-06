/**
 * Build entry for the css compose base.
 *
 * A dialect grammar composes onto `cssBaseRules` and needs nothing else from
 * css. It gets its own entry so a dialect's import graph reaches the compose
 * pieces without css's own compiled parse grammar, which lives in `./ast.ts`
 * and is most of that module's size.
 */
export { cssBaseRules } from '../grammar.js';
