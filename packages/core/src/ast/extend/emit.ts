/**
 * EMIT — turns the SOLVE result into per-rule projections the serializer renders.
 *
 * FLAT mode: each subject's EXTENDED, fully-composed header branch list, with
 * sibling `:is()`-compaction applied; the serializer emits it as the rule's header
 * and composes children against the parent exactly as authored nesting.
 *
 * NESTED mode does NOT re-derive extend semantics — it RE-NESTS the correct FLAT
 * result. A rule STAYS NESTED and its extend just rewrites the local selector in
 * place, EXCEPT when an extend match CROSSES the `&` (the join between the parent
 * context and the child-appended compound), which the nested structure cannot
 * express locally — then the rule (and its descendants) FLATTEN to a top-level
 * block. Owner rule, validated against the alpha `.css` oracle:
 *
 *  - trigger B: a NESTED rule that itself carries `:extend()` — its extender
 *    contribution incorporates the parent context, so it crosses → FLATTEN.
 *  - trigger P: a NESTED rule whose PARENT is aliased by an `all`-extender whose
 *    target does NOT also match the child's own local compound (a foreign
 *    parent-context alias, e.g. `.sidebar2:extend(.sidebar all)` reaching
 *    `.sidebar .box`) → the child's parent context changed under it → FLATTEN.
 *    A uniform alias that also rewrites the child's own compound (e.g.
 *    `.ff:extend(.bb all)` on `.bb { .bb {} }`) does NOT cross → stays nested.
 *  - trigger X: a NESTED rule whose whole composed complex is matched EXACTLY by
 *    an extender that does not descend from its parent (a hoisted whole-complex
 *    sibling, e.g. `.rep_ace:extend(.replace.replace .replace)`) → FLATTEN.
 *  - trigger A: a rule, top-level included, whose at-rule block holds an extend
 *    in its own scope that reaches the rule's declarations in that block — only
 *    the flat writer's bubbled block can carry it → FLATTEN (collapse).
 *
 * An EXACT extender that folds into a target which HAS surviving nested children
 * cannot carry those children (exact never propagates into sub-parts); it SPLITS
 * to a separate sibling rule with the target's DIRECT declarations only (empty →
 * dropped), rising to the top level when its header is a top-level selector.
 * `all`-extenders fold into the header and DO propagate to children.
 */

import {
  branchOut,
  branchText,
  cloneBranch,
  cloneSeg,
  cloneSimple,
  compoundText,
  descendantBranch,
  isSimple,
  mkBranch,
  multisetSubset,
  simpleText,
  textSimple,
  textSimpleTokens
} from './ir.js';
import type { Branch, Compound, Level, SelectorPart, Simple } from './ir.js';
import type { Combinator } from '../node.js';
import { branchHasAmp, composePath } from './compose.js';
import { mergeCompound, NO_SIMPLES } from './conflict.js';
import { extendBranchSpecificity, irPseudoElementCarriesSuffix, nestingGroupKey, partitionGroups } from '../is-grouping.js';
import { branchWholeMatches, matchBoundarySpan } from './match.js';
import { boundaryReaches, collectPlan, documentHasExtend, reaches, recordAstExtendProfile } from './plan.js';
import type { PlanInstruction, PlanOverlay, PlanSubject } from './plan.js';
import { buildContribs, runFixpoint, solveComposed } from './solve.js';
import type { ContribMap } from './solve.js';
import type { Stylesheet, Ruleset, Statement } from '../nodes.js';
import { branchTextIsPlaceholder } from '../nodes.js';
import type { AtRuleBlock } from '../at-rule.js';

export interface NestedRulePlan {
  /** Emit this rule (and its descendants) via the flat path at top level. */
  flatten: boolean;

  /** The rewritten own-local header branch texts (when not flattened). */
  header: string[];

  /** Sibling rules (target's direct decls only) to emit after this rule's block —
   * split-out exact extenders that cannot carry the rule's nested children. */
  splits: string[][];

  /**
   * Split-out exact extenders that share no level with the rule's ancestors: each
   * block's header is a top-level selector, so it rises out of every rule block the
   * rule nests in (inside the at-rules it nests in) instead of following the rule.
   */
  rootSplits?: readonly string[][];

  /**
   * A cross-`&` flatten whose subject STILL HAS surviving nested rules: instead
   * of collapsing (`flatten`, which composes children flat), the subtree is
   * RE-NESTED at the hoist position — its `header` carries the composed cross-`&`
   * sibling list (the flat solve with `:is()`-compaction) and its children stay
   * literal-nested. `flatten` is also set so the enclosing block defers it to the
   * hoist queue; the serializer picks the nested emission when this is true.
   */
  hoistNested?: boolean;

  /**
   * [&-boundary] Hoist distance: the number of enclosing rule blocks this rule must
   * rise out of before it is emitted. `1` (the default when absent) emits it at its
   * immediate parent's level; `k > 1` bubbles it up `k` levels via the serializer's
   * re-hoist queue. A trigger-P/X flatten carries the full flat header, so it rises
   * out of every enclosing rule block. A trigger-C crossing rises `maxBnd` blocks
   * (the deepest ancestor `&` the match reaches), leaving the strictly-outer
   * `bnd > k` ancestors as wrappers; its `header` is the flat solve with those
   * wrapper ancestor segments STRIPPED — the enclosing blocks re-supply them.
   */
  hoistBubble?: number;

  /**
   * A decl-less parent whose single child is a pure-`&` self-compound (`.e { &&
   * {…} }`) is TRANSPARENT: it emits no wrapper of its own; the child is emitted
   * at the parent's level with `&` composed against the parent (`&&` → `.e.e`).
   */
  collapseTransparent?: boolean;
}

/**
 * Extend projections for one concrete render placement. A `$for` body is one
 * canonical AST body but may run several times under different bindings; its
 * projections therefore belong to the iteration token, not to the shared Ruleset.
 */
export interface ExtendPlacementResults {
  flatByRule: Map<Ruleset, string[]>;
  hiddenByRule: Map<Ruleset, boolean[]>;
  suffixedByRule: Map<Ruleset, Set<string>> | null;
  nestedPlan: Map<Ruleset, NestedRulePlan>;
  hoistHeader: Map<Ruleset, string[]>;
  visibleReferenceAtRules: Set<AtRuleBlock> | null;
  visibleReferenceRuleAncestors: Set<Ruleset> | null;
  bubbleHeaders: Map<AtRuleBlock, string[]> | null;
}

export interface ExtendResults {
  /**
   * FLAT mode: per-rule EXTENDED, fully-composed header branch strings. The
   * serializer emits these as the rule's header (children still compose against
   * the RAW parent and extend independently — the composed model needs no
   * child-parent propagation).
   */
  flatByRule: Map<Ruleset, string[]>;

  /**
   * [import:reference] Per-rule visibility mask aligned 1:1 with `flatByRule`'s
   * header entries: `true` marks a header branch that originates ONLY from hidden
   * `(reference)` rules, which the serializer drops. Absent for a rule with no
   * hidden branch (the common case). A rule whose mask is all-`true` emits nothing.
   */
  hiddenByRule: Map<Ruleset, boolean[]>;

  /**
   * Per rule, the branches of a header the extend wrote — its `flatByRule`, nested
   * (`nestedPlan`) or hoisted header — whose last compound carries a pseudo-element
   * followed by more ({@link irPseudoElementCarriesSuffix}), by their emitted text.
   * The serializer writes each in a rule of its own in every output mode, since an
   * extended header is the extend's list (ledgers O10 and O17). Null until a rule
   * has one.
   */
  suffixedByRule: Map<Ruleset, Set<string>> | null;

  /** Reference-imported at-rule containers with at least one visible descendant. */
  visibleReferenceAtRules: Set<AtRuleBlock> | null;

  /** Hidden selector containers needed only to compose a visible descendant. */
  visibleReferenceRuleAncestors: Set<Ruleset> | null;

  /**
   * FLAT mode: per at-rule block written in a rule, the header its bubbled
   * declarations are written under, when an extend in the at-rule's own scope
   * reaches them (EXTEND-SEMANTICS §8). Null until one does.
   */
  bubbleHeaders: Map<AtRuleBlock, string[]> | null;

  /** NESTED mode: per-rule projection (flatten / rewritten header / splits). */
  nestedPlan: Map<Ruleset, NestedRulePlan>;

  /**
   * NESTED mode: per-rule FLAT header branches to use when a rule is hoisted to
   * top level — the flat composition with sibling `:is()`-compaction applied.
   */
  hoistHeader: Map<Ruleset, string[]>;

  /**
   * Render-local projections for dynamically placed canonical rules. The weak
   * token is issued by the serializer's preflight and is never attached to AST.
   */
  byPlacement: WeakMap<object, ExtendPlacementResults> | null;

