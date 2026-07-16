/**
 * Clean-room tree2 EXTEND engine (rung R1).
 *
 * BOUNDARY-CLEAN: this file imports NOTHING from the legacy `../tree`. It builds
 * a tiny tree2-native selector IR from `Complex`/`Compound` tokens (no node
 * cloning) and runs the PLAN / SOLVE / EMIT flow ported — as a SPEC, not an
 * import — from `tree/extend/{plan,solve,emit,extend-index}.ts`.
 *
 * PLAN   — walk the bridged tree2 tree, recording each rule's ancestor path +
 *          at-rule (media) scope, its own-local selector branches, and each
 *          `:extend()` instruction (target branch, partial flag, the extender
 *          rule's ancestor path, scope, document order).
 * SOLVE  — for every rule (subject), gather the instructions that REACH it
 *          (same-or-descendant scope) and drive a fixpoint over its own-local
 *          branch list: exact/whole-branch matches APPEND the extender branches;
 *          `all` sub-matches substitute the matched span IN PLACE with
 *          `:is(<matched span>, <extenders…>)`; produced branches re-route so a
 *          transitive/chained extend drains as more work. Fire-once + value
 *          dedup terminate; a branch equal to an extender is never self-wrapped.
 * EMIT   — the SOLVE result is each subject's EXTENDED own-local branch list; the
 *          serializer composes it with the parent exactly as authored nesting,
 *          so children of a multi-branch extended parent group via the existing
 *          `:is()` `parentToken` path.
 *
 * The engine matches the Jess-v5 `:is()`-COMPACTED cascade the real oracle
 * emits. Known divergences from renderRealOracle (owner items): the flat legacy
 * renderer contributes a nested extender as a BARE fragment where tree2 composes
 * it correctly; and `&`-crossing hoist-to-root is not modelled.
 */

import { Kind } from './node.js';
import type { Combinator } from './node.js';
import type {
  Complex,
  ExtendInstruction,
  Root,
  Rule,
  SelectorList,
  Statement,
} from './nodes.js';

/* ------------------------------------------------------------------- IR */

/** A simple-selector token: plain text (`.a`, `&`, `[x]`) or an `:is()` group. */
type Simple = { t: 'text'; text: string } | { t: 'is'; branches: Branch[] };

/** A run of simple tokens with no separator (`.a.b`). */
interface Compound {
  simples: Simple[];
}

/** One `(combinator, compound)` segment. The head segment's `comb` is the
 * leading combinator (`' '` when none). */
interface Seg {
  comb: Combinator;
  compound: Compound;
}

/** A complex selector branch: an ordered list of segments. */
interface Branch {
  segs: Seg[];
}

/** A selector list level (a rule's own-local alternatives / an `:is()` arg). */
type Level = Branch[];

/* --------------------------------------------------------- IR: serialize */

function renderCombinator(comb: Combinator): string {
  return comb === ' ' ? ' ' : ` ${comb} `;
}

function simpleText(s: Simple): string {
  if (s.t === 'text') return s.text;
  return `:is(${s.branches.map(branchText).join(', ')})`;
}

function compoundText(c: Compound): string {
  let out = '';
  for (const s of c.simples) out += simpleText(s);
  return out;
}

function branchText(b: Branch): string {
  let out = '';
  for (let i = 0; i < b.segs.length; i++) {
    const seg = b.segs[i]!;
    if (i === 0) {
      if (seg.comb !== ' ') out += renderCombinator(seg.comb).trimStart();
      out += compoundText(seg.compound);
    } else {
      out += renderCombinator(seg.comb) + compoundText(seg.compound);
    }
  }
  return out;
}

function branchHasAmp(b: Branch): boolean {
  for (const seg of b.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text') {
        if (s.text.includes('&')) return true;
      } else if (s.branches.some(branchHasAmp)) {
        return true;
      }
    }
  }
  return false;
}

/* --------------------------------------------------------- IR: from tree2 */

function compoundFromSimples(texts: string[]): Compound {
  return { simples: texts.map((text) => ({ t: 'text', text })) };
}

