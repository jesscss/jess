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
import { type BuildAction, type BuildArgs, placeholder, type Placeholder } from '../host-context.js';
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
  return t2.compoundOf([simple]);
}

/**
 * TODO(tier-b/A4): WHAT — the `interpFromString` `@{…}` tokenizer below re-derives
 * the interpolation split for a PSEUDO (`:@{theme}`, `:nth-child(@{num})`) and
 * ATTRIBUTE (`[@{prop}]`, `[prop*="val@{num}"]`, `[href*="@{pattern}" I]`) simple
 * selector. WHY — the grammar delivers these as ONE opaque `PseudoSelector` /
 * `AttributeSelector` node whose interpolation lives inside a single `interpKey` /
 * `singleStr` / `doubleStr` regex leaf (NOT split into `@{…}` leaves), so — exactly
 * like the custom-prop / regular-decl NAME positions in `custom-props.ts` — the
 * only structure available here is the node's verbatim bytes. RETIREMENT TRIGGER —
 * split the pseudo name / attribute name+value grammar into `@{…}` leaves and
 * consume via `interpFromRegion` when the legacy BuilderHost is retired (reorg
 * Phase A4); this mirrors the SAME accepted interim shape those name positions use.
 */
function interpFromString(text: string): t2.Interp | null {
  const re = /@\{\s*([^}]+?)\s*\}/g;
  const parts: t2.InterpPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let sawRef = false;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
    parts.push({ ref: t2.varRef(m[1]!), unquote: false });
    sawRef = true;
    last = m.index + m[0].length;
  }
  if (!sawRef) return null;
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/**
 * `PseudoSelector` / `AttributeSelector`: a whole simple selector the grammar
 * delivers as one node. When its bytes carry a top-level `@{…}` interpolation, build
 * a `simpleInterp` `Compound` so the serializer resolves it at ruleset-enter
 * (`:@{theme}` → `:blood`, `[@{p}]` → `[p]`, `[x="v@{n}"]` → `[x="v3"]`); every other
 * pseudo/attribute (`:hover`, `[type="x"]`) has no interpolation and stays on the
 * verbatim-bytes path (returns a placeholder so `buildCompound` slices its span
 * unchanged — byte-identical). Returning a single-simple `Compound` for the interp
 * case matches what `buildCompound` / `segmentToCompound` splice for a built child.
 */
function buildSimpleSelectorInterp(args: BuildArgs): t2.Compound | Placeholder {
  const bytes = args.ctx.src.slice(args.span.start, args.span.end);
  if (!bytes.includes('@{')) return placeholder(args.type);
  const interp = interpFromString(bytes);
  if (interp === null) return placeholder(args.type);
  return t2.compoundOf([t2.simpleInterp(interp)]);
}

export const SELECTOR_INTERP_ACTIONS: readonly BuildAction[] = [
  { type: 'InterpolatedSelector', build: buildInterpolatedSelector },
  { type: 'PseudoSelector', build: buildSimpleSelectorInterp },
  { type: 'AttributeSelector', build: buildSimpleSelectorInterp },
];
