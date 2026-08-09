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
 * `.less` does NOT come here: `when (@x)` and the Less `if()`/`boolean()` family
 * lower to `$x == true` (§4.4.2), a plain-`.jess` comparison, which is what makes
 * it a lowering.
 *
 * `.scss` DOES come here. §4.4.6 (owner, 2026-08-07) retired its old
 * `not(($x == false) or ($x == null))` lowering: Sass+ takes the emptiness rule,
 * so `@if $x` collapses to the bare truth node and `""` / `()` become falsy.
 * What forced it was internal contradiction, not the reference — lowering
 * `or`/`and` to jess's native operators while lowering `@if` to Sass's condition
 * made `.scss` disagree with ITSELF (`@if ""` took the true branch while
 * `"" or 2` answered `2`). The shift is public and audited: four libraries,
 * ~333 `.scss` files, ZERO sites bare-testing a `""` / `()` variable.
 *
 * The `()` row means different SPELLINGS per dialect, and that is §12.6, not a
 * divergence: `.scss` spells the empty list `()`, while in `.jess` a paren is a
 * literal paren and never a list, so the empty list/map is the empty Collection
 * `{}` and a bare `()` is a parse error in value position.
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
 * falsy only when that list is EMPTY, `[false]` being a one-item list and
 * therefore truthy.
 *
 * KNOWN GAP, measured not inferred: `[]` comes back TRUTHY today. The four
 * grammars reduce an empty delimited block to a block wrapping a contentless
 * `Any` (`children.find(isValueSlotValue) ?? any('')`) rather than to an empty
 * group, so `isEmptyGroup` sees an `Any` and falls to its `default`. The defect
 * is UPSTREAM — a parser minting a content node where the source has no content
 * — and the fix belongs in the grammars, not in a byte test for an empty `src`
 * here. It is not a §4.4 row: §12.6 spells the empty list/map `{}` in `.jess`,
 * and that spelling IS falsy.
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