function branchFromComplex(c: Complex): Branch {
  const segs: Seg[] = [];
  // A selector token carrying `@{…}` interpolation has `text: null` (its concrete
  // text is only known once resolved in an entering frame, which the extend
  // engine has no access to). Represent it by its literal contribution (`''`),
  // matching `Compound.canonical()`'s `sim.text ?? ''` convention, so the IR is
  // always a plain string and no downstream `.includes`/`.split` hits null.
  segs.push({
    comb: c.leadingComb ?? ' ',
    compound: compoundFromSimples(c.head.simples.map((s) => s.text ?? '')),
  });
  for (const seg of c.tail) {
    segs.push({ comb: seg.comb, compound: compoundFromSimples(seg.compound.simples.map((s) => s.text ?? '')) });
  }
  return segs.length === 0 ? { segs: [{ comb: ' ', compound: { simples: [] } }] } : { segs };
}

function levelFromSelectorList(list: SelectorList): Level {
  return list.selectors.map(branchFromComplex);
}

/* ------------------------------------------------------- IR: clone helpers */

function cloneSimple(s: Simple): Simple {
  return s.t === 'text' ? { t: 'text', text: s.text } : { t: 'is', branches: s.branches.map(cloneBranch) };
}
function cloneBranch(b: Branch): Branch {
  return { segs: b.segs.map((seg) => ({ comb: seg.comb, compound: { simples: seg.compound.simples.map(cloneSimple) } })) };
}

/** An `:is(...)` simple wrapping the given branches. */
function isSimple(branches: Branch[]): Simple {
  return { t: 'is', branches: branches.map(cloneBranch) };
}

/* ----------------------------------------------------- composition (nesting) */

/** The parent token for composing a child under a multi-branch parent. */
function parentToken(parents: Branch[]): Branch {
  if (parents.length === 1) return cloneBranch(parents[0]!);
  return { segs: [{ comb: ' ', compound: { simples: [isSimple(parents)] } }] };
}

/** Compose one child branch under a parent token branch (mirrors serialize). */
function composeOne(parent: Branch, child: Branch): Branch {
  if (branchHasAmp(child)) return substituteAmp(child, parent);
  // Descendant: parent then space then child.
  return { segs: [...parent.segs.map(cloneSeg), ...prefixDescendant(child).segs] };
}

function cloneSeg(seg: Seg): Seg {
  return { comb: seg.comb, compound: { simples: seg.compound.simples.map(cloneSimple) } };
}

/** Ensure the child's head segment joins the parent with a descendant space. */
function prefixDescendant(child: Branch): Branch {
  const segs = child.segs.map(cloneSeg);
  if (segs.length > 0 && segs[0]!.comb === ' ') {
    // head already descendant-joinable
  }
  return { segs };
}

/**
 * Substitute every `&` text token in `child` with the parent selector. When the
 * parent is a MULTI-SEGMENT complex (a descendant selector such as `.a .b`) and
 * the `&` is FUSED into a compound alongside other simples, the parent is wrapped
 * in `:is(...)` so the compound stays a single element target (`.f&` under `.a .b`
 * → `.f:is(.a .b)`, not `.f.a .b`). A standalone `&` (the whole compound) or a
 * single-compound parent substitutes the parent's bare text.
 */
function substituteAmp(child: Branch, parent: Branch): Branch {
  const parentStr = branchText(parent);
  const parentMultiSeg = parent.segs.length > 1;
  const segs = child.segs.map((seg) => {
    const fused = seg.compound.simples.length > 1;
    const wrap = parentMultiSeg && fused;
    const simples: Simple[] = [];
    for (const s of seg.compound.simples) {
      if (s.t === 'text' && s.text.includes('&')) {
        if (wrap) {
          // Splice `:is(parent)` in place of each `&`, preserving any fused text.
          const parts = s.text.split('&');
          for (let i = 0; i < parts.length; i++) {
            if (parts[i]!.length > 0) simples.push({ t: 'text', text: parts[i]! });
            if (i < parts.length - 1) simples.push(isSimple([parent]));
          }
        } else {
          simples.push({ t: 'text', text: s.text.split('&').join(parentStr) });
        }
      } else {
        simples.push(cloneSimple(s));
      }
    }
    return { comb: seg.comb, compound: { simples } };
  });
  return { segs };
}

