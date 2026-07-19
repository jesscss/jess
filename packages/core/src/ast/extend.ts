/**
 * EXTEND engine — a self-contained selector IR and a PLAN / SOLVE / EMIT flow
 * over the parsed AST, split into focused modules under `./extend/`:
 *
 *   ir       — selector IR types + text / clone / from-AST / atom primitives.
 *   compose  — fold an ancestor path into flat branches (`&` substitution).
 *   match    — apply one instruction to a selector list (append / span-substitute).
 *   plan     — walk the AST into subjects + instructions + target atoms.
 *   solve    — the reach + fixpoint that extends a subject's composed branches.
 *   emit     — the FLAT / NESTED projections `computeExtends` hands the serializer.
 */

export { computeExtends } from './extend/emit.js';
export type { ExtendResults, NestedRulePlan } from './extend/emit.js';
