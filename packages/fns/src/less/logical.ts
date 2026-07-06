import { defineFunction, Node, Bool, Condition, createPublicBool } from '@jesscss/core';

/** Coerce an evaluated condition value (Bool / keyword true|false / …) to a boolean. */
const truthy = (node: Node): boolean => Condition.getBoolValue(node, false);

/**
 * `boolean(condition)` — evaluate a condition to a Bool. A comparison / `and` /
 * `or` / `not` guard expression already evaluates to a `Bool`; a bare keyword
 * `true`/`false` is mapped by the same rule guards use. Mirrors Less's
 * `boolean()` returning a Keyword true/false.
 */
export const boolean = defineFunction(
  'boolean',
  function(condition: Node): Bool {
    return createPublicBool(truthy(condition));
  },
  { params: [{ name: 'condition', type: Node }] }
);

/** `not(a)` — logical negation. */
export const not = defineFunction(
  'not',
  function(a: Node): Bool {
    return createPublicBool(!truthy(a));
  },
  { params: [{ name: 'a', type: Node }] }
);

/** `and(a, b, …)` — true when EVERY argument is truthy. */
export const and = defineFunction(
  'and',
  function(...args: Node[]): Bool {
    return createPublicBool(args.every(truthy));
  },
  { params: [{ name: 'args', type: Node, rest: true }] }
);

/** `or(a, b, …)` — true when ANY argument is truthy. */
export const or = defineFunction(
  'or',
  function(...args: Node[]): Bool {
    return createPublicBool(args.some(truthy));
  },
  { params: [{ name: 'args', type: Node, rest: true }] }
);