/** Compose a child selector list under a parent selector list. */
function composeLevel(childBranches: Branch[], parentBranches: Branch[]): Branch[] {
  const token = parentToken(parentBranches);
  return childBranches.map((c) => composeOne(token, c));
}

/**
 * Compose an ancestor path (outermost → own local) into a flat selector list,
 * wrapping a multi-branch inner level in `:is(...)` before composing (so the
 * parent is not distributed across the group).
 */
function composePath(levels: Level[]): Branch[] {
  let result = levels[0]!.map(cloneBranch);
  for (let i = 1; i < levels.length; i++) {
    const child = levels[i]!;
    result = composeLevel(child, result);
  }
  return result;
}

/* ------------------------------------------------------- match / construct */

/** Multiset of a compound's plain-text simples (ignores `:is` grafts). */
function textSimples(c: Compound): string[] {
  const out: string[] = [];
  for (const s of c.simples) if (s.t === 'text') out.push(s.text);
  return out;
}

/**
 * Collect every individual plain-text simple atom in a branch into `out`,
 * RECURSING into `:is()` grafts. This is the atom granularity/normalization the
 * matcher actually uses: compounds are split per-simple (`.a.b` → `.a`, `.b`,
 * exactly like `textSimples`/`multisetSubset`), grafts are walked so simples that
 * only appear inside an `:is()` (`:is(.p1, .p2) .c` → `.p1`, `.p2`, `.c`, the very
 * atoms `branchExpansions`/`recurseIntoGrafts` reach) are captured — never dropped
 * the way `textSimples` drops grafts. Text is taken RAW (case-sensitive, no
 * trim/fold), the same `branchFromComplex` → `s.text ?? ''` value both sides carry.
 */
function collectBranchAtoms(b: Branch, out: Set<string>): void {
  for (const seg of b.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text') out.add(s.text);
      else for (const inner of s.branches) collectBranchAtoms(inner, out);
    }
  }
}

/**
 * True when some atom of `branch` (graft-recursive, per the same extraction as
 * `collectBranchAtoms`) is in `atoms`. Direct set-intersection — no per-subject
 * atom Set is allocated. Used by the target-atom PREFILTER to prove a subject's
 * seed can neither match nor chain any instruction target before running solve.
 */
function branchSharesAtom(b: Branch, atoms: Set<string>): boolean {
  for (const seg of b.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text') {
        if (atoms.has(s.text)) return true;
      } else if (s.branches.some((inner) => branchSharesAtom(inner, atoms))) {
        return true;
      }
    }
  }
  return false;
}

/** True when `need` (multiset) ⊆ `have` (multiset). */
function multisetSubset(need: string[], have: string[]): boolean {
  const counts = new Map<string, number>();
  for (const h of have) counts.set(h, (counts.get(h) ?? 0) + 1);
  for (const n of need) {
    const c = counts.get(n) ?? 0;
    if (c <= 0) return false;
    counts.set(n, c - 1);
  }
  return true;
}

/**
 * Apply one instruction to a selector list (a rule's branches OR an `:is()`
 * arg). Returns a new list when it changed, else null.
 *   - whole-branch match (exact & all): append extender branches (dedup).
 *   - all sub-match: substitute the matched span in place with `:is(span, ext)`.
 *   - recurse into `:is()` grafts.
 * `extenderKeys` are the extenders' texts (self-avoidance: never wrap a branch
 * that IS an extender contribution).
 */
function applyInstruction(
  list: Branch[],
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
): Branch[] | null {
  const targetKey = branchText(target);
  const out: Branch[] = [];
  const appends: Branch[] = [];
  let changed = false;

  for (const b of list) {
    const bKey = branchText(b);
    // Whole-branch match → append extenders as siblings. A multi-segment target
    // also matches an `:is()`-grafted branch whose expansion equals the target
    // (`.replace.replace .replace` vs `:is(.replace.replace, …) .replace`).
    if (bKey === targetKey || (target.segs.length > 1 && branchExpansions(b).includes(targetKey))) {
      out.push(b);
      for (const e of extenders) appends.push(e);
      continue;
    }
    if (partial && !extenderKeys.has(bKey)) {
      const rewritten = rewriteBranchPartial(b, target, extenders, partial, extenderKeys);
      if (rewritten) {
        out.push(rewritten);
        changed = true;
        continue;
      }
    }
    out.push(b);
  }

  if (appends.length > 0) {
    const present = new Set(out.map(branchText));
    for (const e of appends) {
      const k = branchText(e);
      if (!present.has(k)) {
        out.push(e);
        present.add(k);
        changed = true;
      }
    }
  }
  return changed ? out : null;
}

