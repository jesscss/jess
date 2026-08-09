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
 *
 * An EXACT extender that folds into a target which HAS surviving nested children
 * cannot carry those children (exact never propagates into sub-parts); it SPLITS
 * to a separate sibling rule with the target's DIRECT declarations only (empty →
 * dropped). `all`-extenders fold into the header and DO propagate to children.
 */

import {
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
  textSimpleTokens
} from './ir.js';
import type { Branch, Compound, Level, Simple } from './ir.js';
import { composePath } from './compose.js';
import { branchWholeMatches, matchBoundarySpan } from './match.js';
import { collectPlan, documentHasExtend, reaches } from './plan.js';
import type { PlanInstruction, PlanOverlay, PlanSubject } from './plan.js';
import { buildContribs, runFixpoint, solveComposed } from './solve.js';
import type { ContribMap } from './solve.js';
import type { Stylesheet, Ruleset, Statement } from '../nodes.js';
import { branchTextIsPlaceholder } from '../nodes.js';

export interface NestedRulePlan {
  /** Emit this rule (and its descendants) via the flat path at top level. */
  flatten: boolean;

  /** The rewritten own-local header branch texts (when not flattened). */
  header: string[];

  /** Sibling rules (target's direct decls only) to emit after this rule's block —
   * split-out exact extenders that cannot carry the rule's nested children. */
  splits: string[][];

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
   * [&-boundary] PER-BOUNDARY hoist distance: the number of enclosing rule blocks
   * this `hoistNested` rule must rise out of before it is emitted (the `maxBnd` of
   * the crossed span — the deepest ancestor `&` the extend match reaches). `1` (the
   * default when absent) is the classic single-level hoist trigger-P/X land on: the
   * rule emits at its immediate parent's level. `k > 1` bubbles it up `k` levels via
   * the serializer's re-hoist queue, so a match that crosses `k` nesting boundaries
   * leaves the strictly-outer `bnd > k` ancestors as wrappers (not blindly one level,
   * not always root). Its `header` is the flat solve with those wrapper ancestor
   * segments STRIPPED — the enclosing blocks re-supply them.
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
  nestedPlan: Map<Ruleset, NestedRulePlan>;
  hoistHeader: Map<Ruleset, string[]>;
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

function dedupBranchTexts(list: Branch[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of list) {
    const k = branchText(b);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
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

  /*
   * [import:reference] the merged branch is visible if EITHER source is visible (an
   * `:is(a, b)` emits its whole group). Only two hidden branches merge to hidden
   * (stamped after the factory, exactly as `cloneBranch` carries provenance).
   */
  const out = mkBranch(segments);
  if (a.hidden && b.hidden) {
    out.hidden = true;
  }
  return out;
}

/**
 * Merge two compounds that share a common suffix into `:is(<lead-a>, <lead-b>)<suffix>`.
 * `.button` / `.submit` (no shared suffix) → `:is(.button, .submit)`.
 * `.replace` / `.c` → `:is(.replace, .c)`.
 * An existing leading `:is(...)` on either side is flattened into the new group.
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
    // A single leading `:is(...)` flattens into the merged group.
    if (lead.length === 1 && lead[0]!.t === 'is') {
      return lead[0]!.branches.map(cloneBranch);
    }
    return [descendantBranch(lead.map(cloneSimple))];
  };
  const isGroup = isSimple([...leadBranch(aLead), ...leadBranch(bLead)]);
  const suffixTokens = as.slice(as.length - suffix).map(cloneSimple);
  return { value: [isGroup, ...suffixTokens] };
}

/* ------------------------------------------------- relative extender folding */

/** Number of leading ancestor levels two paths share BY REFERENCE (the plan walk
 * threads the SAME `Level` object into every descendant path, so identity encodes
 * a shared ancestor). */
function sharedPrefixLen(a: Level[], b: Level[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * Re-express an instruction's extender path RELATIVE to a nested subject's parent
 * context so a folded-in extender contributes its OWN-LOCAL remainder, not its
 * double-prefixed full composed path. An extender that shares the subject's parent
 * ancestor (`.attributes .attribute-test` folded into `.attributes [data="test"]`)
 * drops the shared levels → the sibling `.attribute-test`. A top-level extender
 * (`.rep_ace`, no shared ancestor) is unchanged. The strip is capped at the parent
 * context depth so a self-extend never slices the path empty.
 */
function relativizeExtender(inst: PlanInstruction, subject: PlanSubject): PlanInstruction {
  const drop = Math.min(sharedPrefixLen(subject.path, inst.extenderPath), subject.path.length - 1);
  if (drop === 0) {
    return inst;
  }
  return { ...inst, extenderPath: inst.extenderPath.slice(drop) };
}

/* ---------------------------------------------------------------- top level */

/**
 * Compute extend results for a parsed AST root. Returns `null` when the
 * document has NO `:extend()` at all (the serializer's zero-cost gate).
 */
export function computeExtends(
  root: Stylesheet,
  hiddenRules?: ReadonlySet<Ruleset>,
  referenceBoundaries?: ReadonlyMap<Ruleset, object>,
  overlay?: PlanOverlay
): ExtendResults | null {
  /*
   * Zero-cost gate: an allocation-free pre-scan short-circuits the common case (no
   * `:extend()` anywhere) before any subject/instruction plan is built.
   */
  if (!documentHasExtend(root) && (!overlay || overlay.instructions.length === 0)) {
    return null;
  }
  const plan = collectPlan(root, hiddenRules, referenceBoundaries, overlay);
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
  const staticProjection: ExtendPlacementResults = { flatByRule, hiddenByRule, nestedPlan, hoistHeader };
  let byPlacement: WeakMap<object, ExtendPlacementResults> | null = null;
  const projectionFor = (subject: PlanSubject): ExtendPlacementResults => {
    if (!subject.placement) {
      return staticProjection;
    }
    const all = byPlacement ??= new WeakMap<object, ExtendPlacementResults>();
    let projection = all.get(subject.placement);
    if (!projection) {
      projection = {
        flatByRule: new Map(), hiddenByRule: new Map(), nestedPlan: new Map(), hoistHeader: new Map()
      };
      all.set(subject.placement, projection);
    }
    return projection;
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
      r = composePath(s.path);

      /*
       * [import:reference] a hidden subject's own seed branches are hidden; a visible
       * extender folded in later carries its own (visible) provenance, so only the
       * all-hidden case drops the whole rule.
       */
      if (s.hidden) {
        for (const b of r) {
          b.hidden = true;
        }
      }

      /*
       * [placeholder] A placeholder seed branch is hidden PER BRANCH, not per
       * subject: `%ph, .a { … }` keeps `.a`. That granularity is why
       * `Ruleset.reference` could not be reused — it is a whole-rule flag.
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
    plan.instructions.filter(i =>
      (i.referenceBoundary === null || i.referenceBoundary === s.referenceBoundary)
      && reaches(i.scope, s.scope));

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
      const compacted = siblingCompact(flat, false);
      projectionFor(s).flatByRule.set(s.rule, compacted.map(branchText));

      /*
       * [import:reference] carry the per-branch visibility mask only when some branch
       * is hidden — a document with no reference imports never allocates it.
       */
      if (compacted.some(b => b.hidden)) {
        projectionFor(s).hiddenByRule.set(s.rule, compacted.map(b => b.hidden === true));
      }
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
          header: s.ownLocal.map(branchText),
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
      const hoisted = siblingCompact(flatBySubject.get(s)!, true).map(branchText);
      projectionFor(s).hoistHeader.set(s.rule, hoisted);
      if (mode === 'renest') {
        /*
         * RE-NEST: emit the subtree at the hoist position with the composed cross-`&`
         * header, children stay literal-nested. `flatten` still defers it to the
         * enclosing block's hoist queue; `hoistNested` picks the nested emission.
         */
        projectionFor(s).nestedPlan.set(s.rule, { flatten: true, hoistNested: true, header: hoisted, splits: [] });
      } else {
        projectionFor(s).nestedPlan.set(s.rule, { flatten: true, header: [], splits: [] });
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
       * full flat header, exactly like the always-root single-level trigger-P/X path.
       */
      const solved = flatBySubject.get(s)!;
      const subPath = cross.drop > 0 ? solved.map(b => dropLeadingSegs(b, cross.drop)) : solved;
      const header = siblingCompact(subPath, true).map(branchText);
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
        .map(inst => relativizeExtender(inst, s));
      header = runFixpoint(s.ownLocal.map(cloneBranch), applied, buildContribs(applied)).list;
    }
    projectionFor(s).nestedPlan.set(s.rule, {
      flatten: false,
      header: header.map(branchText),
      splits: dedupBranchTexts(splits).map(t => [t]),
      collapseTransparent: collapsedParent.has(s.rule)
    });
  }

  return { flatByRule, hiddenByRule, nestedPlan, hoistHeader, byPlacement };
}
