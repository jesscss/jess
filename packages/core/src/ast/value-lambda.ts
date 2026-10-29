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

const bodyWrites = new WeakMap<readonly Statement[], Statement[]>();

/**
 * The statements a call of a value-lambda runs before it reads its `result:`:
 * the body without its top-level `result:` declarations. A `result:` is a
 * value, checked where the call writes it, never a declaration the body writes.
 * Computed once per body.
 */
export function lambdaBodyWrites(rules: readonly Statement[]): Statement[] {
  let writes = bodyWrites.get(rules);
  if (writes === undefined) {
    writes = rules.filter(statement => statement.type !== 'Declaration' || statement.name !== 'result');
    bodyWrites.set(rules, writes);
  }
  return writes;
}