/**
 * Rewrite ONE branch for an `all` sub-match: substitute the matched span in
 * place, and recurse into any `:is()` grafts. Returns a new branch if changed.
 */
function rewriteBranchPartial(
  b: Branch,
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
): Branch | null {
  const before = branchText(b);
  let work = cloneBranch(b);

  // (1) recurse into `:is()` grafts (transitive chaining lives inside them).
  work = recurseIntoGrafts(work, target, extenders, partial, extenderKeys);

  // (2) span substitution against the (possibly graft-updated) branch.
  const P = target.segs.length;
  if (P === 1) {
    work = substituteSingleCompound(work, target.segs[0]!.compound, extenders);
  } else {
    work = substituteMultiCompound(work, target, extenders);
  }

  return branchText(work) !== before ? work : null;
}

/** Recurse an instruction into every `:is()` graft simple in the branch. */
function recurseIntoGrafts(
  b: Branch,
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
): Branch {
  return {
    segs: b.segs.map((seg) => ({
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.map((s): Simple => {
          if (s.t !== 'is') return s;
          const inner = applyInstruction(s.branches, target, extenders, partial, extenderKeys);
          return inner ? { t: 'is', branches: inner } : s;
        }),
      },
    })),
  };
}

/** Substitute a single-compound target inside every matching compound. */
function substituteSingleCompound(b: Branch, targetCompound: Compound, extenders: Branch[]): Branch {
  const need = textSimples(targetCompound);
  const needSet = new Set(need);
  const segs = b.segs.map((seg) => {
    const have = textSimples(seg.compound);
    if (!multisetSubset(need, have)) return seg;
    if (need.length > 1) {
      return { comb: seg.comb, compound: collapseMatchedAtoms(seg.compound, needSet, targetCompound, extenders) };
    }
    // single-simple target: wrap each matched slot individually.
    return {
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.map((s): Simple =>
          s.t === 'text' && needSet.has(s.text) ? isSimple([{ segs: [{ comb: ' ', compound: { simples: [cloneSimple(s)] } }] }, ...extenders]) : cloneSimple(s),
        ),
      },
    };
  });
  return { segs };
}

/** Collapse contiguous matched atoms into one `:is(<matched>, ext)`, keep the rest. */
function collapseMatchedAtoms(
  compound: Compound,
  needSet: Set<string>,
  targetCompound: Compound,
  extenders: Branch[],
): Compound {
  const matchedText = compoundText(targetCompound);
  const matchedBranch: Branch = { segs: [{ comb: ' ', compound: { simples: [{ t: 'text', text: matchedText }] } }] };
  const out: Simple[] = [];
  let placed = false;
  for (const s of compound.simples) {
    if (s.t === 'text' && needSet.has(s.text)) {
      if (!placed) {
        out.push(isSimple([matchedBranch, ...extenders]));
        placed = true;
      }
      // subsequent matched atoms are subsumed by the :is()
    } else {
      out.push(cloneSimple(s));
    }
  }
  return { simples: out };
}

/**
 * Substitute a multi-compound (P>1) target span in place. Finds a contiguous
 * segment run whose compounds each superset the target compounds and whose
 * internal combinators align; collapses the span into one `:is(span, ext)`.
 */