  /** The plan's {@link Plan.targetAtoms}: every atom an extend target names. */
  targetAtoms: ReadonlySet<string>;
}

/* ------------------------------------------------------ sibling compaction */

/** The single compound of a one-segment branch, or null. */
function branchSingleCompound(b: Branch): Compound | null {
  return b.segments.length === 1 ? b.segments[0]!.compound : null;
}

/** [&-boundary] The number of LEADING segments of a composed branch whose `bnd`
 * origin is deeper than `maxBnd` — the strictly-outer ancestor wrappers a crossing
 * hoist does NOT reach (and so leaves in place as enclosing blocks). `bnd` is
 * monotonically decreasing left-to-right (outermost ancestor first), so these form a
 * clean prefix. Zero when the crossing reaches the outermost ancestor (hoist to root). */
function leadingWrapperSegs(b: Branch, maxBnd: number): number {
  if (!b.bnd) {
    return 0;
  }
  let n = 0;
  while (n < b.segments.length && (b.bnd[n] ?? 0) > maxBnd) {
    n++;
  }
  return n;
}

/** [&-boundary] Drop the first `n` segments of a branch, re-heading the remainder
 * (the new head's leading combinator becomes ' ', as a head carries none). Used to
 * strip the preserved wrapper-ancestor prefix from a hoisted crossing header — the
 * enclosing blocks the rule re-nests under already supply that prefix. */
function dropLeadingSegs(b: Branch, n: number): Branch {
  if (n <= 0) {
    return cloneBranch(b);
  }
  const segments = b.segments.slice(n).map(cloneSeg);
  if (segments.length > 0) {
    segments[0] = { combinator: ' ', compound: segments[0]!.compound };
  }
  const out = mkBranch(segments);
  if (b.hidden) {
    out.hidden = true;
  }
  return out;
}

/** True when `target`'s text-value are ⊆ some compound in `level`. */
function compoundHitsLevel(target: Compound, level: Level): boolean {
  const need = textSimpleTokens(target);
  if (need.length === 0) {
    return false;
  }
  for (const b of level) {
    for (const seg of b.segments) {
      if (multisetSubset(need, textSimpleTokens(seg.compound))) {
        return true;
      }
    }
  }
  return false;
}

/** True when composed branch text `b` descends from (nests under) some parent
 * header branch in `headerSet` — either `b` equals the multi-branch `:is()` token,
 * or `b` begins with a header branch at a selector boundary (descendant space or a
 * fused compound/pseudo/combinator start). A branch that descends can stay nested;
 * one that does not has crossed the `&`. */
function descendsFrom(b: string, headerSet: string[]): boolean {
  const token = headerSet.length === 1 ? headerSet[0]! : `:is(${headerSet.join(', ')})`;
  const cands = headerSet.length > 1 ? [token, ...headerSet] : headerSet;
  for (const h of cands) {
    if (b === h) {
      return true;
    }
    if (b.startsWith(h)) {
      const next = b[h.length]!;
      if (' .#:[>+~&'.includes(next)) {
        return true;
      }
    }
  }
  return false;
}

/** The shared empty {@link NestedRulePlan.rootSplits}; read only. */
const NO_ROOT_SPLITS: readonly string[][] = [];

function dedupBranchTexts(list: Branch[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of list) {
    const k = branchText(b);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(branchOut(b));
    }
  }
  return out;
}

/**
 * Two whole sibling branches sharing every segment except ONE compound (differing
 * by a single simple in the same position) compact to `:is(a, b)` at that
 * compound. Applied left-to-right, greedily, across the flat header branch list.
 * (`.button:hover, .submit:hover` → `:is(.button, .submit):hover`; not applied to
 * branches that share nothing.)
 *
 * `allowMultiSeg` gates cross-row factoring of MULTI-segment (descendant-complex)
 * sibling rows. It is TRUE only when the rows carry a shared PARENT-composition
 * prefix — a FLATTENED nested rule's hoisted header, where a child comma-list under
 * one parent context legitimately compacts (extend-exact:
 * `:is(<parent>) .replace` / `:is(<parent>) .c` → `:is(<parent>) :is(.replace, .c)`).
 * It is FALSE for a TOP-LEVEL rule's own header: two authored/extend-expanded
 * complex rows sharing all-but-one segment (`.foo .bar` / `.foo .baz`) are NEVER
 * `:is()`-collapsed by alpha — they stay a comma list. Verified against less.js
 * `alpha`; single-segment factoring is unaffected by the flag.
 */
function siblingCompact(branches: Branch[], allowMultiSeg: boolean): Branch[] {
  const out = branches.map(cloneBranch);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const merged = tryMergeSiblings(out[i]!, out[j]!, allowMultiSeg);
      if (merged) {
        out[i] = merged;
        out.splice(j, 1);
        j = i; // re-scan against the widened branch
      }
    }
  }
  return out;
}

/** Merge two branches that differ in exactly one compound position into one whose
 * differing compound is a maximally-compacted `:is(...)`. Returns null if they
 * differ in structure or in more than one compound. Multi-segment rows only merge
 * when `allowMultiSeg` (see {@link siblingCompact}). */
function tryMergeSiblings(a: Branch, b: Branch, allowMultiSeg: boolean): Branch | null {
  /*
   * [import:reference] Visibility is branch provenance, not selector syntax.
   * Combining one hidden and one visible branch into a shared `:is()` would make
   * the hidden selector observable because the serializer can filter only whole
   * projected branches. Keep mixed-visibility siblings separate.
   */
  if ((a.hidden === true) !== (b.hidden === true)) {
    return null;
  }
  if (a.segments.length !== b.segments.length) {
    return null;
  }
  const multiSeg = a.segments.length > 1;
  if (multiSeg && !allowMultiSeg) {
    return null;
  }
  let diff = -1;
  for (let i = 0; i < a.segments.length; i++) {
    const as = a.segments[i]!;
    const bs = b.segments[i]!;
    if (as.combinator !== bs.combinator) {
      return null;
    }
    if (compoundText(as.compound) !== compoundText(bs.compound)) {
      if (diff !== -1) {
        return null;
      }
      diff = i;
    }
  }
  if (diff === -1) {
    return null;
  }

  /*
   * Merge the differing compound into `:is()`. When the branch is a single segment
   * (no shared segment context), only merge if the compounds share a suffix — two
   * whole branches sharing NOTHING (`.ext8.ext9` / `.fuu`) stay a comma list.
   */
  const merged = mergeCompoundsToIs(a.segments[diff]!.compound, b.segments[diff]!.compound, multiSeg);
  if (!merged) {
    return null;
  }
  const segments = a.segments.map((s, i) => (i === diff ? { combinator: s.combinator, compound: merged } : cloneSeg(s)));

  /* Both sources have identical visibility (mixed provenance returned above). */
  const out = mkBranch(segments);
  if (a.hidden === true) {
    out.hidden = true;
  }
  return out;
}

/**
 * Merge two compounds that share a common suffix into `:is(<lead-a>, <lead-b>)<suffix>`.
 * `.button` / `.submit` (no shared suffix) → `:is(.button, .submit)`.
 * `.replace` / `.c` → `:is(.replace, .c)`.
 * A leading extend group (`fold`) on either side is flattened into the new group;
 * an authored or nesting `:is()` joins it as one member, so regrouping at emission
 * ({@link groupedBranches}) never splits a selector the author wrote.
 */
function mergeCompoundsToIs(a: Compound, b: Compound, allowNoSuffix: boolean): Compound | null {
  // Find the longest shared trailing simple run (by text).
  const as = a.value;
  const bs = b.value;
  let suffix = 0;
  while (
    suffix < as.length
    && suffix < bs.length
    && simpleText(as[as.length - 1 - suffix]!) === simpleText(bs[bs.length - 1 - suffix]!)
  ) {
    suffix++;
  }
  if (suffix === 0 && !allowNoSuffix) {
    return null;
  }
  const aLead = as.slice(0, as.length - suffix);
  const bLead = bs.slice(0, bs.length - suffix);
  if (aLead.length === 0 || bLead.length === 0) {
    return null;
  }
  const leadBranch = (lead: Simple[]): Branch[] => {
    // A single leading extend group flattens into the merged group.
    const only = lead.length === 1 ? lead[0]! : null;
    if (only !== null && only.t === 'is' && only.fold) {
      return only.branches.map(cloneBranch);
    }
    return [descendantBranch(lead.map(cloneSimple))];
  };

  /* A lead already in the group (`#b.x` folded twice) is the same member once. */
  const members = leadBranch(aLead);
  const seen = new Set(members.map(branchText));
  for (const member of leadBranch(bLead)) {
    if (!seen.has(branchText(member))) {
      seen.add(branchText(member));
      members.push(member);
    }
  }
  const isGroup = isSimple(members, true);
  const suffixTokens = as.slice(as.length - suffix).map(cloneSimple);
  return { value: [isGroup, ...suffixTokens] };
}

