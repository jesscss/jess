/**
 * extend-index.ts — PROTOTYPE index-driven extend engine (R&D)
 * ============================================================
 *
 * Built PARALLEL to `extendSelector` (extend.ts) and validated against it as an
 * ORACLE by a differential test. See `docs/future/core-architecture/EXTEND-INDEX-DESIGN.md`.
 *
 * THESIS: extend is a term-rewriting system `find → extendWith` over a selector IR.
 * The walk (`extendSelector`) is subject-driven (N×M: for each subject test each target).
 * This engine is index-driven: build an index over the FIND pattern once, then let the
 * TARGET's interned content jump to its matches. DISCOVERY is what this module owns; the
 * closed rewrite/materialize is REUSED from extend.ts where byte-identical (per the design:
 * "the point is that DISCOVERY is index-driven and the match+rewrite stays in the IR").
 *
 * The IR (a regular tree algebra, 1:1 with the node types):
 *   Sel      = Or [Seq]                     -- SelectorList (OR branches)
 *   Seq      = [ (Combinator, Compound) ]   -- ComplexSelector (positional)
 *   Compound = Set<Atom>                    -- CompoundSelector (unordered bitset)
 *   Atom     = SimpleId | Is Sel            -- interned simple selector, or a :is() constructor
 *
 * Structure of this module:
 *   1. INTERN     — SimpleId interning + per-compound bitset (reuses valueOf() as the key).
 *   2. LIFT       — node tree → IR (Sel/Seq/Compound/Atom).
 *   3. REJECT     — union-bitset guaranteed-false test (find's required atoms ⊆ target atoms?).
 *   4. SET-TRIE   — compound subset query: "which find-compound does this target-compound satisfy?"
 *   5. NFA        — bit-parallel Shift-And over the target Seq for a multi-compound find pattern,
 *                   with the combinator/`:is()`/`&` seams from the design's seam table.
 *   6. REWRITE    — reuse extend.ts's closed constructor surgery (applyExtensionAtLocation,
 *                   createProcessedSelector, …) once discovery has produced the location.
 */

import type { Selector } from '../selector.js';
import { type CompoundSelector, compound } from '../selector-compound.js';
import { ComplexSelector, type ComplexSelectorComponent, sel } from '../selector-complex.js';
import { PseudoSelector, is } from '../selector-pseudo.js';
import { SelectorList, sellist } from '../selector-list.js';
import { Ampersand } from '../ampersand.js';
import { isNode } from '../util/is-node.js';
import { isCombinator, combinatorValue } from '../util/combinator.js';
import { N } from '../node-type.js';
import { isDisjoint, isSubsetOf } from '../util/bitset.js';
import { keySetOf, requiredKeySetOf } from '../util/selector-analysis.js';
import { extendSelector } from '../util/extend.js';

/** Same surface the oracle accepts/returns (kept in lockstep with extendSelector). */
type ExtendInput = Parameters<typeof extendSelector>[0];
type ExtendOutput = ReturnType<typeof extendSelector>;

/**
 * ── The IR ────────────────────────────────────────────────────────────────
 * Interning is process-local to a single extendByIndex call (each call builds a
 * fresh SymbolTable keyed on `valueOf()`), mirroring how selectorBits interns per
 * keySetLibrary. Atoms are ints; a Compound is a Set of ints (its "bitset").
 */

type Atom =
  | { kind: 'id'; sym: number; node: Selector | string; raw: string }
  | { kind: 'is'; sel: IrSel; node: PseudoSelector }
  | { kind: 'amp'; node: Ampersand; resolved: IrSel | null };

function isSelectorNode(value: unknown): value is Selector {
  return isNode(value, N.Selector);
}

interface IrCompound {
  atoms: Atom[];
  /** interned simple-id symbols present in this compound (excludes Is/amp constructor atoms) */
  syms: Set<number>;
  node: CompoundSelector | Selector | string;
  raw: string;
}

interface IrStep {
  /** combinator PRECEDING this compound; '' for the head position. */
  comb: string;
  compound: IrCompound;
}

/** A Seq is a positional list of (combinator, compound) steps. */
type IrSeq = IrStep[];

/** A Sel is an OR of Seqs. */
interface IrSel {
  branches: IrSeq[];
  node: Selector;
}

class SymbolTable {
  private map = new Map<string, number>();
  private next = 0;

  intern(key: string): number {
    let s = this.map.get(key);
    if (s === undefined) {
      s = this.next++;
      this.map.set(key, s);
    }
    return s;
  }
}

/**
 * ── LIFT: node tree → IR ─────────────────────────────────────────────────
 */
function liftCompoundComponent(
  comp: ComplexSelectorComponent,
  syms: SymbolTable
): Atom {
  if (typeof comp === 'string') {
    return { kind: 'id', sym: syms.intern(comp), node: comp, raw: comp };
  }
  if (isNode(comp, N.PseudoSelector) && comp.name === ':is' && comp.arg && isSelectorNode(comp.arg)) {
    return { kind: 'is', sel: liftSel(comp.arg, syms), node: comp };
  }
  if (isNode(comp, N.Ampersand)) {
    const resolved = comp.getResolvedSelector();
    return {
      kind: 'amp',
      node: comp,
      resolved: resolved && isSelectorNode(resolved) ? liftSel(resolved, syms) : null
    };
  }
  return { kind: 'id', sym: syms.intern(comp.valueOf()), node: comp, raw: comp.valueOf() };
}

function liftCompound(node: Selector | string, syms: SymbolTable): IrCompound {
  const atoms: Atom[] = [];
  const symSet = new Set<number>();
  const collect = (a: Atom) => {
    atoms.push(a);
    if (a.kind === 'id') {
      symSet.add(a.sym);
    }
  };
  if (typeof node === 'string') {
    collect({ kind: 'id', sym: syms.intern(node), node, raw: node });
  } else if (isNode(node, N.CompoundSelector)) {
    for (const c of node.value) {
      collect(liftCompoundComponent(c as ComplexSelectorComponent, syms));
    }
  } else {
    collect(liftCompoundComponent(node as ComplexSelectorComponent, syms));
  }
  return { atoms, syms: symSet, node, raw: typeof node === 'string' ? node : node.valueOf() };
}

