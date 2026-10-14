/*
 * The guard condition node and its one constructor, with no runtime import, so the
 * parsers that build guards through `@jesscss/core/ast` do not load the guard
 * evaluator (`guard.ts`) and its value domain.
 */
import type { ValueSlot } from './nodes.js';

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
 * (ledger J20). Evaluation never reads them, and every instance of a kind
 * carries them, so each kind keeps one hidden class:
 *
 *  - `parens` — how many paren groups the author wrote around exactly this
 *    condition: `((1 = 1) or 2)` gives the `or` none and its `cmp` one.
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
export type GuardNode =
  | { readonly g: 'cmp'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot; readonly implied: boolean; readonly parens: number }
  | { readonly g: 'match'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot; readonly implied: boolean; readonly parens: number }
  | { readonly g: 'and'; readonly left: GuardNode; readonly right: GuardNode; readonly word: string; readonly gluedAt: number; readonly parens: number }
  | { readonly g: 'or'; readonly left: GuardNode; readonly right: GuardNode; readonly word: string; readonly gluedAt: number; readonly parens: number }
  | { readonly g: 'not'; readonly inner: GuardNode; readonly word: string; readonly gluedAt: number; readonly parens: number }
  | { readonly g: 'truth'; readonly value: ValueSlot; readonly parens: number }
  | { readonly g: 'call'; readonly name: string; readonly args: ValueSlot[]; readonly parens: number }
  | { readonly g: 'default'; readonly parens: number };

/** `guard` inside one more paren group the author wrote around it (same shape, so the same hidden class). */
export const inParens = (guard: GuardNode): GuardNode => ({ ...guard, parens: guard.parens + 1 });