/* ------------------------------------------------- nesting fold of a header */

/**
 * [O10, orchestrator judgment 2026-10-05] Fold the branches NESTING produced in a nested
 * rule's extended, flattened header by the nesting mode, exactly as the serializer folds
 * the child list of an unextended rule (`opaqueJoin`, keyed by {@link nestingGroupKey}):
 * `'compact'` folds every descendant child branch unguarded, `'native'` (and the nested
 * output's flattened headers) only equal-specificity ones. The branches the extend added
 * are left to extend's guarded grouping. `.t { th, .x {} }` + `.foo:extend(.t th)` under
 * `'compact'` is `.t :is(th, .x), .foo`.
 *
 * The fixpoint rewrites each seed in place and appends extenders after them, so the
 * first `raw.length` branches are the seeds in authored order; a seed whose segments no
 * longer line up with its raw composition (a span collapsed across the parent) joins no
 * group. Returns `list` itself when nothing folds.
 */
function nestingFold(list: Branch[], s: PlanSubject, raw: Branch[], guarded: boolean): Branch[] {
  const own = s.ownLocal;
  const authored = s.rule.selector.selectors;
  if (own.length < 2 || raw.length !== own.length || authored.length !== own.length || list.length < raw.length) {
    return list;
  }
  const keys: number[] = [];
  let first: Branch | undefined;
  let groupable = 0;
  for (let i = 0; i < raw.length; i++) {
    const seed = list[i]!;
    const cut = raw[i]!.segments.length - own[i]!.segments.length;
    if (seed.ext === true || seed.hidden === true || branchHasAmp(own[i]!)) {
      return list;
    }
    let key = -1;
    if (cut > 0 && seed.segments.length === raw[i]!.segments.length && seed.segments[cut]!.combinator === ' '
      && (first === undefined || samePrefix(first, seed, cut))) {
      first ??= seed;
      key = nestingGroupKey(authored[i]!, guarded);
    }
    keys.push(key);
    if (key >= 0) {
      groupable++;
    }
  }
  if (groupable < 2) {
    return list;
  }
  const sizes = partitionGroups(keys);
  if (sizes.length === raw.length) {
    return list;
  }
  const out: Branch[] = [];
  for (let i = 0; out.length < sizes.length; i++) {
    const group = keys[i]!;
    if (group !== out.length) {
      continue;
    }
    if (sizes[group] === 1) {
      out.push(list[i]!);
      continue;
    }
    const cut = raw[i]!.segments.length - own[i]!.segments.length;
    const members: Branch[] = [];
    for (let j = i, taken = 0; taken < sizes[group]!; j++) {
      if (keys[j] !== group) {
        continue;
      }
      taken++;

      /* A child the extend grouped joins the list as its members, never `:is(:is(…))`. */
      const own = list[j]!.segments;
      const only = own.length === cut + 1 && own[cut]!.compound.value.length === 1 ? own[cut]!.compound.value[0]! : null;
      if (only !== null && only.t === 'is' && only.fold) {
        for (const member of only.branches) {
          members.push(member);
        }
      } else {
        members.push(mkBranch(own.slice(cut)));
      }
    }
    const segments = list[i]!.segments.slice(0, cut);
    segments.push({ combinator: ' ', compound: { value: [{ t: 'is', branches: members, fold: false }] } });
    out.push(mkBranch(segments));
  }
  for (let i = raw.length; i < list.length; i++) {
    out.push(list[i]!);
  }
  return out;
}

/** True when `a` and `b` agree on their first `cut` segments (the parent they nest in;
 * `a` is at least that long). */
function samePrefix(a: Branch, b: Branch, cut: number): boolean {
  if (a.segments.length < cut) {
    return false;
  }
  for (let k = 0; k < cut; k++) {
    const as = a.segments[k]!;
    const bs = b.segments[k]!;
    if (as.combinator !== bs.combinator || !sameCompound(as.compound.value, bs.compound.value)) {
      return false;
    }
  }
  return true;
}

/** Simple-by-simple compound equality; builds no text for plain tokens. */
function sameCompound(a: readonly Simple[], b: readonly Simple[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.t === 'text' ? y.t !== 'text' || x.text !== y.text : y.t !== 'is' || simpleText(x) !== simpleText(y)) {
      return false;
    }
  }
  return true;
}

/* --------------------------------------------- guarded `:is()` group emission */

/**
 * [X3/§7c, owner ruling 2026-10-05] Regroup extend's own `:is()` groups (`fold`)
 * for output under the shared `:is()` grouping (`../is-grouping.ts`) — the rule
 * `collapseNesting: 'native'` folds by — in EVERY output mode. The solve keeps each
 * group whole, because later instructions chain through it as one set of
 * alternatives, so the split happens once, here, as a header is emitted. Members of
 * one group share one specificity (equal-specificity members gather however far
 * apart they are, in order of first appearance), and a member that cannot sit inside
 * `:is()` — a pseudo-element, an unlisted pseudo-class, a complex member the group
 * does not lead with — is written as its own branch, the way Less 4.x expands an
 * `all` match ({@link spliceMember}).
 *
 * `root` is set for a top-level header. A complex member may stay in a group only
 * where the group leads the whole selector — first in the head compound of a
 * top-level header — because only there `:is(.t .b).k .box` matches what the
 * expanded `.t .b.k .box` does. A nested header has an implicit `&` before it.
 * Returns `list` itself when no group splits.
 */
function groupedBranches(list: Branch[], root: boolean): Branch[] {
  groupPlans = null;
  let out: Branch[] | null = null;
  for (let i = 0; i < list.length; i++) {
    const regrouped = regroupBranch(list[i]!, root, 0, 0);
    if (regrouped !== null) {
      out ??= list.slice(0, i);
      for (const branch of regrouped) {
        out.push(branch);
      }
    } else if (out !== null) {
      out.push(list[i]!);
    }
  }
  groupPlans = null;
  return out ?? list;
}

/**
 * How one extend group splits at a position kind (`compoundOnly`): its members once
 * each is resolved as an `:is()` argument, and each member's group number (`keys`,
 * from {@link partitionGroups}) with the group sizes, or `keys === null` when every
 * member joins one group.
 */
interface GroupPlan {
  compoundOnly: boolean;
  members: Branch[];
  keys: number[] | null;
  sizes: number[] | null;
}

/*
 * The plans of the groups the current header has met since its first split. A split
 * repeats the rest of the branch once per alternative, sharing its later groups by
 * reference, so each later group is planned once rather than once per alternative.
 * Created only once a split happens; cleared per header by {@link groupedBranches}.
 */
let groupPlans: Map<Simple, GroupPlan> | null = null;

/** The output branches `b` stands for once the extend groups at or after segment
 * `k0`, simple `p0` are regrouped, or null when none of them splits. Everything
 * before the cursor is final, so the walk resumes where a split happened. */
function regroupBranch(b: Branch, root: boolean, k0: number, p0: number): Branch[] | null {
  recordAstExtendProfile?.('astExtend.emit.regroupWalks');
  const segments = b.segments;
  for (let k = k0; k < segments.length; k++) {
    const value = segments[k]!.compound.value;
    for (let p = k === k0 ? p0 : 0; p < value.length; p++) {
      const s = value[p]!;
      if (s.t !== 'is') {
        continue;
      }
      const out = s.fold ? splitGroup(b, k, p, s, root) : splitArms(b, k, p, s.branches, root);
      if (out !== null) {
        return out;
      }
    }
  }
  return null;
}

/** Push the output branches of `b` into `out`, regrouping from segment `k`, simple `p`. */
function pushRegrouped(out: Branch[], b: Branch, root: boolean, k: number, p: number): void {
  const regrouped = regroupBranch(b, root, k, p);
  if (regrouped === null) {
    out.push(b);
    return;
  }
  for (const branch of regrouped) {
    out.push(branch);
  }
}

/**
 * Plan the extend group `group`: resolve each member as an `:is()` argument (nothing
 * precedes it there), then score every member once at the group's position kind.
 */
function planGroup(group: Simple & { t: 'is' }, compoundOnly: boolean): GroupPlan {
  const original = group.branches;
  let members: Branch[] | null = null;
  for (let i = 0; i < original.length; i++) {
    const resolved = regroupBranch(original[i]!, true, 0, 0);
    if (resolved !== null) {
      members ??= original.slice(0, i);
      for (const member of resolved) {
        members.push(member);
      }
    } else if (members !== null) {
      members.push(original[i]!);
    }
  }
  const list = members ?? original;

  /* The common whole group allocates no keys. */
  let keys: number[] | null = null;
  let first = 0;
  for (let i = 0; i < list.length; i++) {
    recordAstExtendProfile?.('astExtend.emit.groupMemberScores');
    const key = extendBranchSpecificity(list[i]!, compoundOnly);
    if (keys !== null) {
      keys.push(key);
    } else if (i === 0) {
      first = key;
      if (key < 0) {
        keys = [key];
      }
    } else if (key !== first) {
      keys = [];
      for (let j = 0; j < i; j++) {
        keys.push(first);
      }
      keys.push(key);
    }
  }
  return { compoundOnly, members: list, keys, sizes: keys === null ? null : partitionGroups(keys) };
}