function liftSeq(node: Selector, syms: SymbolTable): IrSeq {
  if (isNode(node, N.ComplexSelector)) {
    const steps: IrStep[] = [];
    let pendingComb = '';
    for (const comp of node.value) {
      if (typeof comp === 'string' && isCombinator(comp)) {
        pendingComb = combinatorValue(comp);
        continue;
      }
      if (isNode(comp, N.Combinator)) {
        pendingComb = comp.value;
        continue;
      }
      if (typeof comp === 'string' || isSelectorNode(comp)) {
        steps.push({ comb: pendingComb, compound: liftCompound(comp, syms) });
      }
      pendingComb = '';
    }
    return steps;
  }
  // single compound / simple selector => one-step seq
  return [{ comb: '', compound: liftCompound(node, syms) }];
}

function liftSel(node: Selector, syms: SymbolTable): IrSel {
  if (isNode(node, N.SelectorList)) {
    const branches: IrSeq[] = [];
    for (const item of node.value) {
      branches.push(liftSeq(typeof item === 'string' ? wrapString(item) : (item as Selector), syms));
    }
    return { branches, node };
  }
  return { branches: [liftSeq(node, syms)], node };
}

function wrapString(s: string): Selector {
  return new ComplexSelector([s]);
}

/**
 * ── SET-TRIE for compound subset queries ─────────────────────────────────
 * Given the FIND compound's symbol-set, answer per TARGET compound: does the find
 * compound's symbol-set ⊆ the target compound's symbol-set? (order-free membership,
 * the core "subset in a compound" primitive). A Set-Trie stores the find compound as a
 * sorted-symbol path; a target compound queries by walking its own sorted symbols and
 * checking whether any stored find path is a subsequence (subset). For a single find
 * pattern this collapses to a direct subset test, which is what cases 1–4 need; the
 * trie structure is what generalizes to many simultaneous find patterns.
 */
class CompoundSetTrie {
  private patterns: Array<{ syms: number[]; id: number }> = [];
  add(symSet: Set<number>, id: number): void {
    this.patterns.push({ syms: [...symSet].sort((a, b) => a - b), id });
  }

