/*
 * The guard condition node and its one constructor, with no runtime import, so the
 * parsers that build guards through `@jesscss/core/ast` do not load the guard
 * evaluator (`guard.ts`) and its value domain.
 */
import type { FunctionCall, ValueSlot } from './nodes.js';

/**
 * A guard condition tree, evaluated to a boolean; one that nothing consumes is
 * written as the author wrote it (ledger J20).
 *
 * `cmp` and `match` are the SAME comparison in the two positions §4.2a
 * distinguishes, and carry the identical shape so they are one hidden class:
 *
 *  - `cmp` — VALUE position (`if(@a < @b, …)`, `$( … )`, `@if`). An ASSERTION:
 *    operands with no common ground raise, because "is a less than b" has no
 *    honest answer and `false` in both directions is a lie (§4.2).
 *  - `match` — GUARD position (`when ( … )`). A MATCH TEST: no common ground
 *    means this definition does not apply to these arguments, which IS an
 *    answer. `.m(1, true) when (@a < @b)` must not fail the compile.
 *
 * Which one a comparison is, is decided by the front end at PARSE time from the
 * position it was written in (§12.0 — lower to the `.jess` you want, then read
 * off the node). Nothing at eval time inspects context or a mode to choose.
 *
 * The facts the parser records so a written condition is written as authored
 * (ledger J20). Evaluation reads only `parens`, and every instance of a kind
 * carries them, so each kind keeps one hidden class:
 *
 *  - `parens` — how many paren groups the author wrote around exactly this
 *    condition: `((1 = 1) or 2)` gives the `or` none and its `cmp` one. They are
 *    paren groups for the math in the condition, except the outermost pair
 *    of each condition of a `when` guard (ledger V35).
 *  - `implied` — the comparison is a dialect's lowering of a bare operand
 *    (Less's `== true`, §4.4.2), not one the author wrote.
 *  - `word` — the `and` / `or` / `not` keyword as the author spelled it
 *    (`AND`; a keyword is ASCII case-insensitive, CSS Values 4 §6.1), or the
 *    keyword itself where a dialect lowers another spelling to it (Sass `!=`).
 *  - `gluedAt` — where that keyword starts when the author glued it to the
 *    group after it (`or(2)`, which CSS reads as one function token, CSS
 *    Syntax 3 §4.3.4), else `-1`: written so, it is written without a gap and
 *    warned about there (ledger N17).
 */
/*
 * `css` is a CSS `if()` test (css-values-5 §8.3: `supports()`, `media()`,
 * `style()`, or any other condition the browser answers when it computes the
 * value). Nothing decides it at compile time: an `IfValue` holding one keeps
 * the branches it cannot decide and writes them as a CSS `if()` (ledger P38).
 * It carries `truth`'s fields, so the two are one hidden class.
 */
export type GuardNode =
  | { readonly g: 'cmp'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot; readonly implied: boolean; readonly parens: number }
  | { readonly g: 'match'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot; readonly implied: boolean; readonly parens: number }
  | { readonly g: 'and'; readonly left: GuardNode; readonly right: GuardNode; readonly word: string; readonly gluedAt: number; readonly parens: number }
  | { readonly g: 'or'; readonly left: GuardNode; readonly right: GuardNode; readonly word: string; readonly gluedAt: number; readonly parens: number }
  | { readonly g: 'not'; readonly inner: GuardNode; readonly word: string; readonly gluedAt: number; readonly parens: number }
  | { readonly g: 'truth'; readonly value: ValueSlot; readonly parens: number }
  | { readonly g: 'css'; readonly value: ValueSlot; readonly parens: number }
  | { readonly g: 'call'; readonly name: string; readonly args: ValueSlot[]; readonly parens: number }
  | { readonly g: 'default'; readonly parens: number };

/** `guard` inside one more paren group the author wrote around it (same shape, so the same hidden class). */
export const inParens = (guard: GuardNode): GuardNode => ({ ...guard, parens: guard.parens + 1 });

/** Whether a guard tree is CSS `if()` tests alone, joined by `and`, `or` and `not`: nothing in it is decided at compile time. */
export function onlyCssTests(node: GuardNode): boolean {
  switch (node.g) {
    case 'css':
      return true;
    case 'and':
    case 'or':
      return onlyCssTests(node.left) && onlyCssTests(node.right);
    case 'not':
      return onlyCssTests(node.inner);
    default:
      return false;
  }
}

/**
 * A CSS `if()` test call (css-values-5 §8.3 `<if-test>`): `media()`,
 * `supports()` or `style()`, any case. The browser answers it, so it is never
 * a call to a function of that name (Dart Sass reads it so).
 */
export function isIfTestCall(value: ValueSlot): value is FunctionCall {
  if (!('type' in value) || value.type !== 'FunctionCall') {
    return false;
  }
  const name = value.name.toLowerCase();
  return name === 'media' || name === 'supports' || name === 'style';
}

/** Whether a guard tree holds a CSS `if()` test, which leaves it undecided at compile time. */
export function hasCssTest(node: GuardNode): boolean {
  switch (node.g) {
    case 'css':
      return true;
    case 'and':
    case 'or':
      return hasCssTest(node.left) || hasCssTest(node.right);
    case 'not':
      return hasCssTest(node.inner);
    default:
      return false;
  }
}