/**
 * The extend group at `b.segments[k]`, simple `p`, split for output: one alternative
 * per equal-specificity group, a lone member spliced into `b` and regrouped again at
 * its real position. Null when the group stays whole as it is.
 */
function splitGroup(b: Branch, k: number, p: number, group: Simple & { t: 'is' }, root: boolean): Branch[] | null {
  /*
   * A member's own group is planned as an `:is()` argument first, and again here once
   * the member is spliced into a branch, so a plan is reused only at the same kind.
   */
  const compoundOnly = !(root && k === 0 && p === 0 && b.segments[0]!.combinator === ' ');
  let plan = groupPlans?.get(group);
  if (plan === undefined || plan.compoundOnly !== compoundOnly) {
    plan = planGroup(group, compoundOnly);
    if (groupPlans !== null || plan.keys !== null || plan.members !== group.branches) {
      (groupPlans ??= new Map()).set(group, plan);
    }
  }
  const { members, keys, sizes } = plan;
  if (keys === null && members === group.branches) {
    return null;
  }
  const out: Branch[] = [];
  if (keys === null || sizes === null) {
    pushRegrouped(out, withSimple(b, k, p, { t: 'is', branches: members, fold: true }), root, k, p + 1);
    return out;
  }
  for (let i = 0, g = 0; g < sizes.length; i++) {
    if (keys[i] !== g) {
      continue;
    }
    if (sizes[g] === 1) {
      const spliced = spliceMember(b, k, p, members[i]!);
      if (spliced !== null) {
        pushRegrouped(out, spliced, root, k, p);
      }
    } else {
      const arms: Branch[] = [];
      for (let j = i; arms.length < sizes[g]!; j++) {
        if (keys[j] === g) {
          arms.push(members[j]!);
        }
      }
      pushRegrouped(out, withSimple(b, k, p, { t: 'is', branches: arms, fold: true }), root, k, p + 1);
    }
    g++;
  }
  return out;
}

/**
 * An authored or nesting `:is()` at `b.segments[k]`, simple `p`, with an extend group
 * inside an arm that splits, or an arm an `all` extend appended; null when neither. The
 * arms stay one list, each taking its first alternative — the group holding the matched
 * selector, at the arm's own specificity. Every other alternative replaces the whole
 * `:is()` on its own: put back among the other arms it would raise the specificity of
 * elements the extend never touched (`:is(.c.k, .z) .d` + `#b:extend(.c all)` →
 * `:is(.c.k, .z) .d, #b.k .d`).
 *
 * An arm an extend appended (an extender matched a whole arm: `ext`) is extend's own
 * grouping, so it follows the same guard (orchestrator judgment 2026-10-05): it joins the
 * list only at the list's specificity, where its shape may sit in the `:is()`, and
 * otherwise replaces the whole `:is()` on its own (`:is(.c, .z) .d` +
 * `#b:extend(.c all)` → `:is(.c, .z) .d, #b .d`), so the authored list keeps its
 * specificity and the extender keeps its own.
 */
function splitArms(b: Branch, k: number, p: number, arms: Branch[], root: boolean): Branch[] | null {
  /* `null` holds an appended arm's place until the guard has judged it. */
  let kept: Array<Branch | null> | null = null;
  let alone: Branch[] | null = null;
  let added: Branch[] | null = null;
  for (let a = 0; a < arms.length; a++) {
    const arm = arms[a]!;
    if (arm.ext === true) {
      kept ??= arms.slice(0, a);
      kept.push(null);
      (added ??= []).push(arm);
      continue;
    }
    const alternatives = regroupBranch(arm, true, 0, 0);
    if (alternatives === null) {
      kept?.push(arm);
      continue;
    }
    kept ??= arms.slice(0, a);
    kept.push(alternatives[0]!);
    for (let j = 1; j < alternatives.length; j++) {
      (alone ??= []).push(alternatives[j]!);
    }
  }
  if (kept === null) {
    return null;
  }
  const list: Branch[] = [];
  if (added === null) {
    for (const arm of kept) {
      list.push(arm!);
    }
  } else {
    let listSpecificity = 0;
    for (const arm of kept) {
      const s = arm === null ? 0 : extendBranchSpecificity(arm, false);
      if (s < 0) {
        listSpecificity = -1;
        break;
      }
      listSpecificity = Math.max(listSpecificity, s);
    }
    const compoundOnly = !(root && k === 0 && p === 0 && b.segments[0]!.combinator === ' ');
    let next = 0;
    for (const arm of kept) {
      if (arm !== null) {
        list.push(arm);
        continue;
      }
      const appended = added[next++]!;
      for (const alternative of regroupBranch(appended, true, 0, 0) ?? [appended]) {
        recordAstExtendProfile?.('astExtend.emit.groupMemberScores');
        if (listSpecificity >= 0 && extendBranchSpecificity(alternative, compoundOnly) === listSpecificity) {
          list.push(alternative);
        } else {
          (alone ??= []).push(alternative);
        }
      }
    }
  }
  const out: Branch[] = [];
  pushRegrouped(out, withSimple(b, k, p, { t: 'is', branches: list, fold: false }), root, k, p + 1);
  for (const alternative of alone ?? []) {
    /* Written in place, never as a one-arm `:is()` (ledger X3's 4.x placement). */
    const spliced = spliceMember(b, k, p, alternative);
    if (spliced !== null) {
      pushRegrouped(out, spliced, root, k, p);
    }
  }
  return out;
}

/** A regrouped branch keeps its source's visibility; `bnd` is not carried, since
 * emission reads only text. */
function withSegments(b: Branch, segments: SelectorPart[]): Branch {
  const out = mkBranch(segments);
  if (b.hidden === true) {
    out.hidden = true;
  }
  return out;
}

function withSimple(b: Branch, k: number, p: number, simple: Simple): Branch {
  const segments = b.segments.slice();
  const segment = segments[k]!;
  const value = segment.compound.value.slice();
  value[p] = simple;
  segments[k] = { combinator: segment.combinator, compound: { value } };
  return withSegments(b, segments);
}

/**
 * `b` with the group at `b.segments[k]`, simple `p`, replaced by one member, written
 * the way Less 4.x expands an `all` match: the simples before the group join the
 * member's first compound and those after it join its last compound
 * (`.a > .m:is(.c, .p .q).n` → `.a > .m.p .q.n`). Each joined compound is made valid
 * by {@link mergeCompound}; null when one would need two element types — no element
 * matches it, so the member contributes no branch. A member that leads with the
 * whole context before the group is written without it twice ({@link sharedContext}).
 */
function spliceMember(b: Branch, k: number, p: number, member: Branch): Branch | null {
  const segment = b.segments[k]!;
  const value = segment.compound.value;
  const drop = sharedContext(b, k, member);
  const arm = drop === 0 ? member.segments : member.segments.slice(drop);
  const n = arm.length;
  const before = value.slice(0, p);
  const after = value.slice(p + 1);
  const head = mergeCompound(before, arm[0]!.compound.value, n === 1 ? after : NO_SIMPLES);
  const tail = n === 1 ? head : mergeCompound(NO_SIMPLES, arm[n - 1]!.compound.value, after);
  if (head === null || tail === null) {
    return null;
  }
  const segments = b.segments.slice(0, k);
  segments.push({
    combinator: k === 0 && segment.combinator === ' '
      ? arm[0]!.combinator
      : drop > 0 && member.segments.length > k ? narrower(segment.combinator, arm[0]!.combinator)! : segment.combinator,
    compound: { value: head }
  });
  for (let j = 1; j < n - 1; j++) {
    segments.push(arm[j]!);
  }
  if (n > 1) {
    segments.push({ combinator: arm[n - 1]!.combinator, compound: { value: tail } });
  }
  for (let j = k + 1; j < b.segments.length; j++) {
    segments.push(b.segments[j]!);
  }
  return withSegments(b, segments);
}