  /** ids of find patterns whose symbol-set ⊆ the query symbol-set. */
  query(available: Set<number>): number[] {
    const out: number[] = [];
    for (const p of this.patterns) {
      let ok = true;
      for (const s of p.syms) {
        if (!available.has(s)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        out.push(p.id);
      }
    }
    return out;
  }
}

/**
 * The `:is()` graft seam (design seam table): a find symbol can match INTO a target
 * compound's `:is(...)` atom. `reachableSyms` unions the compound's own simple-id symbols
 * with the head symbols of each `:is()` branch — a single-compound branch grafts its whole
 * symbol-set; a multi-compound branch contributes its head compound's symbols (the anchor).
 * `&` atoms with a resolved parent likewise graft the parent's reachable symbols.
 */
function reachableSyms(c: IrCompound): Set<number> {
  const out = new Set<number>(c.syms);
  for (const a of c.atoms) {
    if (a.kind === 'is') {
      for (const branch of a.sel.branches) {
        if (branch.length >= 1) {
          for (const s of reachableSyms(branch[0]!.compound)) {
            out.add(s);
          }
        }
      }
    } else if (a.kind === 'amp' && a.resolved) {
      for (const branch of a.resolved.branches) {
        if (branch.length >= 1) {
          for (const s of reachableSyms(branch[branch.length - 1]!.compound)) {
            out.add(s);
          }
        }
      }
    }
  }
  return out;
}

/**
 * ── DISCOVERY RESULT ──────────────────────────────────────────────────────
 * The index reports what it discovered; the reused rewrite decides the exact
 * output shape.
 */
interface Discovery {
  matched: boolean;
}

/**
 * Index-driven discovery: does `find` occur in `target`, and (coarsely) where?
 * This is the piece the prototype OWNS. It mirrors the oracle's match decision;
 * the differential test proves agreement. Returns matched=false to route to
 * NOT_FOUND without invoking rewrite.
 */
function discover(
  target: Selector,
  find: Selector,
  partial: boolean
): Discovery {
  const syms = new SymbolTable();

  // REJECT: union-bitset guaranteed-false test (reuses the interned keySet bitsets).
  const canFastReject = !!find.keySetLibrary && find.keySetLibrary === target.keySetLibrary;
  if (!partial && canFastReject) {
    if (!isSubsetOf(requiredKeySetOf(find), keySetOf(target))) {
      return { matched: false };
    }
  } else if (partial && canFastReject) {
    if (isDisjoint(keySetOf(find), keySetOf(target))) {
      return { matched: false };
    }
  }

  const irTarget = liftSel(target, syms);
  const irFind = liftSel(find, syms);

  // Single-branch find is the common case (a find pattern is rarely an OR).
  for (const findBranch of irFind.branches) {
    for (const targetBranch of irTarget.branches) {
      if (matchSeqInSeq(targetBranch, findBranch)) {
        return { matched: true };
      }
    }
  }
  return { matched: false };
}

/**
 * ── NFA: match a find Seq as a path in a target Seq ──────────────────────
 * Bit-parallel Shift-And over positions: the find pattern is P compounds, the
 * target Seq is T compounds. A find-compound "matches" a target-compound when the
 * find-compound's symbol-set ⊆ target-compound's symbol-set (Set-Trie subset query),
 * AND the combinator seam between consecutive find compounds is compatible with the
 * target's combinator at that boundary.
 *
 * Seams (design seam table):
 *  - combinator (`>`,`+`,`~`,` `): a transition; a `' '` (descendant) find combinator
 *    matches any target combinator run only where the oracle allows — for the prototype
 *    we require exact combinator equality between consecutive matched compounds, which
 *    is what the oracle's structural matcher does for the ladder cases 1–4.
 *  - `:is(...)` / `&`: crossing seams — deferred to the reused matcher (see caller).
 *
 * Discovery is presence-only; the partial/full distinction is a REWRITE concern (delegated),
 * so this matcher takes no `partial` flag. Matching is set-CONTAINMENT (via the deduped
 * symbol bitset), never multiset — so `.b.b.c` matches exactly the finds `.b.c` does.
 */
function matchSeqInSeq(targetSeq: IrSeq, findSeq: IrSeq): boolean {
  const P = findSeq.length;
  const T = targetSeq.length;
  if (P > T) {
    return false;
  }

  // Seed candidate positions via the Set-Trie: index the find head compound, then query
  // every target compound for a subset hit. For P===1 the seeded positions ARE the answer.
  const headTrie = new CompoundSetTrie();
  headTrie.add(findSeq[0]!.compound.syms, 0);
  if (compoundHasConstructorAtom(findSeq[0]!.compound)) {
    return false; // constructor-atom find head — defer to reused path
  }
  const seedPositions: number[] = [];
  for (let i = 0; i + P <= T; i++) {
    if (headTrie.query(reachableSyms(targetSeq[i]!.compound)).length > 0) {
      seedPositions.push(i);
    }
  }
  if (P === 1) {
    return seedPositions.length > 0;
  }

  // P >= 2: from each seeded start offset, extend the match rightward, aligning
  // combinators. Require each find step's compound ⊆ target compound and the find step's
  // combinator to equal the target step's combinator (for steps > 0).
  for (const start of seedPositions) {
    let ok = true;
    for (let k = 0; k < P; k++) {
      const fs = findSeq[k]!;
      const ts = targetSeq[start + k]!;
      if (!compoundSubset(fs.compound, ts.compound)) {
        ok = false;
        break;
      }
      if (k > 0) {
        // combinator seam: the find's leading combinator at step k must match target's.
        const fcomb = fs.comb || ' ';
        const tcomb = ts.comb || ' ';
        if (fcomb !== tcomb) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      return true;
    }
  }
  return false;
}

/**
 * Compound subset query (Set-Trie primitive at single-pattern granularity):
 * every simple-id symbol in `find` is present in `target`. Is/amp atoms are handled
 * by the reused matcher when present; if the find compound carries only simple ids,
 * this is the exact "subset in a compound" test.
 */
function compoundSubset(find: IrCompound, target: IrCompound): boolean {
  // A find with its own constructor atom (:is / &) is not decided by the pure symbol
  // path — the caller routes it to the reused oracle rewrite.
  if (compoundHasConstructorAtom(find)) {
    return false;
  }
  // Target-side `:is()`/`&` are grafted via reachableSyms (the :is() seam).
  const available = reachableSyms(target);
  for (const s of find.syms) {
    if (!available.has(s)) {
      return false;
    }
  }
  return true;
}

function compoundHasConstructorAtom(c: IrCompound): boolean {
  return c.atoms.some(a => a.kind !== 'id');
}

/**
 * ── THE `&` (AMPERSAND) SEAM — discovery OWNS the classification ────────────
 *
 * INVESTIGATION FINDING (verified against extend.ts + ampersand.ts, PROBE-traced):
 *
 * Post-eval, `&` is NOT flattened into the concrete selector. It stays an `Ampersand`
 * node holding a REFERENCE to the parent (`_selectorContainer.selector`, via
 * `getResolvedSelector()`); the composed/substituted form is produced ON DEMAND. So the
 * graft model of the design doc is correct: `&` is a first-class graft atom carrying its
 * parent. (An amp compound `valueOf()`s as its resolved form, e.g. `&.bar` → `.foo.bar`,
 * but that is on-demand composition, not a flattened tree.)
 *
 * The oracle (`checkAmpersandCrossingDuringExtension`) classifies a match by a TWO-PROBE
 * differential over the WHOLE subject selector, per amp node with a resolved parent:
 *   • RESOLVED form  — graft the parent at the `&` position    (`replaceAmpersandWithItsValue`)
 *   • EMPTY form     — drop `&` (+ trailing implicit-space combinator) (`replaceAmpersandWithEmpty`)
 * Then: `crossed` ⇔ (find matches RESOLVED) ∧ ¬(find matches EMPTY).
 *   • crossed        → HOIST to root  (`handleAmpersandBoundaryCrossing`)
 *   • empty matches  → CHILD-only     → in-place extend on the child material (`&:is(...)`)
 *   • neither        → no match at this amp
 *
 * DECISION GATES beyond the doc's child/cross/parent + hoist model (surfaced by PROBE —
 * see the report). A detected crossing does NOT always hoist:
 *   • SIMPLE-FIND FULL boundary skip: `!partial && reason==='resolved-only' && find is a
 *     SimpleSelector` → NOT a hoist; parent-only match → NOT_FOUND.
 *   • RELATIVE PARTIAL boundary skip: `partial && reason==='resolved-only' && subject is a
 *     ComplexSelector whose first component is a combinator (e.g. `> &.child`)` → NOT a
 *     hoist; extend in-place on the amp-resolved subject (`> :is(.parent.child, .ext)`).
 *   • PARTIAL WHOLE-LOCATION gate: a partial crossing with NO whole-selector location →
 *     NOT_FOUND (parent-level processing carries it).
 *
 * `classifyAmpersand` reproduces the two-probe differential in the IR (this is OURS), so a
 * misclassification diverges from the oracle. Construction of the crossed/child output is
 * REUSED from extend.ts (its fold + hoist machinery), per the design's discovery/rewrite split.
 */

type AmpClass = 'crossing' | 'child-only' | 'none';

interface AmpVerdict {
  cls: AmpClass;
  /** true when a detected crossing collapses to NOT_FOUND (parent-only / whole-location gate). */
  gatedNotFound: boolean;
}

/** Locate the amp node's step index within a lifted seq (first amp step or amp-carrying compound). */
function findAmpStep(seq: IrSeq): { step: number; atom: number } | null {
  for (let i = 0; i < seq.length; i++) {
    const atoms = seq[i]!.compound.atoms;
    for (let j = 0; j < atoms.length; j++) {
      if (atoms[j]!.kind === 'amp') {
        return { step: i, atom: j };
      }
    }
  }
  return null;
}

/**
 * Build the RESOLVED-form seq: graft the amp's parent Seq at the amp position. A head-only
 * amp step (implicit `& .b`) prepends the parent's steps; an amp embedded in a compound
 * (`&.bar`, `> &.child`) merges the parent's LAST compound's simple-id syms into that
 * compound and prepends the parent's earlier steps ahead of it.
 */
function resolvedFormSeq(seq: IrSeq, at: { step: number; atom: number }): IrSeq | null {
  const ampAtom = seq[at.step]!.compound.atoms[at.atom]!;
  if (ampAtom.kind !== 'amp' || !ampAtom.resolved) {
    return null;
  }
  const parentBranches = ampAtom.resolved.branches;
  // The single-parent common case (a resolved parent that is not itself an OR).
  if (parentBranches.length !== 1) {
    return null; // list-parent grafts are constructed by the reused oracle path
  }
  const parent = parentBranches[0]!;
  const out: IrStep[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (i !== at.step) {
      out.push(seq[i]!);
      continue;
    }
    const otherAtoms = seq[i]!.compound.atoms.filter((_, j) => j !== at.atom);
    if (otherAtoms.length === 0) {
      // amp is its OWN step (implicit `& .b`): splice parent's steps in at this position,
      // dropping the amp step's own leading combinator; parent keeps its head-comb.
      for (let p = 0; p < parent.length; p++) {
        const ps = parent[p]!;
        out.push(p === 0 ? { comb: seq[i]!.comb, compound: ps.compound } : ps);
      }
    } else {
      // amp embedded in a compound: prepend parent's earlier steps, then a merged compound
      // (parent's LAST compound's syms ∪ the compound's other atoms) at this position.
      for (let p = 0; p < parent.length - 1; p++) {
        out.push(p === 0 ? { comb: seq[i]!.comb, compound: parent[p]!.compound } : parent[p]!);
      }
      const parentTail = parent[parent.length - 1]!;
      const mergedSyms = new Set<number>(parentTail.compound.syms);
      for (const a of otherAtoms) {
        if (a.kind === 'id') {
          mergedSyms.add(a.sym);
        }
      }
      const merged: IrCompound = {
        atoms: [...parentTail.compound.atoms, ...otherAtoms],
        syms: mergedSyms,
        node: seq[i]!.compound.node,
        raw: seq[i]!.compound.raw
      };
      out.push({
        comb: parent.length === 1 ? seq[i]!.comb : parentTail.comb,
        compound: merged
      });
    }
  }
  return out;
}

/**
 * Build the EMPTY-form seq: drop the amp atom. If the amp was its own step, also drop that
 * step's trailing implicit-space combinator (mirrors `replaceAmpersandWithEmpty`, which
 * removes a following `' '` combinator when it removes a leading amp).
 */
function emptyFormSeq(seq: IrSeq, at: { step: number; atom: number }): IrSeq {
  const out: IrStep[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (i !== at.step) {
      out.push(seq[i]!);
      continue;
    }
    const otherAtoms = seq[i]!.compound.atoms.filter((_, j) => j !== at.atom);
    if (otherAtoms.length === 0) {
      // Whole step was the amp: drop it entirely. When the dropped amp was the head, the new
      // head step must lose its leading (implicit-space) combinator — fixed up after the loop.
      continue;
    }
    const otherSyms = new Set<number>();
    for (const a of otherAtoms) {
      if (a.kind === 'id') {
        otherSyms.add(a.sym);
      }
    }
    out.push({
      comb: i === 0 ? '' : seq[i]!.comb,
      compound: { atoms: otherAtoms, syms: otherSyms, node: seq[i]!.compound.node, raw: seq[i]!.compound.raw }
    });
  }
  // If the head step was a lone amp we dropped, the new head step must lose its leading combinator.
  if (out.length > 0 && at.step === 0 && seq[0]!.compound.atoms.length === 1) {
    out[0] = { comb: '', compound: out[0]!.compound };
  }
  return out;
}

function seqMatchesFind(subjectSeq: IrSeq, irFind: IrSel): boolean {
  for (const fb of irFind.branches) {
    if (matchSeqInSeq(subjectSeq, fb)) {
      return true;
    }
  }
  return false;
}

/**
 * OWNED `&` classification: reproduce the oracle's two-probe differential in the IR, then
 * apply the decision gates. Returns 'none' when this module cannot authoritatively decide
 * (list-parent graft, amp inside `:is()`, etc.) so the caller defers construction to the oracle.
 */
function classifyAmpersand(
  subject: Selector,
  find: Selector,
  partial: boolean
): AmpVerdict {
  const syms = new SymbolTable();
  const irSubject = liftSel(subject, syms);
  const irFind = liftSel(find, syms);

  // Only the single-branch subject/find common case is modeled here; OR-subjects with amp
  // are deferred (cls 'none').
  if (irSubject.branches.length !== 1) {
    return { cls: 'none', gatedNotFound: false };
  }
  const subjectSeq = irSubject.branches[0]!;
  const at = findAmpStep(subjectSeq);
  if (!at) {
    return { cls: 'none', gatedNotFound: false };
  }
  const ampAtom = subjectSeq[at.step]!.compound.atoms[at.atom]!;
  if (ampAtom.kind !== 'amp' || !ampAtom.resolved) {
    return { cls: 'none', gatedNotFound: false };
  }

  const resolved = resolvedFormSeq(subjectSeq, at);
  if (!resolved) {
    return { cls: 'none', gatedNotFound: false };
  }
  const empty = emptyFormSeq(subjectSeq, at);

  const resolvedMatch = seqMatchesFind(resolved, irFind);
  const emptyMatch = seqMatchesFind(empty, irFind);

  if (resolvedMatch && !emptyMatch) {
    // Crossing detected. One decision gate stands (Gate 2, doc-verified): a SIMPLE find that
    // matches only the parent-grafted (RESOLVED) form collapses to NOT_FOUND — "parent-only".
    // (The former Gate 1 "relative-partial downgrade" was WITHDRAWN as an invalid-input artifact
    // — a root-level leading-`>` subject is not a reachable shape; see EXTEND-INDEX-DESIGN.md.)
    const findIsSimple = isNode(find, N.SimpleSelector);
    if (!partial && findIsSimple) {
      return { cls: 'crossing', gatedNotFound: true };
    }
    return { cls: 'crossing', gatedNotFound: false };
  }
  if (emptyMatch) {
    return { cls: 'child-only', gatedNotFound: false };
  }
  return { cls: 'none', gatedNotFound: false };
}

/**
 * ── PUBLIC ENTRY ──────────────────────────────────────────────────────────
 * Same contract as `extendSelector`. The prototype's OWNED contribution is the
 * index-driven discovery gate; the closed rewrite/materialize is REUSED from
 * extend.ts (per the design). The differential test proves the combination is
 * byte-identical to the pure oracle across the case ladder.
 */
export function extendByIndex(
  target: ExtendInput,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): ExtendOutput {
  const targetSel: Selector = Array.isArray(target)
    ? new SelectorList(target as SelectorList['value'])
    : target;

  if (partial && find.valueOf() === extendWith.valueOf()) {
    return targetSel;
  }

  // `&` SEAM: discovery OWNS the classification. When the subject carries a resolved amp we
  // reproduce the oracle's two-probe differential + decision gates HERE; a misclassification
  // diverges from the oracle. Construction (hoist / in-place fold) is reused from extend.ts.
  if (hasAmpersand(targetSel)) {
    const verdict = classifyAmpersand(targetSel, find, partial);
    if (verdict.cls === 'crossing' || verdict.cls === 'child-only') {
      if (verdict.gatedNotFound) {
        return 'NOT_FOUND';
      }
      // crossing (→ hoist), gated-in-place, and child-only all resolve to a real extend; the
      // reused fold + `handleAmpersandBoundaryCrossing` build the exact (hoisted/in-place) output.
      return extendSelector(target, find, extendWith, partial);
    }
    if (verdict.cls === 'none') {
      // We could not authoritatively classify (list-parent graft, amp-in-`:is()`, unmodeled
      // shape). Fall back to the oracle for BOTH the decision and construction.
      return extendSelector(target, find, extendWith, partial);
    }
  }

  const discovery = discover(targetSel, find, partial);
  if (!discovery.matched) {
    // Discovery says no match. With no `&` in play the index is AUTHORITATIVE: `:is()`
    // grafting is modeled soundly in reachableSyms. A find carrying its own constructor
    // atom is delegated (extendWith `:is()` extraction lives in the oracle fold).
    if (!hasConstructorAtoms(find)) {
      return 'NOT_FOUND';
    }
  }

  // REUSED REWRITE: hand off the closed constructor surgery to extend.ts.
  return extendSelector(target, find, extendWith, partial);
}

function anyAtom(sel: Selector, pred: (a: Atom) => boolean): boolean {
  const ir = liftSel(sel, new SymbolTable());
  for (const branch of ir.branches) {
    for (const step of branch) {
      for (const a of step.compound.atoms) {
        if (pred(a) || (a.kind === 'is' && anyAtomInIr(a.sel, pred))) {
          return true;
        }
      }
    }
  }
  return false;
}

function anyAtomInIr(ir: IrSel, pred: (a: Atom) => boolean): boolean {
  for (const branch of ir.branches) {
    for (const step of branch) {
      for (const a of step.compound.atoms) {
        if (pred(a) || (a.kind === 'is' && anyAtomInIr(a.sel, pred))) {
          return true;
        }
      }
    }
  }
  return false;
}

function hasConstructorAtoms(sel: Selector): boolean {
  return anyAtom(sel, a => a.kind !== 'id');
}

function hasAmpersand(sel: Selector): boolean {
  return anyAtom(sel, a => a.kind === 'amp');
}

/**
 * True when the target carries a graft the own engine does not build INTO yet: a `:is()`
 * atom, or any pseudo carrying a selector arg (`:not(.x)`, `:has(.x)`, …) whose inner selector
 * the find could reach. Detected by node inspection (a `:not(.foo)` lifts as an opaque id
 * atom, so the IR alone would miss it). Kept conservative — any such pseudo → UNSUPPORTED.
 */
function hasGraftTarget(target: Selector, _find: Selector): boolean {
  if (anyAtom(target, a => a.kind === 'is')) {
    return true;
  }
  return nodeHasPseudoWithSelectorArg(target);
}

function nodeHasPseudoWithSelectorArg(node: unknown): boolean {
  if (typeof node === 'string' || node === null || node === undefined) {
    return false;
  }
  if (isNode(node, N.PseudoSelector)) {
    const p = node as PseudoSelector;
    if (p.arg && isSelectorNode(p.arg)) {
      return true;
    }
  }
  const container = node as { value?: unknown };
  const val = container.value;
  if (Array.isArray(val)) {
    for (const child of val) {
      if (nodeHasPseudoWithSelectorArg(child)) {
        return true;
      }
    }
  } else if (val !== undefined && typeof val !== 'string') {
    if (nodeHasPseudoWithSelectorArg(val)) {
      return true;
    }
  }
  return false;
}

/* ============================================================================
 * OWN-CONSTRUCTION ENGINE (`extendByIndexOwn`)
 * ============================================================================
 * The engine above (`extendByIndex`) delegates OUTPUT to `extendSelector`, which
 * makes its accept-side classification untestable (comparing a delegated result to
 * the oracle is tautological). This engine CONSTRUCTS output ITSELF from the IR,
 * with NO `extendSelector` / `applyExtendsToSelector` fallback. Any shape it cannot
 * yet build returns the `UNSUPPORTED` sentinel — never a silent delegation — so the
 * real-corpus differential goes RED and the coverage frontier is honest.
 *
 * Construction is CLONING-FREE: it reuses the authored `.node` references carried on
 * each Atom (the actual eval-time selector nodes) and assembles fresh `:is()` / branch
 * nodes only around the rewritten span, via the plain `is`/`sel`/`compound`/`sellist`
 * builders. No `.clone()`, `composeSelector`, `copySelectorTreeForExtend`, or
 * `selectorCompare`.
 *
 * Output rules (pinned against the oracle, non-`&` ladder):
 *  - FULL match (find ≡ whole target branch): append extendWith as new OR-branch(es);
 *    a `:is()` extendWith is flattened into its branches (`.foo` ex `:is(.e3,.e4)` → `.foo,.e3,.e4`).
 *  - PARTIAL, span within ONE compound: the matched atoms collapse into
 *    `:is(<matched-atoms>, <extendWith>)` at the matched slot; unmatched atoms keep their
 *    slots/order; a single-atom find substitutes EVERY occurrence (`.b.b.c` f`.b` →
 *    `:is(.b,.x):is(.b,.x).c`).
 *  - PARTIAL, span across MULTIPLE compounds: the matched span (with its internal
 *    combinators) collapses into one `:is(<span>, <extendWith>)` compound at the span's
 *    first position; the combinator preceding the span stays outside.
 */

/** Distinct sentinel: the own engine hit a shape it does not yet build. */
export const UNSUPPORTED = 'UNSUPPORTED' as const;
export type UnsupportedResult = typeof UNSUPPORTED;

/** A resolved match of `find` inside one target branch. */
interface OwnMatch {
  /** whole branch matched exactly (set-equal AND ordered-count-equal, full span, combinators aligned) */
  full: boolean;
  /** start compound indices of every matched span within the target seq */
  starts: number[];
  /** number of compounds the find spans (P) */
  span: number;
}

/**
 * Full-match eligibility for a compound: a FULL (exact) compound match must CONSUME ALL
 * target atoms — i.e. the target and find compounds are MULTISET-equal. Any stranded
 * target atom the find does not replicate (including a target-side duplicate) makes the
 * match PARTIAL-with-remainder, not full. `compoundSubset` has already established set
 * containment at the call site, so multiset equality reduces to equal atom counts.
 *
 *   `.b.c`   find `.b.c` → full   (all target atoms consumed)
 *   `.b.b`   find `.b.b` → full   (all target atoms consumed)
 *   `.b.b.c` find `.b.c` → NOT full (extra `.b` stranded → partial-with-remainder)
 *   `.foo.foo` find `.foo` → NOT full (extra `.foo` stranded)
 */
function compoundFullEligible(find: IrCompound, target: IrCompound): boolean {
  return find.atoms.length === target.atoms.length;
}

/**
 * Match a single-branch find seq inside a target seq, returning the location.
 * Mirrors `matchSeqInSeq` but reports WHERE, and distinguishes full (whole-branch,
 * set-equal) from partial. Returns null when no match, UNSUPPORTED when a constructor
 * atom (`:is`/`&`) participates on the find side or a matched target compound (those
 * grafts are not yet built by this engine).
 */
function locateFind(targetSeq: IrSeq, findSeq: IrSeq): OwnMatch | null | UnsupportedResult {
  const P = findSeq.length;
  const T = targetSeq.length;
  if (P > T) {
    return null;
  }
  for (const fs of findSeq) {
    if (compoundHasConstructorAtom(fs.compound)) {
      return UNSUPPORTED;
    }
  }
  // Any target compound carrying a constructor atom (`:is`/`&`) whose GRAFT the find could
  // reach needs graft-aware construction the own engine does not build yet. When the find's
  // symbols only exist inside such a target compound's :is()/graft, or when a matched target
  // compound has one, we must not silently mis-decide — route to UNSUPPORTED.
  const starts: number[] = [];
  let full = false;
  let unsupported = false;
  for (let start = 0; start + P <= T; start++) {
    let ok = true;
    let allFull = true;
    let spanHasPartialCompound = false;
    for (let k = 0; k < P; k++) {
      const fs = findSeq[k]!;
      const ts = targetSeq[start + k]!;
      if (!compoundSubset(fs.compound, ts.compound)) {
        ok = false;
        break;
      }
      if (compoundHasConstructorAtom(ts.compound)) {
        unsupported = true;
        ok = false;
        break;
      }
      if (!compoundFullEligible(fs.compound, ts.compound)) {
        allFull = false;
      }
      // A spanned compound that is a proper SUBSET (deduped syms differ) triggers the oracle's
      // remainder-splitting shape (multi-compound only).
      if (fs.compound.syms.size !== ts.compound.syms.size) {
        spanHasPartialCompound = true;
      }
      if (k > 0) {
        const fcomb = fs.comb || ' ';
        const tcomb = ts.comb || ' ';
        if (fcomb !== tcomb) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      // A multi-compound span where a spanned compound is only a PROPER SUBSET of its target
      // compound triggers the oracle's remainder-splitting shape (e.g. `.a>.b.c` find `.a>.b`
      // partial → `.a>.b.c,.c.d`), which the own engine does not build yet.
      if (P >= 2 && spanHasPartialCompound) {
        return UNSUPPORTED;
      }
      starts.push(start);
      if (P === T && allFull) {
        full = true;
      }
    }
  }
  if (unsupported && starts.length === 0) {
    return UNSUPPORTED;
  }
  if (starts.length === 0) {
    return null;
  }
  return { full, starts, span: P };
}

/** Build the OR-branches contributed by `extendWith`: a `:is()` flattens, else one branch. */
function extendWithBranches(extendWith: Selector): Selector[] {
  if (isNode(extendWith, N.SelectorList)) {
    return extendWith.value.map(v => (typeof v === 'string' ? wrapString(v) : (v as Selector)));
  }
  if (isNode(extendWith, N.PseudoSelector) && extendWith.name === ':is' && extendWith.arg && isSelectorNode(extendWith.arg)) {
    const arg = extendWith.arg;
    if (isNode(arg, N.SelectorList)) {
      return arg.value.map(v => (typeof v === 'string' ? wrapString(v) : (v as Selector)));
    }
    return [arg];
  }
  return [extendWith];
}

/** Selector node for one lifted step's compound (reuses the authored node, no clone). */
function compoundNodeOf(step: IrStep): Selector | string {
  const n = step.compound.node;
  return typeof n === 'string' ? n : (n as Selector);
}

/** Serialize a matched span (compounds start..start+span-1) as a Selector for the `:is()` first arg. */
function spanSelector(targetSeq: IrSeq, start: number, span: number): Selector {
  if (span === 1) {
    const n = compoundNodeOf(targetSeq[start]!);
    return typeof n === 'string' ? wrapString(n) : n;
  }
  const parts: (Selector | string)[] = [];
  for (let k = 0; k < span; k++) {
    const step = targetSeq[start + k]!;
    if (k > 0) {
      parts.push(makeCombinator(step.comb));
    }
    const n = compoundNodeOf(step);
    parts.push(typeof n === 'string' ? n : n);
  }
  return sel(parts as ComplexSelectorComponent[]);
}

function makeCombinator(comb: string): string {
  return comb === '' ? ' ' : comb;
}

/**
 * Build a compound Selector from atom-nodes. Reuses each atom's authored node; wraps any
 * atom in `:is(atom, ...extendBranches)` when its index is in `wrapAt`.
 */
function buildCompoundWithWraps(
  atoms: Atom[],
  wrapAt: Set<number>,
  extendBranches: Selector[]
): Selector {
  const parts: (Selector | string)[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    const node: Selector | string = a.kind === 'id' ? (typeof a.node === 'string' ? a.node : a.node) : (a.node as Selector);
    if (wrapAt.has(i)) {
      const inner = typeof node === 'string' ? wrapString(node) : node;
      parts.push(is(sellist([inner, ...extendBranches])));
    } else {
      parts.push(node);
    }
  }
  if (parts.length === 1 && typeof parts[0] !== 'string') {
    return parts[0] as Selector;
  }
  return compound(parts as Parameters<typeof compound>[0]);
}

/**
 * Rebuild a target branch (seq) as a Selector, replacing the matched span per the partial
 * rules. `matchedSlots` (single-compound spans) lists, per matched compound index, which
 * atom-slots to wrap; for multi-compound spans the whole span collapses to one `:is()`.
 */
function buildPartialBranch(
  targetSeq: IrSeq,
  m: OwnMatch,
  find: IrSeq,
  extendBranches: Selector[]
): Selector | UnsupportedResult {
  const parts: (Selector | string)[] = [];
  if (m.span === 1) {
    // Single-compound find: wrap the matched atom-slots in EVERY matched compound (`.z + .z`
    // find `.z` → both `.z` compounds become `:is(.z, …)`; `.foo.foo` find `.foo` → each `.foo`
    // atom slot wrapped).
    const matchStarts = new Set(m.starts);
    const findSyms = find[0]!.compound.syms;
    for (let i = 0; i < targetSeq.length; i++) {
      const step = targetSeq[i]!;
      if (i > 0) {
        parts.push(makeCombinator(step.comb));
      }
      if (!matchStarts.has(i)) {
        const n = compoundNodeOf(step);
        parts.push(typeof n === 'string' ? n : n);
        continue;
      }
      const wrapAt = new Set<number>();
      for (let j = 0; j < step.compound.atoms.length; j++) {
        const at = step.compound.atoms[j]!;
        if (at.kind === 'id' && findSyms.has(at.sym)) {
          wrapAt.add(j);
        }
      }
      // Multi-atom find (e.g. .a.b within .a.c.b): matched atoms collapse into a SINGLE
      // :is(<matched-as-compound>, ext); single-atom find wraps each occurrence in place.
      if (findSyms.size > 1) {
        parts.push(buildContiguousWrap(step.compound.atoms, wrapAt, extendBranches));
      } else {
        parts.push(buildCompoundWithWraps(step.compound.atoms, wrapAt, extendBranches));
      }
    }
    return sel(parts as ComplexSelectorComponent[]);
  }
  // Multi-compound span: collapse compounds [start..start+span) into one :is(span, ext).
  const m_start = m.starts[0]!;
  const spanSel = spanSelector(targetSeq, m_start, m.span);
  const isNode_ = is(sellist([spanSel, ...extendBranches]));
  for (let i = 0; i < targetSeq.length; i++) {
    if (i < m_start || i >= m_start + m.span) {
      const step = targetSeq[i]!;
      if (i > 0) {
        parts.push(makeCombinator(step.comb));
      }
      const n = compoundNodeOf(step);
      parts.push(typeof n === 'string' ? n : n);
      continue;
    }
    if (i === m_start) {
      if (i > 0) {
        parts.push(makeCombinator(targetSeq[i]!.comb));
      }
      parts.push(isNode_);
    }
    // compounds inside the span (i>start) are subsumed by the :is()
  }
  return sel(parts as ComplexSelectorComponent[]);
}

/**
 * Multi-atom find within one compound: matched atoms (contiguous by construction of a
 * compound match) collapse into `:is(<matched-atoms-compound>, ...ext)`, unmatched atoms
 * keep their slots. Preserves original order.
 */
function buildContiguousWrap(
  atoms: Atom[],
  wrapAt: Set<number>,
  extendBranches: Selector[]
): Selector {
  const matched: (Selector | string)[] = [];
  const parts: (Selector | string)[] = [];
  let placed = false;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    const node: Selector | string = a.kind === 'id' ? (typeof a.node === 'string' ? a.node : a.node) : (a.node as Selector);
    if (wrapAt.has(i)) {
      matched.push(node);
      if (!placed) {
        // placeholder position; the :is() is inserted after collecting all matched atoms
        parts.push(' IS');
        placed = true;
      }
    } else {
      parts.push(node);
    }
  }
  const matchedCompound: Selector =
    matched.length === 1
      ? (typeof matched[0] === 'string' ? wrapString(matched[0]) : (matched[0] as Selector))
      : compound(matched.map(m => (typeof m === 'string' ? m : m)) as Parameters<typeof compound>[0]);
  const isSel = is(sellist([matchedCompound, ...extendBranches]));
  const finalParts = parts.map(p => (p === ' IS' ? isSel : p));
  if (finalParts.length === 1 && typeof finalParts[0] !== 'string') {
    return finalParts[0] as Selector;
  }
  return compound(finalParts as Parameters<typeof compound>[0]);
}

/**
 * PUBLIC ENTRY (own construction). Same contract as `extendSelector`, but never delegates:
 * it either builds the output itself (byte-identical to the oracle on covered shapes) or
 * returns UNSUPPORTED. No `&` / list-parent / constructor-atom-find handling yet.
 */
export function extendByIndexOwn(
  target: ExtendInput,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector | Selector[] | 'NOT_FOUND' | UnsupportedResult {
  const targetSel: Selector = Array.isArray(target)
    ? new SelectorList(target as SelectorList['value'])
    : target;

  if (partial && find.valueOf() === extendWith.valueOf()) {
    return targetSel;
  }

  // `&`, constructor-atom finds, and graft-bearing targets (`:is(...)` / a pseudo carrying a
  // selector arg like `:not(.foo)`) are not built by the own engine yet — extending INTO those
  // needs graft-aware construction. Gate them to UNSUPPORTED (never a wrong/NOT_FOUND answer).
  if (
    hasAmpersand(targetSel) || hasAmpersand(find) || hasConstructorAtoms(find)
    || hasGraftTarget(targetSel, find)
  ) {
    return UNSUPPORTED;
  }

  const syms = new SymbolTable();
  const irTarget = liftSel(targetSel, syms);
  const irFind = liftSel(find, syms);
  if (irFind.branches.length !== 1) {
    return UNSUPPORTED; // OR-find not modeled
  }
  const findSeq = irFind.branches[0]!;

  const extendBranches = extendWithBranches(extendWith);

  // Per-branch match + construction.
  const branchResults: Array<{ node: Selector; matchedFull: boolean; matchedPartial: boolean }> = [];
  let anyMatch = false;
  for (const tb of irTarget.branches) {
    const loc = locateFind(tb, findSeq);
    if (loc === UNSUPPORTED) {
      return UNSUPPORTED;
    }
    if (loc === null) {
      branchResults.push({ node: seqToSelector(tb), matchedFull: false, matchedPartial: false });
      continue;
    }
    anyMatch = true;
    if (!partial) {
      if (!loc.full) {
        // Non-partial requires a whole-branch match; a proper-subset match is not extended.
        branchResults.push({ node: seqToSelector(tb), matchedFull: false, matchedPartial: false });
        continue;
      }
      branchResults.push({ node: seqToSelector(tb), matchedFull: true, matchedPartial: false });
    } else {
      if (loc.full) {
        // Partial + full-branch match: still an append (whole selector equals find).
        branchResults.push({ node: seqToSelector(tb), matchedFull: true, matchedPartial: false });
      } else {
        const built = buildPartialBranch(tb, loc, findSeq, extendBranches);
        if (built === UNSUPPORTED) {
          return UNSUPPORTED;
        }
        branchResults.push({ node: built, matchedPartial: true, matchedFull: false });
      }
    }
  }

  if (!anyMatch) {
    return 'NOT_FOUND';
  }

  // Assemble output. Partial rewrites are IN PLACE (matched branch replaced by its rewrite);
  // full matches APPEND extendWith branches after all original branches.
  const outBranches: Selector[] = [];
  let anyFull = false;
  let anyEffective = false;
  for (const br of branchResults) {
    outBranches.push(br.node);
    if (br.matchedFull) {
      anyFull = true;
      anyEffective = true;
    }
    if (br.matchedPartial) {
      anyEffective = true;
    }
  }
  if (anyFull) {
    for (const eb of extendBranches) {
      outBranches.push(eb);
    }
  }
  if (!anyEffective) {
    // Matched only as a proper subset in non-partial mode → unchanged target.
    return targetSel;
  }

  if (outBranches.length === 1) {
    return outBranches[0]!;
  }
  return sellist(outBranches);
}

/** Rebuild a lifted seq as a Selector, reusing authored nodes (no rewrite). */
function seqToSelector(seq: IrSeq): Selector {
  if (seq.length === 1 && seq[0]!.comb === '') {
    const n = compoundNodeOf(seq[0]!);
    return typeof n === 'string' ? wrapString(n) : n;
  }
  const parts: (Selector | string)[] = [];
  for (let i = 0; i < seq.length; i++) {
    const step = seq[i]!;
    if (i > 0) {
      parts.push(makeCombinator(step.comb));
    }
    const n = compoundNodeOf(step);
    parts.push(typeof n === 'string' ? n : n);
  }
  return sel(parts as ComplexSelectorComponent[]);
}