function substituteMultiCompound(b: Branch, target: Branch, extenders: Branch[]): Branch {
  const P = target.segs.length;
  const segs = b.segs;
  for (let start = 0; start + P <= segs.length; start++) {
    let ok = true;
    for (let k = 0; k < P; k++) {
      const ts = target.segs[k]!;
      const bs = segs[start + k]!;
      if (!multisetSubset(textSimples(ts.compound), textSimples(bs.compound))) {
        ok = false;
        break;
      }
      if (k > 0 && ts.comb !== bs.comb) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // Build the matched span text (segments start..start+P-1, internal combinators).
    const spanSegs: Seg[] = [];
    for (let k = 0; k < P; k++) {
      const bs = segs[start + k]!;
      spanSegs.push({ comb: k === 0 ? ' ' : bs.comb, compound: { simples: bs.compound.simples.map(cloneSimple) } });
    }
    const spanBranch: Branch = { segs: spanSegs };
    const isSeg: Seg = {
      comb: start === 0 ? ' ' : segs[start]!.comb,
      compound: { simples: [isSimple([spanBranch, ...extenders])] },
    };
    const outSegs: Seg[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (i < start || i >= start + P) outSegs.push(cloneSeg(segs[i]!));
      else if (i === start) outSegs.push(isSeg);
    }
    return { segs: outSegs };
  }
  return b;
}

/* --------------------------------------------------------------- PLAN walk */

interface PlanInstruction {
  target: Branch;
  partial: boolean;
  extenderPath: Level[];
  scope: number[];
  order: number;
}

interface PlanSubject {
  rule: Rule;
  path: Level[];
  scope: number[];
  /** The authored own-local selector level (last entry of `path`). */
  ownLocal: Level;
  /** The enclosing authored subject rule, or null at the top level. */
  parent: PlanSubject | null;
}

interface Plan {
  subjects: PlanSubject[];
  instructions: PlanInstruction[];
  /**
   * The UNION of every instruction target's individual simple atoms (graft-
   * recursive; see `collectBranchAtoms`), across ALL instructions and ALL branches
   * of a multi-target `:extend(.a, .b)`. A subject whose composed seed shares none
   * of these atoms provably cannot match or chain — the solve prefilter skips it.
   */
  targetAtoms: Set<string>;
}

function collectPlan(root: Root): Plan {
  const subjects: PlanSubject[] = [];
  const instructions: PlanInstruction[] = [];
  const targetAtoms = new Set<string>();
  let order = 0;
  let scopeCounter = 0;

  const walk = (
    statements: Statement[],
    path: Level[],
    scope: number[],
    parent: PlanSubject | null,
  ): void => {
    for (const st of statements) {
      if (st.kind === Kind.Rule) {
        const rule = st;
        const own = levelFromSelectorList(rule.selector);
        const rulePath = [...path, own];
        const subject: PlanSubject = { rule, path: rulePath, scope, ownLocal: own, parent };
        subjects.push(subject);
        if (rule.extendInstructions) {
          for (const inst of rule.extendInstructions) {
            for (const targetBranch of instructionTargets(inst)) {
              instructions.push({
                target: targetBranch,
                partial: inst.partial,
                extenderPath: rulePath,
                scope,
                order: order++,
              });
              collectBranchAtoms(targetBranch, targetAtoms);
            }
          }
        }
        walk(rule.body, rulePath, scope, subject);
      } else if (st.kind === Kind.AtRuleBlock) {
        const inner = [...scope, scopeCounter++];
        walk(st.body, path, inner, parent);
      }
      // MixinDef / MixinCall / declarations / at-rule statements: no extend surface.
    }
  };

  walk(root.children, [], [], null);
  return { subjects, instructions, targetAtoms };
}

function instructionTargets(inst: ExtendInstruction): Branch[] {
  return inst.target.selectors.map(branchFromComplex);
}

/** Reachability: an instruction reaches a subject iff the subject scope is the
 * same as, or a descendant of, the instruction scope. */
function reaches(instScope: number[], subjScope: number[]): boolean {
  if (instScope.length > subjScope.length) return false;
  for (let i = 0; i < instScope.length; i++) if (instScope[i] !== subjScope[i]) return false;
  return true;
}

/* --------------------------------------------------------------- SOLVE */

/**
 * The target-atom solve prefilter is ON in production — it is a provably byte-
 * identical optimization (a skipped subject cannot match/chain). Tests flip it OFF
 * via {@link setExtendPrefilterEnabled} to assert ON == OFF byte-identity across
 * adversarial shapes; never disable it outside tests.
 */
let prefilterEnabled = true;

/** TEST-ONLY toggle for the target-atom solve prefilter (see {@link prefilterEnabled}). */
export function setExtendPrefilterEnabled(on: boolean): void {
  prefilterEnabled = on;
}

function listKey(list: Branch[]): string {
  return list.map(branchText).join(',');
}

function instKey(inst: PlanInstruction): string {
  return `${inst.partial ? 1 : 0}|${branchText(inst.target)}|${inst.order}`;
}

/**
 * Solve a subject over its FLAT (fully composed) selector branches. This is the
 * definitive model: extend operates on fully-qualified selectors, so a whole-
 * complex match expands to sibling branches and a proper sub-part match (a
 * compound or sub-run inside a longer complex) compacts to `:is(span, ext)`.
 * Exact (flag=1) matches ONLY the whole complex (never leaks into children);
 * `all` (flag=0) additionally matches sub-parts. Each rule solves INDEPENDENTLY
 * over its own composed form, so no separate child-parent propagation is needed.
 */
function solveComposed(subject: PlanSubject, plan: Plan): Branch[] {
  const seed = composePath(subject.path);
  // Target-atom PREFILTER: the fixpoint can only ever change a subject whose
  // composed seed shares at least one individual simple atom with some instruction
  // target — a whole-branch/all/sub-part match and every transitive chain step all
  // require a common atom. A seed disjoint from `plan.targetAtoms` (both sides
  // extracted graft-recursively at the same per-simple granularity/normalization)
  // provably never matches nor chains, so skip solve and keep the RAW seed. This
  // prunes the ~92% of subjects that no target touches without running the fixpoint.
  if (prefilterEnabled && !seed.some((b) => branchSharesAtom(b, plan.targetAtoms))) {
    return seed;
  }
  const reachable = plan.instructions.filter((i) => reaches(i.scope, subject.scope));
  if (reachable.length === 0) return seed;
  const contribs = new Map<PlanInstruction, { extenders: Branch[]; keys: Set<string> }>();
  for (const inst of reachable) {
    const extenders = composePath(inst.extenderPath);
    contribs.set(inst, { extenders, keys: new Set(extenders.map(branchText)) });
  }
  return runFixpoint(seed.map(cloneBranch), reachable, contribs);
}

function runFixpoint(
  seed: Branch[],
  reachable: PlanInstruction[],
  contribs: Map<PlanInstruction, { extenders: Branch[]; keys: Set<string> }>,
): Branch[] {
  let list = seed;

  // Fire-once GLOBALLY per instruction: an instruction that has already CHANGED
  // the subject never fires again (re-appending an extender each round is
  // impossible — the source of the transitive-chaining duplication). An
  // instruction that does not yet match (its target not present) stays UNFIRED
  // so a later chained change can still trigger it. The outer loop re-passes
  // until a full pass changes nothing.
  const fired = new Set<string>();
  const guardMax = (reachable.length + 2) * (reachable.length + 2);
  let rounds = 0;
  let changed = true;
  while (changed && rounds <= guardMax) {
    changed = false;
    rounds++;
    for (const inst of reachable) {
      const key = instKey(inst);
      if (fired.has(key)) continue;
      const c = contribs.get(inst)!;
      if (c.extenders.length === 0 && !inst.partial) continue;
      const value = listKey(list);
      const next = applyInstruction(list, inst.target, c.extenders, inst.partial, c.keys);
      if (next && listKey(next) !== value) {
        list = next;
        fired.add(key);
        changed = true;
        break;
      }
    }
  }
  return list;
}

/* ---------------------------------------------------- NESTED re-projection */

/**
 * NESTED mode does NOT re-derive extend semantics — it RE-NESTS the correct FLAT
 * result. A rule STAYS NESTED and its extend just rewrites the local selector in
 * place, EXCEPT when an extend match CROSSES the `&` (the join between the parent
 * context and the child-appended compound), which the nested structure cannot
 * express locally — then the rule (and its descendants) FLATTEN to a top-level
 * block (emitted via the flat path). Owner rule, validated against the alpha
 * `.css` oracle:
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

/** Expand a branch's `:is()` grafts into the set of flat complex texts it denotes. */
function branchExpansions(b: Branch): string[] {
  let acc: Seg[][] = [[]];
  for (const seg of b.segs) {
    // A segment whose compound is a single `:is(...)` graft expands to its args.
    const single = seg.compound.simples.length === 1 ? seg.compound.simples[0]! : null;
    if (single && single.t === 'is') {
      const next: Seg[][] = [];
      for (const arg of single.branches) {
        for (const pre of acc) {
          // Graft the arg's segments in place (first arg-seg takes this seg's comb).
          const grafted = arg.segs.map((as, i) => ({
            comb: i === 0 ? seg.comb : as.comb,
            compound: as.compound,
          }));
          next.push([...pre, ...grafted]);
        }
      }
      acc = next;
    } else {
      acc = acc.map((pre) => [...pre, seg]);
    }
  }
  return acc.map((segs) => branchText({ segs }));
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
  const merged = mergeCompoundsToIs(
    a.segs[diff]!.compound,
    b.segs[diff]!.compound,
    a.segs.length > 1,
  );
  if (!merged) return null;
  const segs = a.segs.map((s, i) =>
    i === diff ? { comb: s.comb, compound: merged } : cloneSeg(s),
  );
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
    return [{ segs: [{ comb: ' ', compound: { simples: lead.map(cloneSimple) } }] }];
  };
  const isGroup = isSimple([...leadBranch(aLead), ...leadBranch(bLead)]);
  const suffixSimples = as.slice(as.length - suffix).map(cloneSimple);
  return { simples: [isGroup, ...suffixSimples] };
}

