import type { Statement, ValueSlot } from './nodes.js';

/** The value yielded by a called value-lambda: the LAST top-level `result:`
 *  declaration in its body (the lowered form of an SCSS `@return`). A function
 *  has no early return — it is "a mixin whose final assignment to a property
 *  named `result` is its value" — so a later `result:` overrides an earlier one,
 *  exactly as a repeated declaration does everywhere else. A `result:` nested
 *  inside a `$if`/`@if`/`$for` branch is not surfaced here; only a top-level one
 *  yields. */
export function lambdaResultValue(rules: readonly Statement[]): ValueSlot | undefined {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const statement = rules[index]!;
    if (statement.type === 'Declaration' && statement.name === 'result') {
      return statement.value;
    }
  }
  return undefined;
}
