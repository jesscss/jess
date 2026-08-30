/**
 * Lean number rounding, inlined from lodash `round`.
 *
 * The implementation is `ast/round.ts` and is re-exported here — the two files used
 * to be byte-identical copies, kept apart so the value domain never imported
 * `../tree`. De-duplicated in that direction: legacy-tree -> ast, so deleting
 * `tree/` leaves the value domain intact.
 */
export { round } from '../../ast/round.js';
export { round as default } from '../../ast/round.js';