/**
 * Compute extend results for a bridged tree2 root. Returns `null` when the
 * document has NO `:extend()` at all (the serializer's zero-cost gate).
 */
export function computeExtends(root: Root): ExtendResults | null {
  const plan = collectPlan(root);
  if (plan.instructions.length === 0) return null;

  const flatByRule = new Map<Rule, string[]>();
  const nestedPlan = new Map<Rule, NestedRulePlan>();
  const hoistHeader = new Map<Rule, string[]>();

  // Precompute per-subject FLAT solve + raw composed once.
  const rawBySubject = new Map<PlanSubject, Branch[]>();
  const flatBySubject = new Map<PlanSubject, Branch[]>();
  for (const s of plan.subjects) {
    const raw = composePath(s.path);
    rawBySubject.set(s, raw);
    const flat = solveComposed(s, plan);
    flatBySubject.set(s, flat);
    // A rule the extend engine actually changed emits its EXTENDED header with
    // sibling `:is()`-compaction (`.button:hover, .submit:hover` →
    // `:is(.button, .submit):hover`); an unchanged rule keeps its authored form.
    if (listKey(flat) !== listKey(raw)) flatByRule.set(s.rule, siblingCompact(flat).map(branchText));
  }

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
      if (st.kind === Kind.MixinDef || st.kind === Kind.VarDeclaration) continue;
      if (st.kind === Kind.Rule && onlyRule === null) {
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

  /** The `all`-extender folds that alias a parent's whole complex (deterministic —
   * independent of the split/children decisions), plus the raw parent branches.
   * This is the set a nested child may descend from without crossing the `&`. */
  const parentHeaderSet = (p: PlanSubject): Branch[] => {
    const raw = rawBySubject.get(p)!;
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
    const parentRaw = rawBySubject.get(s.parent)!;
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
    const f = ownFlatten(s) || (s.parent !== null && flattenOf.get(s.parent) === true);
    flattenOf.set(s, f);
  }

  const hasSurvivingChild = (s: PlanSubject): boolean =>
    (childrenOf.get(s) ?? []).some((c) => flattenOf.get(c) !== true);

  // ---- per-subject nested header + splits ----
  for (const s of plan.subjects) {
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
      const identity = rawBySubject.get(s)!;
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
      const contribs = new Map<PlanInstruction, { extenders: Branch[]; keys: Set<string> }>();
      for (const inst of applied) {
        const extenders = composePath(inst.extenderPath);
        contribs.set(inst, { extenders, keys: new Set(extenders.map(branchText)) });
      }
      header = runFixpoint(s.ownLocal.map(cloneBranch), applied, contribs);
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
