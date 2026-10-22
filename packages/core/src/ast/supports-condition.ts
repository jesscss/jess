/**
 * An `@supports` prelude whose condition holds an identifier where a
 * `<supports-in-parens>` belongs — `selector (a)`, which is the identifier
 * `selector` and a `(a)` group (never the `selector(` function token,
 * css-syntax-3 §4.3.4), or a bare `color` — is well-formed, so every dialect
 * parses it (ledger P45), and the compile fails with
 * `css/invalid-supports-condition` at the at-rule (owner 2026-10-22: *"It's not
 * the CSS function, and you said that CSS wouldn't recognize it with a
 * space"*). The check reads the parsed prelude, at the top of the condition:
 * an identifier where an operand belongs, or out of a connective's place.
 */
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import type { AtRuleBlock } from './at-rule.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { ValueNode, ValueSlot } from './nodes.js';

const CONNECTIVES = new Set(['and', 'or']);

/** The identifier a term is, when it is a bare one. */
function keywordOf(term: ValueSlot | undefined): string | undefined {
  return term !== undefined && !isValueSlotArray(term) && term.type === 'Keyword' ? term.src : undefined;
}

/** The identifier an operand is, or opens with (`selector (a)` is `selector` and a group). */
function operandIdentifier(term: ValueSlot): string | undefined {
  return keywordOf(!isValueSlotArray(term) && term.type === 'Sequence' ? term.parts[0] : term);
}

/**
 * The first identifier out of place in a condition, which is `not` and one
 * operand, or operands joined by `and` / `or` (css-conditional-3 §6). An
 * operand is a parenthesized group or a function: an identifier there, a
 * connective included (`@supports or`, `and (a: b)`, `(a: b) or not (c: d)`,
 * `not (a: b) and (c: d)`), is none, and so is a connective with no operand
 * after it. A condition has no comma list: its `,` is reported.
 */
function strayIdentifier(condition: ValueSlot): string | undefined {
  if (!isValueSlotArray(condition) && condition.type === 'List') {
    return ',';
  }
  const terms = !isValueSlotArray(condition) && condition.type === 'Sequence' ? condition.parts : [condition];
  const first = terms.length === 2 && keywordOf(terms[0])?.toLowerCase() === 'not' ? 1 : 0;
  for (let index = first; index < terms.length; index++) {
    const term = terms[index]!;
    const name = (index - first) % 2 === 0 ? operandIdentifier(term) : keywordOf(term);
    if (name !== undefined && ((index - first) % 2 === 0 || !CONNECTIVES.has(name.toLowerCase()))) {
      return name;
    }
  }
  return (terms.length - first) % 2 === 0 ? keywordOf(terms[terms.length - 1]) : undefined;
}

/** An `@supports` block's prelude, after failing the compile when it is no condition. */
export function checkedSupportsPrelude(node: AtRuleBlock, prelude: ValueNode, s: { readonly context: Context | undefined }): ValueNode {
  const what = strayIdentifier(prelude);
  if (what !== undefined) {
    throw ERR.invalidSupportsCondition({ node, ...callSiteLocation(node, s), meta: { what } });
  }
  return prelude;
}

/**
 * Whether the parse is inside a supports condition's parentheses, where an
 * identifier is `<general-enclosed>` content (`(a and b)`), never the stray
 * operand the top of a condition reads it as.
 */
export function isInSupportsGroup(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'supportsGroup' in state && state.supportsGroup === true;
}

/** The parse state inside a supports condition's parentheses. */
export function enterSupportsGroup(state: unknown): object {
  return typeof state === 'object' && state !== null ? { ...state, supportsGroup: true } : { supportsGroup: true };
}