/**
 * How many leading compounds of `member` to leave out where it replaces the group in
 * `b.segments[k]`: an extender standing for its target where the target appears
 * writes the context it shares with that position once, so nested and flat output
 * agree (PINNED-DEFECTS DF8; orchestrator judgment under owner delegation 2026-10-07).
 * A member that leads with the whole context before the group, `A d R`, matches there
 * what `A c :is(A d R)` does. When `c` and `d` are both ancestor combinators (` `, `>`)
 * or both sibling ones (`+`, `~`) that is `A R` joined by the narrower of the two
 * ({@link narrower}), so it drops `A` (`.attributes { [data="test"] {…}
 * .attribute-test { &:extend([data="test"] all); } }` → `.attributes .attribute-test`,
 * never `.attributes .attributes .attribute-test`; `.a { .t {…} > .r {
 * &:extend(.t all); } }` → `.a > .r`). A member that IS that context keeps its last
 * compound (`.p .y` in `.p .y .z.k` → `.p .y .y.k`), which only a descendant join
 * allows. 0 otherwise.
 */
function sharedContext(b: Branch, k: number, member: Branch): number {
  const n = member.segments.length;
  if (k === 0 || n < 2 || n < k) {
    return 0;
  }
  const drop = n > k ? k : k - 1;
  const joined = member.segments[drop]!.combinator;
  if (n > k ? narrower(b.segments[k]!.combinator, joined) === undefined : joined !== ' ') {
    return 0;
  }
  return samePrefix(member, b, k) ? drop : 0;
}

/**
 * The combinator `A c :is(A d R)` reduces to, `A ? R`, or `undefined` when it does not
 * reduce: the narrower of two ancestor combinators (`>` over ` `) or of two sibling ones
 * (`+` over `~`), since the element the narrower one names satisfies the wider one too.
 */
function narrower(c: Combinator, d: Combinator): Combinator | undefined {
  if ((c === ' ' || c === '>') && (d === ' ' || d === '>')) {
    return c === '>' ? c : d;
  }
  if ((c === '+' || c === '~') && (d === '+' || d === '~')) {
    return c === '+' ? c : d;
  }
  return undefined;
}

/* ------------------------------------------------- relative extender folding */

/** Number of leading ancestor levels two paths share. The plan walk threads the SAME
 * `Level` object into every descendant path, so identity is the cheap answer; a level
 * the render walk recorded (an at-rule block's extend, a placed body) or an inline
 * extender's narrowed level is its own object, so an equal selector list shares too —
 * the composed selector is the same either way. */
function sharedPrefixLen(a: Level[], b: Level[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && (a[i] === b[i] || sameLevel(a[i]!, b[i]!))) {
    i++;
  }
  return i;
}

function sameLevel(a: Level, b: Level): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (branchText(a[i]!) !== branchText(b[i]!)) {
      return false;
    }
  }
  return true;
}

/** The extender path that is the parent itself, written `&`. composePath clones it. */
const PARENT_PATH: Level[] = [[mkBranch([{ combinator: ' ', compound: { value: [textSimple('&')] } }])]];

/**
 * Re-express an instruction's extender path RELATIVE to a nested subject's parent
 * context so a folded-in extender contributes its OWN-LOCAL remainder, not its
 * double-prefixed full composed path. An extender that shares the subject's parent
 * ancestor (`.attributes .attribute-test` folded into `.attributes [data="test"]`)
 * drops the shared levels → the sibling `.attribute-test`. A top-level extender
 * (`.rep_ace`, no shared ancestor) is unchanged. The strip is capped at the parent
 * context depth so a self-extend never slices the path empty. An extender that IS
 * the shared parent (`.y { &:extend(.y .z); .z {…} }`, or the rule an at-rule block
 * inside it lands in) has no remainder: where it replaces the WHOLE selector
 * (`whole`), relative to the parent it is `&`. Where it replaces a part of the
 * own-local selector (a sub-compound `all` match) it keeps its own composed last
 * compound, since the part sits below the parent (`.y { &:extend(.z all); .z.k {…} }`
 * → `:is(.z, .y).k`, i.e. `.y .y.k`; `.p { &.y {…} }` keeps `.p.y`; PINNED-DEFECTS
 * DF8, orchestrator judgment under owner delegation 2026-10-07).
 */
function relativizeExtender(inst: PlanInstruction, subject: PlanSubject, whole: boolean): PlanInstruction {
  const drop = Math.min(sharedPrefixLen(subject.path, inst.extenderPath), subject.path.length - 1);
  if (drop === 0) {
    return inst;
  }
  if (drop < inst.extenderPath.length) {
    return { ...inst, extenderPath: inst.extenderPath.slice(drop) };
  }
  return { ...inst, extenderPath: whole ? PARENT_PATH : [composePath(inst.extenderPath).map(lastCompound)] };
}

/** `b`'s last compound as a branch of its own. */
function lastCompound(b: Branch): Branch {
  return mkBranch([{ combinator: ' ', compound: b.segments[b.segments.length - 1]!.compound }]);
}

/* ---------------------------------------------------------------- top level */

/**
 * Compute extend results for a parsed AST root. Returns `null` when the
 * document has NO `:extend()` at all (the serializer's zero-cost gate).
 * `guardedNesting` is false under `collapseNesting: 'compact'`, whose nesting fold
 * an extended header keeps ({@link nestingFold}); extend's own groups are guarded in
 * every mode.
 */
