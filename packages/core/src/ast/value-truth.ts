/**
 * `.jess` truthiness — ONE typed predicate over a materialized value.
 *
 * RESOLVED-SEMANTICS-AND-NAMING.md §4.4 (owner, 2026-08-01): a condition is
 * falsy for exactly four values —
 *
 *   false    null    ""  (and '')    ()  (empty list / map)
 *
 * — and everything else is truthy, INCLUDING `0`, `0px`, `0%`, `"0"`, `red`,
 * `transparent`, `rgba(0,0,0,0)` and an unrecognised `nope()`. The principle is
 * EMPTINESS, not zero-ness: `0` is a real CSS value (`margin: 0`), not an
 * absence, so `$if($margin)` with `$margin: 0` takes the TRUE branch.
 *
 * §4.4.1 specifies the rule as a desugaring, which is the DEFINITION —
 *
 *   $if($x)  ≡  $if(not(($x == false) or ($x == null) or ($x == "") or ($x == ())))
 *
 * — and core implements it as this single predicate rather than as a literal
 * four-comparison expansion, so there is one evaluation site, one error site,
 * and the guard keeps the operand the author actually wrote.
 *
 * This REPLACES the `guard.ts` byte test `emitValue(v).trim() === 'true'`, which
 * decided a semantic question by serializing the value and string-matching.
 *
 * The two dialect conditions do NOT come here: `.less` `when (@x)` and the Less
 * `if()`/`boolean()` family lower to `$x == true`, and `.scss` `@if $x` lowers
 * to `not(($x == false) or ($x == null))` (§4.4.2). Both lowerings are plain
 * `.jess`, which is what makes them lowerings.
 */

import { isValueGroupArray, type ValueGroup } from './value-eval.js';

/**
 * Whether a group is EMPTY — the `()` row, in each shape the value model can
 * spell it: an empty adjacency group, an empty explicit list, a map with no
 * entries, and `null` itself (which a bracketed empty list wraps).
 */
function isEmptyGroup(value: ValueGroup): boolean {
  if (isValueGroupArray(value)) {
    return value.length === 0;
  }
  switch (value.type) {
    case 'Null': return true;
    case 'List': return value.value.length === 0;
    case 'Collection': return value.entries.length === 0 && value.base === undefined;
    default: return false;
  }
}

/**
 * `.jess` truthiness (§4.4). Falsy iff `false`, `null`, `""` or `()`.
 *
 * A PAREN block is transparent — `(false)` is `false`, and grouping never
 * changes what a condition means. A SQUARE block is a bracketed LIST, so it is
 * falsy only when that list is empty: `[]` is falsy while `[false]` is a
 * one-item list and therefore truthy.
 */
export function isTruthy(value: ValueGroup): boolean {
  if (isValueGroupArray(value)) {
    return value.length === 1 ? isTruthy(value[0]!) : value.length !== 0;
  }
  switch (value.type) {
    case 'Bool': return value.value;
    case 'Null': return false;
    case 'Quoted': return value.value !== '';
    case 'List': return value.value.length !== 0;
    case 'Collection': return value.entries.length !== 0 || value.base !== undefined;
    case 'Block':
      return value.delimiter === 'paren' ? isTruthy(value.value) : !isEmptyGroup(value.value);
    default: return true;
  }
}
