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
  multisetSubset,
  simpleText,
  textSimples,
} from './ir.js';
import type { Branch, Compound, Level, Simple } from './ir.js';
import { composePath } from './compose.js';
import { collectPlan, documentHasExtend, reaches } from './plan.js';
import type { PlanInstruction, PlanSubject } from './plan.js';
import { buildContribs, isExtendPrefilterEnabled, runFixpoint, solveComposed } from './solve.js';
import type { Root, Rule, Statement } from '../nodes.js';

export interface NestedRulePlan {
  /** Emit this rule (and its descendants) via the flat path at top level. */
  flatten: boolean;
  /** The rewritten own-local header branch texts (when not flattened). */
  header: string[];
  /** Sibling rules (target's direct decls only) to emit after this rule's block —
   * split-out exact extenders that cannot carry the rule's nested children. */
  splits: string[][];
  /**
   * A decl-less parent whose single child is a pure-`&` self-compound (`.e { &&
   * {…} }`) is TRANSPARENT: it emits no wrapper of its own; the child is emitted
   * at the parent's level with `&` composed against the parent (`&&` → `.e.e`).
   */
  collapseTransparent?: boolean;
}

export interface ExtendResults {
  /**
   * FLAT mode: per-rule EXTENDED, fully-composed header branch strings. The
   * serializer emits these as the rule's header (children still compose against
   * the RAW parent and extend independently — the composed model needs no
   * child-parent propagation).
   */
  flatByRule: Map<Rule, string[]>;
  /** NESTED mode: per-rule projection (flatten / rewritten header / splits). */
  nestedPlan: Map<Rule, NestedRulePlan>;
  /**
   * NESTED mode: per-rule FLAT header branches to use when a rule is hoisted to
   * top level — the flat composition with sibling `:is()`-compaction applied.
   */
  hoistHeader: Map<Rule, string[]>;
}

/* ------------------------------------------------------ sibling compaction */

/** The single compound of a one-segment branch, or null. */
function branchSingleCompound(b: Branch): Compound | null {
  return b.segs.length === 1 ? b.segs[0]!.compound : null;
}