export function computeExtends(root: Stylesheet, overlay?: PlanOverlay, guardedNesting = true): ExtendResults | null {
  /*
   * Zero-cost gate: an allocation-free pre-scan short-circuits the common case (no
   * `:extend()` anywhere) before any subject/instruction plan is built.
   */
  if (!documentHasExtend(root) && (!overlay || overlay.instructions.length === 0)) {
    return null;
  }
  const plan = collectPlan(root, overlay);
  if (plan.instructions.length === 0) {
    return null;
  }

  /*
   * Render-scoped `Contrib` memo. A contrib is a pure function of its instruction
   * (composed extenders + target atoms — never the subject being solved), so each of
   * the plan's instructions is composed AT MOST ONCE here instead of once per admitted
   * subject. Lazily filled by `solveComposed`, so a document whose subjects are all
   * pruned by the target-atom prefilter still composes nothing. See `buildContribs`'s
   * sharing invariant for why the memoized branches are safe to share across subjects.
   */
  const contribMemo: ContribMap = new Map();
  const flatByRule = new Map<Ruleset, string[]>();
  const hiddenByRule = new Map<Ruleset, boolean[]>();
  const nestedPlan = new Map<Ruleset, NestedRulePlan>();
  const hoistHeader = new Map<Ruleset, string[]>();
  const staticProjection: ExtendPlacementResults = {
    flatByRule,
    hiddenByRule,
    suffixedByRule: null,
    nestedPlan,
    hoistHeader,
    visibleReferenceAtRules: null,
    visibleReferenceRuleAncestors: null,
    bubbleHeaders: null
  };
  let byPlacement: WeakMap<object, ExtendPlacementResults> | null = null;
  const projectionForPlacement = (placement?: object): ExtendPlacementResults => {
    if (!placement) {
      return staticProjection;
    }
    const all = byPlacement ??= new WeakMap<object, ExtendPlacementResults>();
    let projection = all.get(placement);
    if (!projection) {
      projection = {
        flatByRule: new Map(),
        hiddenByRule: new Map(),
        suffixedByRule: null,
        nestedPlan: new Map(),
        hoistHeader: new Map(),
        visibleReferenceAtRules: null,
        visibleReferenceRuleAncestors: null,
        bubbleHeaders: null
      };
      all.set(placement, projection);
    }
    return projection;
  };
  const projectionFor = (subject: PlanSubject): ExtendPlacementResults =>
    projectionForPlacement(subject.placement);

  /**
   * The emitted texts of `branches`, a header the extend wrote for `s`, noting in
   * `suffixedByRule` each branch that carries a pseudo-element followed by more.
   */
  const extendedHeaderTexts = (s: PlanSubject, branches: readonly Branch[]): string[] => {
    const texts: string[] = [];
    let suffixed: Set<string> | undefined;
    for (const branch of branches) {
      const text = branchOut(branch);
      texts.push(text);
      if (irPseudoElementCarriesSuffix(branch)) {
        if (suffixed === undefined) {
          const byRule = projectionFor(s).suffixedByRule ??= new Map();
          suffixed = byRule.get(s.rule);
          if (suffixed === undefined) {
            suffixed = new Set();
            byRule.set(s.rule, suffixed);
          }
        }
        suffixed.add(text);
      }
    }
    return texts;
  };

  /*
   * LAZY + MEMOIZED composePath. `composePath(s.path)` (full ancestor fold + Branch-
   * IR allocation) is THE expensive primitive; it is computed at most once per
   * subject and ONLY for subjects a candidate actually needs (candidates + the
   * parents a flatten trigger reads). A non-candidate never referenced here is
   * never composed.
   */
  const rawCache = new Map<PlanSubject, Branch[]>();
  const rawOf = (s: PlanSubject): Branch[] => {
    let r = rawCache.get(s);
    if (r === undefined) {
      /*
       * [import:reference] stamp each composed level while folding, not only the
       * final branch. A multi-branch ancestor becomes a structured `:is()` graft;
       * retaining the arms' provenance lets a visible extender replace one arm
       * without exposing its hidden siblings. Authored `:is()` arms are untouched.
       */
      r = composePath(s.path, s.hidden);

      /*
       * [placeholder] A placeholder seed branch is hidden PER BRANCH, not per
       * subject: `%ph, .a { … }` keeps `.a`. That granularity is why the
       * subject's `hidden` flag could not be reused — it hides a whole rule.
       *
       * This marks provenance so the per-branch mask carries a placeholder the
       * same way it carries an `@import (reference)` rule. It is NOT sufficient
       * on its own: an un-extended placeholder is never composed at all (it is
       * not a candidate and has no mask), so the serializer keeps its own
       * header-level filter for that case. Both read the same predicate.
       *
       * KNOWN GAP: `:is()` compaction does not consult this flag, so a
       * segment-substituted placeholder still prints as `:is(\\ph, .a) .c`
       * rather than `.a .c`. The selector MATCHES correctly (a placeholder is
       * inert by construction), so this is a cosmetic divergence from
       * dart-sass, tracked on FOUNDATION-CORPUS-REPORT.md blocker #12.
       * Declining the merge when `a.hidden !== b.hidden` was tried and does NOT
       * fix it — the branches reaching that merge do not carry this flag.
       */
      for (const b of r) {
        if (branchTextIsPlaceholder(branchText(b))) {
          b.hidden = true;
        }
      }
      rawCache.set(s, r);
    }
    return r;
  };

  const reachingOf = (s: PlanSubject): PlanInstruction[] =>
    plan.instructions.filter(i => boundaryReaches(i.boundary, s.boundary) && reaches(i.scope, s.scope));

  const childrenOf = new Map<PlanSubject, PlanSubject[]>();
  for (const s of plan.subjects) {
    if (s.parent) {
      (childrenOf.get(s.parent) ?? childrenOf.set(s.parent, []).get(s.parent)!).push(s);
    }
  }

  /*
   * ---- decl-less `&&` self-collapse (`.e { && {…} }` → `.e.e { … }`) ----
   * A decl-less parent whose ONLY emitting statement is a single child rule whose
   * own-local is a pure-`&` self-compound (`&&`, `&&&`) is TRANSPARENT: it emits
   * no wrapper; the child is emitted at the parent's level with `&` composed
   * against the parent (so the child behaves like a top-level rule keyed on its
   * COMPOSED complex). This is a general nested-emit collapse, gated tightly so it
   * does not disturb ordinary nesting.
   */
  const collapsedParent = new Set<Ruleset>();
  const collapsedChild = new Set<PlanSubject>();
  const isPureAmpSelfCompound = (s: PlanSubject): boolean => {
    if (s.ownLocal.length !== 1) {
      return false;
    }
    const br = s.ownLocal[0]!;
    if (br.segments.length !== 1) {
      return false;
    }
    const value = br.segments[0]!.compound.value;
    return value.length >= 2 && value.every(x => x.t === 'text' && x.text === '&');
  };
  for (const p of plan.subjects) {
    let onlyRule: Statement | null = null;
    let bail = false;
    for (const st of p.rule.rules) {
      if (st.type === 'MixinDefinition' || st.type === 'VariableDeclaration') {
        continue;
      }
      if (st.type === 'Ruleset' && onlyRule === null) {
        onlyRule = st;
        continue;
      }
      bail = true; // a direct decl/comment/mixin-call/at-rule, or a second rule
      break;
    }
    if (bail || onlyRule === null) {
      continue;
    }
    const kids = childrenOf.get(p) ?? [];
    if (kids.length !== 1) {
      continue;
    }
    const c = kids[0]!;
    if (c.rule !== onlyRule || !isPureAmpSelfCompound(c)) {
      continue;
    }
    collapsedParent.add(p.rule);
    collapsedChild.add(c);
  }

  /*
   * ---- candidate set C (the prune) ----
   * A rule receives a NON-DEFAULT map entry only inside the extend-touched region.
   * SEEDS are the rules that can originate a change/flatten: a may-match subject, a
   * nested rule carrying its own `:extend()` (trigger B), or a `&&` self-collapse
   * pair. C is the DOWNWARD closure of the seeds (flatten cascades to descendants):
   * a subject is a candidate iff it or any ancestor is a seed. Everything else gets
   * the cheap default and is proven (EXTEND-REDESIGN.md §2) to need nothing more.
   */
  const isSeed = (s: PlanSubject): boolean =>
    s.mayMatch
    || (s.parent !== null && s.rule.extendInstructions !== undefined && s.rule.extendInstructions.length > 0)
    || collapsedParent.has(s.rule)
    || collapsedChild.has(s);
  const candidate = new Set<PlanSubject>();
  for (const s of plan.subjects) {
    /*
     * document (pre-)order ⇒ parent precedes child, so the ancestor's membership is
     * already decided when the closure test reads it.
     */
    if (isSeed(s) || (s.parent !== null && candidate.has(s.parent))) {
      candidate.add(s);
    }
  }

  // ---- FLAT solve, candidates ONLY ----
  const flatBySubject = new Map<PlanSubject, Branch[]>();
  for (const s of plan.subjects) {
    if (!candidate.has(s)) {
      continue;
    }
    const { list: flat, changed } = solveComposed(rawOf(s), s, plan, contribMemo);
    flatBySubject.set(s, flat);

    /*
     * A rule the extend engine actually changed emits its EXTENDED header with
     * sibling `:is()`-compaction (`.button:hover, .submit:hover` →
     * `:is(.button, .submit):hover`); an unchanged rule keeps its authored form.
     * Top-level own header: no multi-segment cross-row factoring (alpha keeps
     * `.foo .bar` / `.foo .baz` a comma list). Consumed only by top-level rules —
     * nested rules render through `nestedPlan`/`hoistHeader`.
     */
    if (changed) {
      const compacted = groupedBranches(siblingCompact(nestingFold(flat, s, rawOf(s), guardedNesting), false), true);
      const projection = projectionFor(s);

      /*
       * [import:reference] carry the per-branch visibility mask only when some branch
       * is hidden — a document with no reference imports never allocates it.
       */
      let hiddenMask: boolean[] | null = null;
      let hasVisibleBranch = false;
      const headerTexts = extendedHeaderTexts(s, compacted);
      for (let index = 0; index < compacted.length; index++) {
        const branch = compacted[index]!;
        if (branch.hidden === true) {
          if (hiddenMask === null) {
            hiddenMask = [];
            for (let prior = 0; prior < index; prior++) {
              hiddenMask.push(false);
            }
          }
          hiddenMask.push(true);
        } else {
          hasVisibleBranch = true;
          if (hiddenMask !== null) {
            hiddenMask.push(false);
          }
        }
      }
      projection.flatByRule.set(s.rule, headerTexts);
      if (hiddenMask !== null) {
        projection.hiddenByRule.set(s.rule, hiddenMask);
      }
      if (s.hidden && hasVisibleBranch) {
        let parent = s.parent;
        while (parent !== null) {
          const parentProjection = projectionFor(parent);
          const ancestors = parentProjection.visibleReferenceRuleAncestors ??= new Set();
          if (ancestors.has(parent.rule)) {
            break;
          }
          ancestors.add(parent.rule);
          parent = parent.parent;
        }
        let owner = s.referenceAtRule;
        while (owner !== null) {
          const ownerProjection = projectionForPlacement(owner.placement);
          const atRules = ownerProjection.visibleReferenceAtRules ??= new Set();
          if (atRules.has(owner.node)) {
            break;
          }
          atRules.add(owner.node);
          owner = owner.parent;
        }
      }
    }
  }

  /*
   * ---- at-rule bubbles (EXTEND-SEMANTICS §8) ----
   * An at-rule block written in a rule holds declarations of the rule in the
   * at-rule's scope, which flat output writes under the rule's header in the
   * bubbled block. An extend in that scope reaches them there: `.b { @media print
   * { y: 1; .q:extend(.b) {} } }` writes `@media print { .b, .b .q { y: 1; } }`.
   * Only an extend inside the at-rule's scope makes that header differ from the
   * rule's own ({@link Emit.extendedContexts} carries the rule's), so a bubble is
   * solved only when some instruction's scope ends in an at-rule between the rule
   * and the bubble (a Set read per scope level). Nested output cannot spell the
   * fold in the at-rule's implicit `&` block, so such a rule is written flat there
   * (trigger A below).
   */
  const bubbled = new Set<PlanSubject>();
  if (plan.bubbles.length > 0) {
    const scopedIds = new Set<number>();
    for (const inst of plan.instructions) {
      if (inst.scope.length > 0) {
        scopedIds.add(inst.scope[inst.scope.length - 1]!);
      }
    }
    for (const b of plan.bubbles) {
      const s = b.subject;
      let inside = false;
      for (let level = s.scope.length; level < b.scope.length && !inside; level++) {
        inside = scopedIds.has(b.scope[level]!);
      }
      if (!inside || !candidate.has(s)) {
        continue;
      }
      recordAstExtendProfile?.('astExtend.emit.bubbleSolves');
      const { list, changed } = solveComposed(rawOf(s), { scope: b.scope, boundary: s.boundary }, plan, contribMemo);
      const own = flatBySubject.get(s) ?? rawOf(s);
      if (!changed || (list.length === own.length && list.every((branch, index) => branchText(branch) === branchText(own[index]!)))) {
        continue;
      }
      const compacted = groupedBranches(siblingCompact(nestingFold(list, s, rawOf(s), guardedNesting), false), true);
      (projectionFor(s).bubbleHeaders ??= new Map()).set(b.atRule, compacted.map(branchOut));
      bubbled.add(s);
    }
  }

  const hasChildSubjects = (s: PlanSubject): boolean => (childrenOf.get(s) ?? []).length > 0;

  /** The parent header branch texts a nested child may descend from WITHOUT crossing
   * the `&`: the parent's EXTENDED header (its flat solve when the extend rewrote the
   * parent compound in place — `.replace.replace` → `:is(.replace, .rep_ace)…`, so a
   * child that still textually descends from the rewritten parent is not a cross-`&`),
   * falling back to raw, plus the `all`-extender folds that alias the parent whole
   * complex. Comparing against the EXTENDED (not raw) header is what stops a
   * sub-substitution of the parent compound from being mistaken for a `&`-crossing. */
  const extendedParentHeader = (p: PlanSubject): string[] => {
    const base = flatBySubject.get(p) ?? rawOf(p);
    const rawKeys = new Set(rawOf(p).map(branchText));

    /*
     * Partition the extenders whole-matching one of the parent's raw branches into:
     * - PARTIAL in-place rewrites of the parent compound (`.replace` →
     * `:is(.replace, .rep_ace)`) — the child still textually descends from the
     * rewritten parent, so their composed forms EXTEND the descends-from header;
     * - EXACT (`!partial`) whole-complex folds — a FOREIGN SPLIT ALIAS: the sibling
     * exact extender folds into the parent's FLAT solve but SPLITS to a top-level
     * rule carrying only the parent's direct decls, and cannot nest the parent's
     * surviving children. Treating it as a header the child descends from silently
     * absorbs an exact cross-`&` extender that then has nowhere to nest — so
     * exclude these from `base`, keeping such an extender routed to cross().
     */
    const splitAliases = new Set<string>();
    const partialAliases: string[] = [];
    for (const inst of reachingOf(p)) {
      if (!rawKeys.has(branchText(inst.target))) {
        continue;
      }
      for (const e of composePath(inst.extenderPath)) {
        if (inst.partial) {
          partialAliases.push(branchText(e));
        } else {
          splitAliases.add(branchText(e));
        }
      }
    }
    const out = base.map(branchText).filter(t => !splitAliases.has(t));
    for (const a of partialAliases) {
      out.push(a);
    }
    return out;
  };

  /*
   * ---- flatten decision (top-down; a COLLAPSE cascades to descendants) ----
   * 'collapse' — the flattened subtree is emitted FLAT (children composed); it
   * cascades flatten downward (a collapsed leaf's descendants collapse too).
   * 'renest'  — the flattened subject STILL HAS nested rules: it is RE-NESTED at
   * the hoist position (composed cross-`&` header, children stay literal-nested),
   * so it does NOT cascade (its children emit nested under the new header).
   */
  const flattenModeOf = new Map<PlanSubject, 'collapse' | 'renest'>();
  const ownMode = (s: PlanSubject): 'none' | 'collapse' | 'renest' => {
    /*
     * trigger A: an extend in the scope of an at-rule block written in the rule
     * reaches the rule's declarations there, which only the flat writer's bubbled
     * block can carry (see the bubbles above), so the rule is written flat, its
     * children with it, a top-level rule included.
     */
    if (bubbled.has(s)) {
      return 'collapse';
    }
    if (s.parent === null) {
      return 'none';
    }
    const cross = (): 'collapse' | 'renest' => (hasChildSubjects(s) ? 'renest' : 'collapse');
    const parentKeys = new Set(rawOf(s.parent).map(branchText));

    /*
     * trigger P: an `all`-extender aliasing the parent whole complex whose target
     * does NOT also hit the child's own local compound (foreign parent-context
     * alias — the parent context changed under the child, so it cannot stay local).
     */
    for (const inst of reachingOf(s)) {
      const single = branchSingleCompound(inst.target);
      if (inst.partial && single && parentKeys.has(branchText(inst.target)) && !compoundHitsLevel(single, s.ownLocal)) {
        return cross();
      }
    }

    /*
     * trigger X: a WHOLE-COMPLEX (exact/all-whole) match appends a FOREIGN sibling
     * (the whole extender complex) that does not descend from the parent's extended
     * header — the join is above the `&`, so the subtree flattens. A single-compound
     * sub-match (rewrites a compound IN PLACE, never appends a whole sibling) is not
     * a whole match and does not fire this — so a parent-compound sub-substitution
     * (`.replace` → `:is(.replace, .rep_ace)`) keeps the rule nested.
     */
    const raw = rawOf(s);
    const phSet = extendedParentHeader(s.parent);
    for (const inst of reachingOf(s)) {
      if (!raw.some(b => branchWholeMatches(b, inst.target, inst.partial))) {
        continue;
      }

      /*
       * An EXACT (`!partial`) whole-match into a rule with nested children does NOT
       * flatten — the exact extender cannot carry the children, so it SPLITS to a
       * sibling rule (the target's direct decls only) while this rule stays put. Only
       * an `all` whole-match (which propagates into children) or an exact match into
       * a LEAF crosses the `&`.
       */
      if (!inst.partial && hasChildSubjects(s)) {
        continue;
      }
      for (const e of composePath(inst.extenderPath)) {
        if (!descendsFrom(branchText(e), phSet)) {
          return cross();
        }
      }
    }
    return 'none';
  };

  /*
   * ---- trigger C: structural ampersand-CROSSING sub-span (per-boundary hoist) ----
   * The `bnd`-read replacement for the match-span heuristics: a MULTI-segment `all`
   * sub-span match whose span straddles the `&` (some own-local `bnd === 0`, some
   * ancestor `bnd > 0`) — the exact gap triggers P (single-compound) and X (whole
   * branch) do NOT cover, so on dev such a crossing was SILENTLY DROPPED in nested
   * mode. `bubble` = the deepest ancestor `&` the span reaches (`maxBnd`): the rule
   * hoists out of that many enclosing blocks; `drop` = the leading wrapper-ancestor
   * segments (`bnd > maxBnd`) the enclosing blocks re-supply and the header strips.
   */
  const crossOf = new Map<PlanSubject, { bubble: number; drop: number }>();
  const detectCrossHoist = (s: PlanSubject): { bubble: number; drop: number } | null => {
    if (s.parent === null) {
      return null;
    }
    const raw = rawOf(s);
    let maxBnd = 0;
    for (const inst of reachingOf(s)) {
      /*
       * Single-compound (one segment) can never straddle the boundary; whole-branch
       * matches stay with trigger X (which keeps the extender-descends-from-parent
       * guard the match span alone cannot express).
       */
      if (!inst.partial || inst.target.segments.length < 2) {
        continue;
      }
      for (const b of raw) {
        if (branchWholeMatches(b, inst.target, inst.partial)) {
          continue;
        }
        const span = matchBoundarySpan(b, inst.target, inst.partial);
        if (span.boundary === 'crossing' && span.maxBnd > maxBnd) {
          maxBnd = span.maxBnd;
        }
      }
    }
    if (maxBnd === 0) {
      return null;
    }

    /*
     * The ancestor prefix is shared across a subject's own-local alternatives (same
     * `s.path`), so the wrapper-segment count reads off any composed branch.
     */
    return { bubble: maxBnd, drop: leadingWrapperSegs(raw[0]!, maxBnd) };
  };
  for (const s of plan.subjects) {
    /*
     * Only candidates can flatten (a non-candidate has no seed on its path, so
     * ownMode is 'none' and no ancestor collapsed); leave them out of the map so they
     * take the cheap default. Document order guarantees the parent's mode is decided
     * first for the cascade read.
     */
    if (!candidate.has(s)) {
      continue;
    }
    const own = ownMode(s);
    if (own !== 'none') {
      flattenModeOf.set(s, own);
    } else if (s.parent !== null && flattenModeOf.get(s.parent) === 'collapse') {
      flattenModeOf.set(s, 'collapse');
    } else {
      const cross = detectCrossHoist(s);
      if (cross) {
        crossOf.set(s, cross);
      }
    }
  }

  const isFlattened = (s: PlanSubject): boolean => flattenModeOf.has(s);
  const hasSurvivingChild = (s: PlanSubject): boolean =>
    (childrenOf.get(s) ?? []).some(c => !isFlattened(c));

  // ---- per-subject nested header + splits ----
  for (const s of plan.subjects) {
    if (!candidate.has(s)) {
      /*
       * Non-candidate: the DEFAULT entry. A top-level rule never reads `nestedPlan`
       * (it renders through `flatByRule`/`rawComposed`), so it needs nothing. A
       * nested non-candidate gets its authored own-local header — byte-identical to
       * the `runFixpoint(ownLocal, [])` the affected path would compute, but with no
       * `composePath`/solve. (Absent this entry the serializer would fall back to its
       * native `ownStrings`; we keep the IR header to match the affected path
       * exactly.)
       */
      if (s.parent !== null) {
        projectionFor(s).nestedPlan.set(s.rule, {
          flatten: false,
          header: s.ownLocal.map(branchOut),
          splits: []
        });
      }
      continue;
    }
    const mode = flattenModeOf.get(s);
    if (mode !== undefined) {
      /*
       * hoisted header = flat solve with sibling :is()-compaction.
       * Flattened nested rule: its hoisted header carries a shared parent-composition
       * prefix, so a child comma-list under one parent DOES compact across segments
       * (extend-exact `:is(<parent>) :is(.replace, .c)`).
       */
      const hoisted = extendedHeaderTexts(s, groupedBranches(siblingCompact(nestingFold(flatBySubject.get(s)!, s, rawOf(s), guardedNesting), true), true));
      projectionFor(s).hoistHeader.set(s.rule, hoisted);

      /*
       * The hoisted header is the FULL flat composition, a top-level selector, so the
       * rule rises out of every enclosing rule block (`s.path` holds one level per
       * enclosing rule). Rising one block left a deeper rule inside its grandparent
       * with the grandparent's selector repeated in its header.
       */
      const hoistBubble = s.path.length - 1;
      if (mode === 'renest') {
        /*
         * RE-NEST: emit the subtree at the hoist position with the composed cross-`&`
         * header, children stay literal-nested. `flatten` still defers it to the
         * enclosing block's hoist queue; `hoistNested` picks the nested emission.
         */
        projectionFor(s).nestedPlan.set(s.rule, { flatten: true, hoistNested: true, header: hoisted, splits: [], hoistBubble });
      } else {
        projectionFor(s).nestedPlan.set(s.rule, { flatten: true, header: [], splits: [], hoistBubble });
      }
      continue;
    }
    const cross = crossOf.get(s);
    if (cross !== undefined) {
      /*
       * [&-boundary] PER-BOUNDARY crossing hoist: emit the rule NESTED `bubble` levels
       * up (the serializer's re-hoist queue rises it out of the crossed blocks), with
       * the flat solve's leading wrapper-ancestor segments STRIPPED — the enclosing
       * blocks re-supply that prefix, so the header renders once, not twice. `drop === 0`
       * (the span reaches the outermost ancestor) hoists the whole rule to root with the
       * full flat header, exactly like the trigger-P/X path.
       */
      const solved = flatBySubject.get(s)!;
      const subPath = cross.drop > 0 ? solved.map(b => dropLeadingSegs(b, cross.drop)) : solved;
      const header = extendedHeaderTexts(s, groupedBranches(siblingCompact(subPath, true), cross.drop === 0));
      projectionFor(s).nestedPlan.set(s.rule, {
        flatten: true, hoistNested: true, header, splits: [], hoistBubble: cross.bubble
      });
      continue;
    }

    /*
     * A collapsed `&&` child is keyed on its COMPOSED complex, so it takes the
     * top-level path (exact matches fold/split against the composed form, not the
     * literal `&&`).
     */
    const asTop = s.parent === null || collapsedChild.has(s);
    const reaching = reachingOf(s);
    const survivors = hasSurvivingChild(s);
    let header: Branch[];
    const splits: Branch[] = [];
    const rootSplits: Branch[] = [];
    if (asTop) {
      /*
       * A top-level rule's header is its FULL flat solve (so transitive chaining +
       * sub-part substitution carry), minus any EXACT extender that folds into a
       * whole-complex match but cannot carry surviving nested children — those
       * SPLIT to sibling rules with the target's direct declarations. Match the
       * exact target against the rule's COMPOSED complex (identical to own-local
       * for a real top rule; the composed `.e.e` for a collapsed `&&` child).
       */
      const identity = rawOf(s);
      if (survivors) {
        for (const inst of reaching) {
          if (inst.partial) {
            continue;
          }
          if (identity.some(b => branchText(b) === branchText(inst.target))) {
            for (const e of composePath(inst.extenderPath)) {
              splits.push(e);
            }
          }
        }
      }
      const splitKeys = new Set(splits.map(branchText));
      header = flatBySubject.get(s)!.filter(b => !splitKeys.has(branchText(b)));

      /*
       * A rule the extend changed compacts its siblings (§7c) exactly as its flat
       * header (`flatByRule`) does: extend's grouping is the same in every output mode.
       */
      if (projectionFor(s).flatByRule.has(s.rule)) {
        header = siblingCompact(header, false);
      }
    } else {
      /*
       * A surviving nested rule: rewrite ONLY the own-local selector with the
       * child-side `all`-matches (whole-segment → comma; sub-compound → `:is()`);
       * parent-context and exact matches are handled by the parent / flatten.
       */
      const applied = reaching
        .filter((inst) => {
          const single = branchSingleCompound(inst.target);
          return inst.partial && single !== null && compoundHitsLevel(single, s.ownLocal);
        })

        /*
         * [fold] re-express each extender RELATIVE to this subject's parent context —
         * a sibling under a shared ancestor folds as its own-local remainder
         * (`.attribute-test`), not the double-prefixed full path.
         */
        .map(inst => relativizeExtender(inst, s, false));
      header = runFixpoint(s.ownLocal.map(cloneBranch), applied, buildContribs(applied)).list;

      /*
       * A match of the rule's whole composed selector by an extender nested under the
       * same parent (`.w { .y { &:extend(.w .k); } .k {} }`; trigger X kept it here,
       * since it descends from the parent) folds in as that extender's own-local
       * remainder, `.y` beside `.k` (an exact one SPLITS when the rule has children).
       * An extender that shares no parent level is not foldable here.
       */
      const raw = rawOf(s);
      for (const inst of reaching) {
        if (!raw.some(b => branchWholeMatches(b, inst.target, inst.partial))) {
          continue;
        }
        const rel = relativizeExtender(inst, s, true);
        if (rel === inst) {
          /*
           * An exact extender that shares no level with the rule's ancestors, into a
           * rule with children (trigger X left it here to split, §7b): its split block
           * carries the full extender header, so it rises out of every rule block the
           * rule nests in (`.a { .b { y: 1; .c {…} } } .q:extend(.a .b) {}` writes
           * `.q { y: 1; }` beside `.a`).
           */
          if (!inst.partial && survivors) {
            for (const e of composePath(inst.extenderPath)) {
              rootSplits.push(e);
            }
          }
          continue;
        }
        const into = !inst.partial && survivors ? splits : header;
        for (const e of composePath(rel.extenderPath)) {
          into.push(e);
        }
      }
    }

    /* A list the author wrote and no extend rewrote is left as written (ledger O10). */
    const grouped = groupedBranches(header, s.parent === null);
    const rewritten = asTop
      ? projectionFor(s).flatByRule.has(s.rule)
      : grouped.length !== s.ownLocal.length || grouped.some((b, i) => branchOut(b) !== branchOut(s.ownLocal[i]!));
    projectionFor(s).nestedPlan.set(s.rule, {
      flatten: false,
      header: rewritten ? extendedHeaderTexts(s, grouped) : grouped.map(branchOut),
      splits: dedupBranchTexts(splits).map(t => [t]),
      rootSplits: rootSplits.length === 0 ? NO_ROOT_SPLITS : dedupBranchTexts(rootSplits).map(t => [t]),
      collapseTransparent: collapsedParent.has(s.rule)
    });
  }

  return {
    flatByRule,
    hiddenByRule,
    suffixedByRule: staticProjection.suffixedByRule,
    visibleReferenceAtRules: staticProjection.visibleReferenceAtRules,
    visibleReferenceRuleAncestors: staticProjection.visibleReferenceRuleAncestors,
    bubbleHeaders: staticProjection.bubbleHeaders,
    nestedPlan,
    hoistHeader,
    byPlacement,
    targetAtoms: plan.targetAtoms
  };
}
