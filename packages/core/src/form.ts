/*
 * `defineForm`: a built-in defined by its CSS form (docs/design/CSS-NATIVE-BUILTINS.md
 * §3.3). A form evaluates on the core evaluator, so this subpath costs what that
 * costs, and `@jesscss/core/value` stays without it.
 */
export { defineForm, type FormCall } from './ast/css-form.js';
export { asNumber, formNumber, isDimension, knownUnit } from './ast/css-math.js';