/** True when `target`'s text-simples are ⊆ some compound in `level`. */
function compoundHitsLevel(target: Compound, level: Level): boolean {
  const need = textSimples(target);
  if (need.length === 0) return false;
  for (const b of level) {
    for (const seg of b.segs) {
      if (multisetSubset(need, textSimples(seg.compound))) return true;
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
    if (b === h) return true;
    if (b.startsWith(h)) {
      const next = b[h.length]!;
      if (' .#:[>+~&'.includes(next)) return true;
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
 */
function siblingCompact(branches: Branch[]): Branch[] {
  const out = branches.map(cloneBranch);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const merged = tryMergeSiblings(out[i]!, out[j]!);
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
 * differ in structure or in more than one compound. */
function tryMergeSiblings(a: Branch, b: Branch): Branch | null {
  if (a.segs.length !== b.segs.length) return null;
  let diff = -1;
  for (let i = 0; i < a.segs.length; i++) {
    const as = a.segs[i]!;
    const bs = b.segs[i]!;
    if (as.comb !== bs.comb) return null;
    if (compoundText(as.compound) !== compoundText(bs.compound)) {
      if (diff !== -1) return null;
      diff = i;
    }
  }
  if (diff === -1) return null;
  // Merge the differing compound into `:is()`. When the branch is a single segment
  // (no shared segment context), only merge if the compounds share a suffix — two
  // whole branches sharing NOTHING (`.ext8.ext9` / `.fuu`) stay a comma list.
  const merged = mergeCompoundsToIs(a.segs[diff]!.compound, b.segs[diff]!.compound, a.segs.length > 1);
  if (!merged) return null;
  const segs = a.segs.map((s, i) => (i === diff ? { comb: s.comb, compound: merged } : cloneSeg(s)));
  return { segs };
}

/**
 * Merge two compounds that share a common suffix into `:is(<lead-a>, <lead-b>)<suffix>`.
 * `.button` / `.submit` (no shared suffix) → `:is(.button, .submit)`.
 * `.replace` / `.c` → `:is(.replace, .c)`.
 * An existing leading `:is(...)` on either side is flattened into the new group.
 */
function mergeCompoundsToIs(a: Compound, b: Compound, allowNoSuffix: boolean): Compound | null {
  // Find the longest shared trailing simple run (by text).
  const as = a.simples;
  const bs = b.simples;
  let suffix = 0;
  while (
    suffix < as.length &&
    suffix < bs.length &&
    simpleText(as[as.length - 1 - suffix]!) === simpleText(bs[bs.length - 1 - suffix]!)
  ) {
    suffix++;
  }
  if (suffix === 0 && !allowNoSuffix) return null;
  const aLead = as.slice(0, as.length - suffix);
  const bLead = bs.slice(0, bs.length - suffix);
  if (aLead.length === 0 || bLead.length === 0) return null;
  const leadBranch = (lead: Simple[]): Branch[] => {
    // A single leading `:is(...)` flattens into the merged group.
    if (lead.length === 1 && lead[0]!.t === 'is') return lead[0]!.branches.map(cloneBranch);
    return [descendantBranch(lead.map(cloneSimple))];
  };
  const isGroup = isSimple([...leadBranch(aLead), ...leadBranch(bLead)]);
  const suffixSimples = as.slice(as.length - suffix).map(cloneSimple);
  return { simples: [isGroup, ...suffixSimples] };
}

/* ---------------------------------------------------------------- top level */

/**
 * Compute extend results for a parsed AST root. Returns `null` when the
 * document has NO `:extend()` at all (the serializer's zero-cost gate).
 */
export function computeExtends(root: Root): ExtendResults | null {
  // Zero-cost gate: an allocation-free pre-scan short-circuits the common case (no
  // `:extend()` anywhere) before any subject/instruction plan is built.
  if (!documentHasExtend(root)) return null;
  const plan = collectPlan(root);
  if (plan.instructions.length === 0) return null;

  const flatByRule = new Map<Rule, string[]>();
  const nestedPlan = new Map<Rule, NestedRulePlan>();
  const hoistHeader = new Map<Rule, string[]>();

  // LAZY + MEMOIZED composePath. `composePath(s.path)` (full ancestor fold + Branch-
  // IR allocation) is THE expensive primitive; it is computed at most once per
  // subject and ONLY for subjects a candidate actually needs (candidates + the
  // parents a flatten trigger reads). A non-candidate never referenced here is
  // never composed.
  const rawCache = new Map<PlanSubject, Branch[]>();
  const rawOf = (s: PlanSubject): Branch[] => {
    let r = rawCache.get(s);
    if (r === undefined) {
      r = composePath(s.path);
      rawCache.set(s, r);
    }
    return r;
  };

  const reachingOf = (s: PlanSubject): PlanInstruction[] =>
    plan.instructions.filter((i) => reaches(i.scope, s.scope));

  const childrenOf = new Map<PlanSubject, PlanSubject[]>();
  for (const s of plan.subjects) {
    if (s.parent) (childrenOf.get(s.parent) ?? childrenOf.set(s.parent, []).get(s.parent)!).push(s);
  }

  // ---- decl-less `&&` self-collapse (`.e { && {…} }` → `.e.e { … }`) ----
  // A decl-less parent whose ONLY emitting statement is a single child rule whose
  // own-local is a pure-`&` self-compound (`&&`, `&&&`) is TRANSPARENT: it emits
  // no wrapper; the child is emitted at the parent's level with `&` composed
  // against the parent (so the child behaves like a top-level rule keyed on its
  // COMPOSED complex). This is a general nested-emit collapse, gated tightly so it
  // does not disturb ordinary nesting.
  const collapsedParent = new Set<Rule>();
  const collapsedChild = new Set<PlanSubject>();
  const isPureAmpSelfCompound = (s: PlanSubject): boolean => {
    if (s.ownLocal.length !== 1) return false;
    const br = s.ownLocal[0]!;
    if (br.segs.length !== 1) return false;
    const simples = br.segs[0]!.compound.simples;
    return simples.length >= 2 && simples.every((x) => x.t === 'text' && x.text === '&');
  };
  for (const p of plan.subjects) {
    let onlyRule: Statement | null = null;
    let bail = false;
    for (const st of p.rule.body) {
      if (st.type === 'MixinDef' || st.type === 'VarDeclaration') continue;
      if (st.type === 'Rule' && onlyRule === null) {
        onlyRule = st;
        continue;
      }
      bail = true; // a direct decl/comment/mixin-call/at-rule, or a second rule
      break;
    }
    if (bail || onlyRule === null) continue;
    const kids = childrenOf.get(p) ?? [];
    if (kids.length !== 1) continue;
    const c = kids[0]!;
    if (c.rule !== onlyRule || !isPureAmpSelfCompound(c)) continue;
    collapsedParent.add(p.rule);
    collapsedChild.add(c);
  }

  // ---- candidate set C (the prune) ----
  // A rule receives a NON-DEFAULT map entry only inside the extend-touched region.
  // SEEDS are the rules that can originate a change/flatten: a may-match subject, a
  // nested rule carrying its own `:extend()` (trigger B), or a `&&` self-collapse
  // pair. C is the DOWNWARD closure of the seeds (flatten cascades to descendants):
  // a subject is a candidate iff it or any ancestor is a seed. Everything else gets
  // the cheap default and is proven (EXTEND-REDESIGN.md §2) to need nothing more.
  // The prune is gated by the same flag as the solve prefilter so the OFF path is a
  // full scan (every subject a candidate) — the differential-soundness reference.
  const pruneOn = isExtendPrefilterEnabled();
  const isSeed = (s: PlanSubject): boolean =>
    s.mayMatch ||
    (s.parent !== null && s.rule.extendInstructions !== undefined && s.rule.extendInstructions.length > 0) ||
    collapsedParent.has(s.rule) ||
    collapsedChild.has(s);
  const candidate = new Set<PlanSubject>();
  for (const s of plan.subjects) {
    // document (pre-)order ⇒ parent precedes child, so the ancestor's membership is
    // already decided when the closure test reads it.
    if (!pruneOn || isSeed(s) || (s.parent !== null && candidate.has(s.parent))) candidate.add(s);
  }

  // ---- FLAT solve, candidates ONLY ----
  const flatBySubject = new Map<PlanSubject, Branch[]>();
  for (const s of plan.subjects) {
    if (!candidate.has(s)) continue;
    const { list: flat, changed } = solveComposed(rawOf(s), s, plan);
    flatBySubject.set(s, flat);
    // A rule the extend engine actually changed emits its EXTENDED header with
    // sibling `:is()`-compaction (`.button:hover, .submit:hover` →
    // `:is(.button, .submit):hover`); an unchanged rule keeps its authored form.
    if (changed) flatByRule.set(s.rule, siblingCompact(flat).map(branchText));
  }

  /** The `all`-extender folds that alias a parent's whole complex (deterministic —
   * independent of the split/children decisions), plus the raw parent branches.
   * This is the set a nested child may descend from without crossing the `&`. */
  const parentHeaderSet = (p: PlanSubject): Branch[] => {
    const raw = rawOf(p);
    const keys = new Set(raw.map(branchText));
    const out = raw.slice();
    for (const inst of reachingOf(p)) {
      if (inst.partial && keys.has(branchText(inst.target))) out.push(...composePath(inst.extenderPath));
    }
    return out;
  };

  // ---- flatten decision (top-down; cascades to descendants) ----
  const flattenOf = new Map<PlanSubject, boolean>();
  const ownFlatten = (s: PlanSubject): boolean => {
    if (s.parent === null) return false;
    // trigger B: a nested rule that itself carries an extend crosses the `&`.
    if (s.rule.extendInstructions && s.rule.extendInstructions.length > 0) return true;
    const parentRaw = rawOf(s.parent);
    const parentKeys = new Set(parentRaw.map(branchText));
    // trigger P: an `all`-extender aliasing the parent whole complex whose target
    // does NOT also hit the child's own local compound (foreign parent-context
    // alias — the parent context changed under the child, so it cannot stay local).
    for (const inst of reachingOf(s)) {
      const single = branchSingleCompound(inst.target);
      if (inst.partial && single && parentKeys.has(branchText(inst.target))) {
        if (!compoundHitsLevel(single, s.ownLocal)) return true;
      }
    }
    // trigger X: a STRUCTURAL LEAF whose flat solve gained a whole-complex sibling
    // that does not descend from the parent header (a hoisted sibling branch, e.g.
    // `.ext8 .ext9, .buu`). A rule WITH surviving children instead SPLITS the
    // extender and stays nested, so X is gated on being a leaf.
    if ((childrenOf.get(s) ?? []).length === 0) {
      const headerSet = parentHeaderSet(s.parent).map(branchText);
      for (const b of flatBySubject.get(s)!) {
        if (!descendsFrom(branchText(b), headerSet)) return true;
      }
    }
    return false;
  };
  for (const s of plan.subjects) {
    // Only candidates can flatten (a non-candidate has no seed on its path, so
    // ownFlatten is false and no ancestor flattened); leave them out of the map so
    // they take the cheap default. Document order guarantees the parent's flatten is
    // decided first for the cascade read.
    if (!candidate.has(s)) continue;
    const f = ownFlatten(s) || (s.parent !== null && flattenOf.get(s.parent) === true);
    flattenOf.set(s, f);
  }

  const hasSurvivingChild = (s: PlanSubject): boolean =>
    (childrenOf.get(s) ?? []).some((c) => flattenOf.get(c) !== true);

  // ---- per-subject nested header + splits ----
  for (const s of plan.subjects) {
    if (!candidate.has(s)) {
      // Non-candidate: the DEFAULT entry. A top-level rule never reads `nestedPlan`
      // (it renders through `flatByRule`/`rawComposed`), so it needs nothing. A
      // nested non-candidate gets its authored own-local header — byte-identical to
      // the `runFixpoint(ownLocal, [])` the affected path would compute, but with no
      // `composePath`/solve. (Absent this entry the serializer would fall back to its
      // native `ownStrings`; we keep the IR header to match the affected path
      // exactly.)
      if (s.parent !== null) {
        nestedPlan.set(s.rule, {
          flatten: false,
          header: s.ownLocal.map(branchText),
          splits: [],
        });
      }
      continue;
    }
    const flatten = flattenOf.get(s) === true;
    if (flatten) {
      nestedPlan.set(s.rule, { flatten: true, header: [], splits: [] });
      // hoisted header = flat solve with sibling :is()-compaction.
      hoistHeader.set(s.rule, siblingCompact(flatBySubject.get(s)!).map(branchText));
      continue;
    }
    // A collapsed `&&` child is keyed on its COMPOSED complex, so it takes the
    // top-level path (exact matches fold/split against the composed form, not the
    // literal `&&`).
    const asTop = s.parent === null || collapsedChild.has(s);
    const reaching = reachingOf(s);
    const survivors = hasSurvivingChild(s);
    let header: Branch[];
    const splits: Branch[] = [];
    if (asTop) {
      // A top-level rule's header is its FULL flat solve (so transitive chaining +
      // sub-part substitution carry), minus any EXACT extender that folds into a
      // whole-complex match but cannot carry surviving nested children — those
      // SPLIT to sibling rules with the target's direct declarations. Match the
      // exact target against the rule's COMPOSED complex (identical to own-local
      // for a real top rule; the composed `.e.e` for a collapsed `&&` child).
      const identity = rawOf(s);
      if (survivors) {
        for (const inst of reaching) {
          if (inst.partial) continue;
          if (identity.some((b) => branchText(b) === branchText(inst.target))) {
            for (const e of composePath(inst.extenderPath)) splits.push(e);
          }
        }
      }
      const splitKeys = new Set(splits.map(branchText));
      header = flatBySubject.get(s)!.filter((b) => !splitKeys.has(branchText(b)));
    } else {
      // A surviving nested rule: rewrite ONLY the own-local selector with the
      // child-side `all`-matches (whole-segment → comma; sub-compound → `:is()`);
      // parent-context and exact matches are handled by the parent / flatten.
      const applied = reaching.filter((inst) => {
        const single = branchSingleCompound(inst.target);
        return inst.partial && single !== null && compoundHitsLevel(single, s.ownLocal);
      });
      header = runFixpoint(s.ownLocal.map(cloneBranch), applied, buildContribs(applied)).list;
    }
    nestedPlan.set(s.rule, {
      flatten: false,
      header: header.map(branchText),
      splits: dedupBranchTexts(splits).map((t) => [t]),
      collapseTransparent: collapsedParent.has(s.rule),
    });
  }

  return { flatByRule, nestedPlan, hoistHeader };
}
