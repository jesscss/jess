/**
 * Selector interpolation family: structured `@{…}` in a
 * selector position (`.@{n}`, `#@{id}`, `@{parent}`, `foo-@{x}-bar`, `&.@{mod}`).
 *
 * P0 — the grammar already SPLITS an interpolated selector into index-aligned
 * leaves (`.a-@{n}` → `.`, `a-`, `@{n}`), so this family CONSUMES those leaf
 * children (via the shared `interpFromLeaves`) to build the `Interp`; it never
 * re-scans the source for `@{…}` boundaries. The serializer then RESOLVES the
 * variable at ruleset-enter (`.@{n}` with `@n: a` → `.a`), exactly as the bridge does.
 *
 * The interp-bearing part is wrapped in a single-simple `Compound`, which every
 * consuming position accepts unchanged: F3's `buildCompound` splices a built
 * `Compound` child's simples directly (see `selector.ts`), and `ruleset.ts`'s
 * `ruleSelector` / the complex-segment helpers already accept `Compound`.
 *
 * TOTAL, like every action: a doomed/backtracked shape never throws — leaves with
 * no `@{…}` fall back to a plain concatenated `Simple`.
 */
import * as t2 from '../../index.js';
import { type BuildAction, type BuildArgs } from '../host-context.js';
import { interpFromLeaves, isLeaf } from './interp.js';

/**
 * `InterpolatedSelector`: a whole simple selector that is interpolation. Built from
 * its split leaf children and wrapped in a single-simple `Compound` so every
 * consuming position (ruleset head, complex segment, list member) accepts it.
 */
function buildInterpolatedSelector(args: BuildArgs): t2.Compound {
  const leaves = args.children.filter(isLeaf);
  const interp = interpFromLeaves(leaves, false);
  const simple = interp !== null ? t2.simpleInterp(interp) : t2.simple(leaves.map((l) => l.value).join(''));
  return new t2.Compound([simple]);
}

export const SELECTOR_INTERP_ACTIONS: readonly BuildAction[] = [
  { type: 'InterpolatedSelector', build: buildInterpolatedSelector },
];
