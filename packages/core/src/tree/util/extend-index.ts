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
import type { CompoundSelector } from '../selector-compound.js';
import { ComplexSelector, type ComplexSelectorComponent } from '../selector-complex.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { SelectorList } from '../selector-list.js';
import { Ampersand } from '../ampersand.js';
import { isNode } from './is-node.js';
import { isCombinator, combinatorValue } from './combinator.js';
import { N } from '../node-type.js';
import { isDisjoint, isSubsetOf } from './bitset.js';
import { keySetOf, requiredKeySetOf } from './selector-analysis.js';
import { extendSelector } from './extend.js';

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
  /** true when a detected crossing is DOWNGRADED to in-place by a decision gate. */
  gatedInPlace: boolean;
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
    return { cls: 'none', gatedInPlace: false, gatedNotFound: false };
  }
  const subjectSeq = irSubject.branches[0]!;
  const at = findAmpStep(subjectSeq);
  if (!at) {
    return { cls: 'none', gatedInPlace: false, gatedNotFound: false };
  }
  const ampAtom = subjectSeq[at.step]!.compound.atoms[at.atom]!;
  if (ampAtom.kind !== 'amp' || !ampAtom.resolved) {
    return { cls: 'none', gatedInPlace: false, gatedNotFound: false };
  }

  const resolved = resolvedFormSeq(subjectSeq, at);
  if (!resolved) {
    return { cls: 'none', gatedInPlace: false, gatedNotFound: false };
  }
  const empty = emptyFormSeq(subjectSeq, at);

  const resolvedMatch = seqMatchesFind(resolved, irFind);
  const emptyMatch = seqMatchesFind(empty, irFind);

  if (resolvedMatch && !emptyMatch) {
    // Crossing detected. Apply the decision gates surfaced by PROBE.
    const findIsSimple = isNode(find, N.SimpleSelector);
    const subjectIsRelativeComplex =
      isNode(subject, N.ComplexSelector) && isCombinator(subject.value[0]);

    if (!partial && findIsSimple) {
      // SIMPLE-FIND FULL boundary skip → parent-only match → NOT_FOUND (no hoist).
      return { cls: 'crossing', gatedInPlace: false, gatedNotFound: true };
    }
    if (partial && subjectIsRelativeComplex) {
      // RELATIVE PARTIAL boundary skip → extend in-place on the amp-resolved subject.
      return { cls: 'crossing', gatedInPlace: true, gatedNotFound: false };
    }
    return { cls: 'crossing', gatedInPlace: false, gatedNotFound: false };
  }
  if (emptyMatch) {
    return { cls: 'child-only', gatedInPlace: false, gatedNotFound: false };
  }
  return { cls: 'none', gatedInPlace: false, gatedNotFound: false };
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
