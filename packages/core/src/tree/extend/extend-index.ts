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
import { PseudoSelector, is, pseudo } from '../selector-pseudo.js';
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
  // A pseudo carrying a selector argument: `:is(...)`, `:not(...)`, `:where(...)`, `:has(...)`.
  // `pseudoName` distinguishes `:is` (the ONLY graft that boundary-crosses into an outer compound
  // match — design line 94) from the rest (recursion-only). `kind:'is'` is kept as the tag for
  // back-compat with the delegating engine's discovery paths (reachableSyms/matchSeqInSeq).
  | { kind: 'is'; sel: IrSel; node: PseudoSelector; pseudoName: string }
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
  if (isNode(comp, N.PseudoSelector) && comp.arg && isSelectorNode(comp.arg)) {
    return { kind: 'is', sel: liftSel(comp.arg, syms), node: comp, pseudoName: comp.name };
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
    // Only `:is()` boundary-crosses — a find can match THROUGH an `:is` graft into an outer
    // compound match. `:not`/`:where`/`:has` are recursion-only (extend recurses INTO their arg
    // but a find does not "reach through" them), so they must NOT contribute reachable syms.
    if (a.kind === 'is' && a.pseudoName === ':is') {
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

/**
 * Internal sentinel: a find MATCHED as a proper subset in FULL mode (e.g. `.info` in
 * `:is(a).info`, `.foo` in `.x:not(.foo)`). The location is real but full mode does not extend
 * it, so the compound/branch is left UNCHANGED — distinct from "no match" (which would route the
 * whole call to NOT_FOUND when no other branch matches).
 */
const MATCHED_UNCHANGED = 'MATCHED_UNCHANGED' as const;
type MatchedUnchanged = typeof MATCHED_UNCHANGED;

/**
 * Internal sentinel: a find FULLY matched a whole graft-bearing compound (e.g. `.a.c` matches
 * `:is(.a,.b).c` — `.a` via the `:is` branch head, `.c` plain, all atoms consumed). The compound
 * stays unchanged and the caller APPENDS extendWith as a sibling branch.
 */
const MATCHED_FULL_APPEND = 'MATCHED_FULL_APPEND' as const;
type MatchedFullAppend = typeof MATCHED_FULL_APPEND;

/** A resolved match of `find` inside one target branch. */
interface OwnMatch {
  /** whole branch matched exactly (set-equal AND ordered-count-equal, full span, combinators aligned) */
  full: boolean;
  /** start compound indices of every matched span within the target seq */
  starts: number[];
  /** number of compounds the find spans (P) */
  span: number;
  /**
   * Set when a multi-compound span leaves an unmatched atom remainder in some spanned compound.
   * `wholeSpan` = the span covers positions `0..T-1` (the ENTIRE target seq); then the oracle emits
   * a SIBLING-SPLIT (original branch unchanged + one sibling). When NOT wholeSpan (compounds exist
   * before and/or after the span) the oracle `:is()`-WRAPs the span (the existing multi-compound
   * `buildPartialBranch` path). `remStart` = the index (within the target seq) of the LAST spanned
   * compound that has a non-empty remainder (the only one that contributes the sibling).
   */
  remainderSplit?: {
    wholeSpan: boolean;
    /** index in the target seq of the last spanned compound carrying a remainder */
    remStart: number;
    /** the first matched span start (span occupies [spanStart .. spanStart+span-1]) */
    spanStart: number;
  };
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
  let remainderSplit: OwnMatch['remainderSplit'];
  for (let start = 0; start + P <= T; start++) {
    let ok = true;
    let allFull = true;
    // index (in target seq) of the LAST spanned compound with a non-empty atom remainder.
    let lastRemStart = -1;
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
      // A spanned compound that is a proper SUBSET (deduped syms differ) leaves a remainder —
      // the oracle's remainder-splitting shape (multi-compound only).
      if (fs.compound.syms.size !== ts.compound.syms.size) {
        lastRemStart = start + k;
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
      // compound triggers the oracle's remainder-splitting shape. Two sub-cases, discriminated by
      // whether the span is the WHOLE target seq (sibling-split) or a proper substring (`:is`-wrap):
      //   whole span   `.a>.b.c` f `.a>.b`         → `.a>.b.c,.c.d`         (SIBLING-SPLIT)
      //   substring    `div+.a.c.b>.y.x` f `.a.b>.x` → `div+:is(.a.c.b>.y.x,.q)` (existing `:is`-wrap)
      // Both are now built (was UNSUPPORTED). Only the FIRST span is remainder-split; if a later
      // span also matches we keep the first (the oracle rewrites the first location).
      if (P >= 2 && lastRemStart !== -1 && !remainderSplit) {
        remainderSplit = { wholeSpan: start === 0 && P === T, remStart: lastRemStart, spanStart: start };
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
  return { full, starts, span: P, remainderSplit };
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
  const mStart = m.starts[0]!;
  const spanSel = spanSelector(targetSeq, mStart, m.span);
  const isSel = is(sellist([spanSel, ...extendBranches]));
  for (let i = 0; i < targetSeq.length; i++) {
    if (i < mStart || i >= mStart + m.span) {
      const step = targetSeq[i]!;
      if (i > 0) {
        parts.push(makeCombinator(step.comb));
      }
      const n = compoundNodeOf(step);
      parts.push(typeof n === 'string' ? n : n);
      continue;
    }
    if (i === mStart) {
      if (i > 0) {
        parts.push(makeCombinator(targetSeq[i]!.comb));
      }
      parts.push(isSel);
    }
    // compounds inside the span (i>start) are subsumed by the :is()
  }
  return sel(parts as ComplexSelectorComponent[]);
}

/**
 * extendWith OR-branches for a SIBLING-SPLIT, WITHOUT flattening a `:is()` extendWith. A
 * `SelectorList` extendWith fans out to its items; a `:is(.d,.e)` stays ONE branch (the whole
 * `:is` atom — the oracle keeps `.c:is(.d,.e)`, it does NOT distribute `.c` into each `:is` arm);
 * anything else is one branch. Contrast `extendWithBranches`, which flattens `:is` for FULL append.
 */
function extendWithBranchesUnflat(extendWith: Selector): Selector[] {
  if (isNode(extendWith, N.SelectorList)) {
    return extendWith.value.map(v => (typeof v === 'string' ? wrapString(v) : (v as Selector)));
  }
  return [extendWith];
}

/** The (combinator, compound) steps of an extendWith branch selector, lifted for reassembly. */
function branchSteps(branch: Selector): IrSeq {
  return liftSeq(branch, new SymbolTable());
}

/**
 * SIBLING-SPLIT construction (WHOLE-span multi-compound partial with a remainder). The original
 * target branch is emitted UNCHANGED by the caller; this builds the ONE sibling branch:
 *   sibling = <remainder atoms of the last spanned compound with a remainder>
 *             merged into the HEAD compound of extendWith's FIRST branch, keeping that branch's
 *             rest-of-seq; extendWith's remaining branches follow as separate OR siblings.
 * The target's combinator structure is DROPPED — the sibling starts as a bare compound.
 *
 *   `.a>.b.c` f `.a>.b` ext `.d`      → sibling `.c.d`
 *   `.a>.b.c` f `.a>.b` ext `.d.e`    → sibling `.c.d.e`
 *   `.a>.b.c` f `.a>.b` ext `.d>.e`   → sibling `.c.d>.e`
 *   `.a>.b.c` f `.a>.b` ext (.d,.e)   → siblings `.c.d` , `.e`
 *   `.a>.b.c` f `.a>.b` ext :is(.d,.e)→ sibling `.c:is(.d,.e)`
 */
function buildRemainderSiblings(
  targetSeq: IrSeq,
  m: OwnMatch,
  findSeq: IrSeq,
  extendWith: Selector
): Selector[] {
  const rs = m.remainderSplit!;
  const remStep = targetSeq[rs.remStart]!;
  // Atoms of the remainder compound the aligned find compound did NOT consume.
  const findCompound = findSeq[rs.remStart - rs.spanStart]!.compound;
  const remainderNodes: (Selector | string)[] = [];
  for (const a of remStep.compound.atoms) {
    if (a.kind === 'id' && !findCompound.syms.has(a.sym)) {
      remainderNodes.push(typeof a.node === 'string' ? a.node : a.node);
    }
  }

  const branches = extendWithBranchesUnflat(extendWith);
  const out: Selector[] = [];
  for (let bi = 0; bi < branches.length; bi++) {
    if (bi > 0) {
      // Later extendWith branches follow verbatim as bare OR siblings.
      out.push(branches[bi]!);
      continue;
    }
    const steps = branchSteps(branches[bi]!);
    // Merge the remainder atoms into the HEAD compound of this branch, keeping the rest of the seq.
    const parts: (Selector | string)[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (i > 0) {
        parts.push(makeCombinator(step.comb));
      }
      if (i === 0) {
        const headAtoms: (Selector | string)[] = [...remainderNodes];
        for (const a of step.compound.atoms) {
          headAtoms.push(a.kind === 'id' ? (typeof a.node === 'string' ? a.node : a.node) : (a.node as Selector));
        }
        parts.push(
          headAtoms.length === 1 && typeof headAtoms[0] !== 'string'
            ? (headAtoms[0] as Selector)
            : compound(headAtoms as Parameters<typeof compound>[0])
        );
      } else {
        const n = compoundNodeOf(step);
        parts.push(typeof n === 'string' ? n : n);
      }
    }
    out.push(
      parts.length === 1 && typeof parts[0] !== 'string'
        ? (parts[0] as Selector)
        : sel(parts as ComplexSelectorComponent[])
    );
  }
  return out;
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

/* ============================================================================
 * GRAFT-INTO-TARGET (extending INTO a `:is()` / `:not()` / pseudo-arg graft)
 * ============================================================================
 * A pseudo carrying a selector argument is a RECURSIVE extend point: extend recurses
 * INTO the argument and rewrites there, then rewraps in the SAME pseudo. Verified against
 * the oracle (differential probes, 2026-07-06):
 *
 *   :is(.a,.b)   find .a full/partial  → :is(.a,.b,.c)            (whole inner branch → append)
 *   :not(.foo)   find .foo full/partial→ :not(.foo,.bar)         (recursion, any pseudo)
 *   :is(.a.b)    find .a partial       → :is(:is(.a,.q).b)       (inner subset → wrap in place)
 *   :is(.a.b)    find .a full          → :is(.a.b)               (full: no inner subset match)
 *   .x:not(.foo) find .foo partial     → .x:not(.foo,.q)         (graft passenger recurses)
 *   .x:not(.foo) find .foo full        → .x:not(.foo)            (full: subset of compound → skip)
 *   .x:is(.a,.b) find .a partial       → .x:is(.a,.b,.q)
 *
 * Only `:is()` boundary-crosses into an OUTER compound match (design line 94); `:not/:where/:has`
 * do not contribute reachable syms (handled in `reachableSyms`). The recursion mode passed inward
 * is the OUTER `partial` flag — that reproduces the full/partial split above.
 *
 * Rebuild the pseudo cloning-free: `:is` via the `is()` builder, others via `pseudo({name, arg})`,
 * reusing authored inner nodes; only the freshly-substituted spans are new.
 */

/** True when the compound carries any graft atom (`:is`/`:not`/`:where`/`:has` with a selector arg). */
function compoundHasGraftAtom(c: IrCompound): boolean {
  return c.atoms.some(a => a.kind === 'is');
}

/** Rebuild a graft pseudo with a new argument selector, preserving its name. */
function rebuildGraft(atom: Extract<Atom, { kind: 'is' }>, newArg: Selector): PseudoSelector {
  if (atom.pseudoName === ':is') {
    return is(newArg);
  }
  return pseudo({ name: atom.pseudoName, arg: newArg });
}

/**
 * Wrap a recursion result (Selector | Selector[] | list) back into a single Selector arg for a
 * graft pseudo. A multi-branch (append) result becomes a SelectorList argument.
 */
function graftArgFromResult(result: Selector | Selector[]): Selector {
  if (Array.isArray(result)) {
    return result.length === 1 ? result[0]! : sellist(result);
  }
  return result;
}

/**
 * Recurse INTO a single graft atom's argument and rebuild the pseudo. Returns the rebuilt
 * pseudo (extend applied inside), null (find did not match inside → no change), or UNSUPPORTED.
 * `innerPartial` is the outer partial flag (verified: it reproduces the full/partial split).
 */
function extendIntoGraft(
  atom: Extract<Atom, { kind: 'is' }>,
  find: Selector,
  extendWith: Selector,
  innerPartial: boolean
): PseudoSelector | null | UnsupportedResult {
  const arg = atom.node.arg;
  if (!arg || !isSelectorNode(arg)) {
    return UNSUPPORTED;
  }
  const inner = extendByIndexOwn(arg, find, extendWith, innerPartial);
  if (inner === UNSUPPORTED) {
    return UNSUPPORTED;
  }
  if (inner === 'NOT_FOUND') {
    return null;
  }
  return rebuildGraft(atom, graftArgFromResult(inner));
}

/**
 * Graft-aware construction for a SINGLE-compound find against ONE target compound that carries
 * graft atom(s). Returns the rebuilt compound Selector, null (no match here), or UNSUPPORTED.
 *
 * Classification (single-compound find, findSyms = the find's simple ids):
 *  - find satisfied by the compound's PLAIN atoms alone → grafts are passengers; wrap the plain
 *    atoms (partial) / whole-compound append is handled by the caller (full). We only own the
 *    partial plain-wrap-with-graft-passenger case here.
 *  - find reaches into exactly ONE graft (its syms ⊆ that graft's reachable syms, not the plain
 *    atoms): PARTIAL → recurse into that graft; FULL of a NON-bare compound → subset → unchanged;
 *    FULL of a BARE graft compound → recurse (whole compound IS the graft).
 *  - find spans BOTH plain atoms AND an `:is` graft (`:is(.a,.b).c` find `.a.c`): boundary-cross
 *    flatten — NOT built yet → UNSUPPORTED.
 */
function buildGraftCompound(
  compoundStep: IrStep,
  findSyms: Set<number>,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector | MatchedUnchanged | MatchedFullAppend | null | UnsupportedResult {
  const atoms = compoundStep.compound.atoms;
  const plainSyms = new Set<number>();
  for (const a of atoms) {
    if (a.kind === 'id') {
      plainSyms.add(a.sym);
    }
  }
  const graftAtomIdx: number[] = [];
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i]!.kind === 'is') {
      graftAtomIdx.push(i);
    }
  }
  const isBareCompound = atoms.length === 1;

  const findInPlain = [...findSyms].every(s => plainSyms.has(s));
  if (findInPlain) {
    // Grafts are passengers; the plain atoms carry the match. FULL of the whole compound is the
    // caller's append job; here we only build the PARTIAL wrap of plain atoms (grafts untouched).
    if (!partial) {
      // Full mode: `.info` in `:is(a).info` is a proper SUBSET of the compound → matched but not
      // extended → the compound stays UNCHANGED (distinct from no-match).
      return MATCHED_UNCHANGED;
    }
    const wrapAt = new Set<number>();
    for (let i = 0; i < atoms.length; i++) {
      const at = atoms[i]!;
      if (at.kind === 'id' && findSyms.has(at.sym)) {
        wrapAt.add(i);
      }
    }
    const extendBranches = extendWithBranches(extendWith);
    if (findSyms.size > 1) {
      return buildContiguousWrap(atoms, wrapAt, extendBranches);
    }
    return buildCompoundWithWraps(atoms, wrapAt, extendBranches);
  }

  // find reaches into a graft. It must be satisfiable by a SINGLE graft and NOT require plain
  // atoms (mixed plain+graft is an `:is` boundary case).
  const needsPlain = [...findSyms].some(s => plainSyms.has(s));
  if (needsPlain) {
    // The find spans BOTH plain atoms AND an `:is` graft (e.g. `:is(.a,.b).c` find `.a.c`).
    //  - FULL mode + WHOLE-compound consume (each find sym maps to a distinct plain atom or an
    //    `:is` graft, and every compound atom is consumed) → this is a full match of the compound;
    //    the caller appends extendWith as a sibling and the compound stays unchanged.
    //  - anything else (partial, or not a whole consume) → boundary-cross flatten, not built yet.
    if (!partial && graftFullCompoundConsume(atoms, plainSyms, findSyms)) {
      return MATCHED_FULL_APPEND; // whole-compound full match → caller appends extendWith
    }
    return UNSUPPORTED;
  }
  let hostIdx = -1;
  if (isBareCompound && graftAtomIdx.length === 1) {
    // The whole compound IS a single graft (`:is(...)`, `:not(...)`): recurse into it and let the
    // recursion decide match — the find may live anywhere inside (not just a branch head), so we
    // do NOT gate on head-reachableSyms here.
    hostIdx = graftAtomIdx[0]!;
  } else {
    for (const gi of graftAtomIdx) {
      const g = atoms[gi] as Extract<Atom, { kind: 'is' }>;
      const reach = reachableSymsOfGraft(g);
      if ([...findSyms].every(s => reach.has(s))) {
        if (hostIdx !== -1) {
          return UNSUPPORTED; // ambiguous — more than one graft could host
        }
        hostIdx = gi;
      }
    }
  }
  if (hostIdx === -1) {
    return null; // no graft hosts the find
  }

  if (!partial && !isBareCompound) {
    // FULL mode, find only reaches a graft inside a larger compound → subset match, not full →
    // unchanged (e.g. `.x:is(.a,.b)` find `.a` full → `.x:is(.a,.b)`).
    return MATCHED_UNCHANGED;
  }

  const host = atoms[hostIdx] as Extract<Atom, { kind: 'is' }>;
  const rebuilt = extendIntoGraft(host, find, extendWith, partial);
  if (rebuilt === UNSUPPORTED) {
    return UNSUPPORTED;
  }
  if (rebuilt === null) {
    return null;
  }
  // Reassemble the compound with the rewritten graft in place.
  if (isBareCompound) {
    return rebuilt;
  }
  const parts: (Selector | string)[] = [];
  for (let i = 0; i < atoms.length; i++) {
    if (i === hostIdx) {
      parts.push(rebuilt);
    } else {
      const a = atoms[i]!;
      parts.push(a.kind === 'id' ? (typeof a.node === 'string' ? a.node : a.node) : (a.node as Selector));
    }
  }
  return compound(parts as Parameters<typeof compound>[0]);
}

/** Reachable simple-id syms available for matching through a single graft atom (only `:is` reaches). */
function reachableSymsOfGraft(g: Extract<Atom, { kind: 'is' }>): Set<number> {
  const out = new Set<number>();
  if (g.pseudoName !== ':is') {
    // :not/:where/:has do not reach for OUTER matching, but the find can still be extended INTO
    // them (recursion). For hosting decisions we still need to know if the find lives inside, so
    // union the inner branch head syms here (used only to route recursion, not outer reachability).
    for (const branch of g.sel.branches) {
      if (branch.length >= 1) {
        for (const s of reachableSyms(branch[0]!.compound)) {
          out.add(s);
        }
      }
    }
    return out;
  }
  for (const branch of g.sel.branches) {
    if (branch.length >= 1) {
      for (const s of reachableSyms(branch[0]!.compound)) {
        out.add(s);
      }
    }
  }
  return out;
}

/**
 * WHOLE-COMPOUND full consume for a graft-bearing compound (`:is(...)` boundary reach): every
 * compound atom must be consumed by exactly one find sym — a plain atom by an equal find sym, an
 * `:is` graft atom by a find sym reaching one of its branch heads — and no find sym left over.
 * (Only `:is` reaches; `:not/:where/:has` never contribute to an outer full match.) This is the
 * multiset "side-to-side full match" over the compound, e.g. `:is(.a,.b).c` find `.a.c` → full.
 */
function graftFullCompoundConsume(
  atoms: Atom[],
  plainSyms: Set<number>,
  findSyms: Set<number>
): boolean {
  // Each compound atom consumes exactly one distinct find sym; count must match (multiset).
  if (atoms.length !== findSyms.size) {
    return false;
  }
  const remaining = new Set<number>(findSyms);
  for (const a of atoms) {
    if (a.kind === 'id') {
      if (!remaining.delete(a.sym)) {
        return false;
      }
    } else if (a.kind === 'is' && a.pseudoName === ':is') {
      const reach = reachableSymsOfGraft(a);
      let consumed = -1;
      for (const s of remaining) {
        if (reach.has(s)) {
          consumed = s;
          break;
        }
      }
      if (consumed === -1) {
        return false;
      }
      remaining.delete(consumed);
    } else {
      return false; // a non-:is graft cannot participate in an outer full match
    }
  }
  return remaining.size === 0 && plainSyms.size <= findSyms.size;
}

/**
 * Graft-aware per-branch construction. Handles a target branch (seq) where at least one compound
 * carries a graft atom, for a SINGLE-compound find. Returns the built Selector, null (no match in
 * this branch), or UNSUPPORTED.
 */
interface GraftBranchResult {
  node: Selector;
  /** an extend was actually applied (rewrite produced) */
  effective: boolean;
  /** a match location was found (even if full-mode-subset → unchanged) */
  found: boolean;
  /** a whole-compound full match through an `:is` boundary → caller appends extendWith */
  appendFull: boolean;
}

function buildGraftBranch(
  targetSeq: IrSeq,
  findSeq: IrSeq,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): GraftBranchResult | UnsupportedResult {
  if (findSeq.length !== 1) {
    return UNSUPPORTED; // multi-compound find against a graft-bearing target: not built yet
  }
  const findSyms = findSeq[0]!.compound.syms;

  const rebuiltParts: (Selector | string)[] = [];
  let effective = false;
  let found = false;
  let appendFull = false;
  for (let i = 0; i < targetSeq.length; i++) {
    const step = targetSeq[i]!;
    if (i > 0) {
      rebuiltParts.push(makeCombinator(step.comb));
    }
    const built = compoundHasGraftAtom(step.compound)
      ? buildGraftCompound(step, findSyms, find, extendWith, partial)
      : matchPlainCompound(step, findSyms, find, extendWith, partial);
    if (built === UNSUPPORTED) {
      return UNSUPPORTED;
    }
    if (built === null) {
      rebuiltParts.push(compoundStepNode(step));
    } else if (built === MATCHED_UNCHANGED) {
      rebuiltParts.push(compoundStepNode(step));
      found = true;
    } else if (built === MATCHED_FULL_APPEND) {
      // Only a SINGLE-compound branch can be a whole-branch full match through an `:is` boundary.
      if (targetSeq.length !== 1) {
        return UNSUPPORTED;
      }
      rebuiltParts.push(compoundStepNode(step));
      found = true;
      appendFull = true;
    } else {
      rebuiltParts.push(built);
      effective = true;
      found = true;
    }
  }
  const node =
    rebuiltParts.length === 1 && typeof rebuiltParts[0] !== 'string'
      ? (rebuiltParts[0] as Selector)
      : sel(rebuiltParts as ComplexSelectorComponent[]);
  return { node, effective, found, appendFull };
}

/** The authored node for a whole compound step (reused, no clone). */
function compoundStepNode(step: IrStep): Selector | string {
  const n = step.compound.node;
  return typeof n === 'string' ? n : (n as Selector);
}

/**
 * Ordinary single-compound match against a PLAIN target compound (no grafts), returning the
 * rewritten compound (partial wrap), null (no match / full-subset skip), or UNSUPPORTED.
 * This mirrors the plain-path logic for one compound so a graft-bearing branch can still extend
 * its plain compounds (e.g. `:is(.foo,.a) .bar` find `.bar` → the `.bar` compound is plain).
 */
function matchPlainCompound(
  step: IrStep,
  findSyms: Set<number>,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector | MatchedUnchanged | null | UnsupportedResult {
  const available = step.compound.syms;
  if (![...findSyms].every(s => available.has(s))) {
    return null;
  }
  if (!partial) {
    // Full match of a whole plain compound only when multiset-equal; a graft-bearing branch is
    // never a whole-branch full match for a single-compound find, so full-mode plain compounds
    // in this path are subset matches → unchanged (found, but not extended).
    return MATCHED_UNCHANGED;
  }
  const atoms = step.compound.atoms;
  const wrapAt = new Set<number>();
  for (let i = 0; i < atoms.length; i++) {
    const at = atoms[i]!;
    if (at.kind === 'id' && findSyms.has(at.sym)) {
      wrapAt.add(i);
    }
  }
  const extendBranches = extendWithBranches(extendWith);
  if (findSyms.size > 1) {
    return buildContiguousWrap(atoms, wrapAt, extendBranches);
  }
  return buildCompoundWithWraps(atoms, wrapAt, extendBranches);
}

/**
 * Graft-into-target entry: the target carries a graft atom. Handle it via graft-aware
 * per-branch construction; returns the assembled output or UNSUPPORTED. Full-mode append
 * (bare `:is` whole-branch match handled inside buildGraftBranch by recursion) and partial
 * rewrites are both covered.
 */
function extendGraftTarget(
  targetSel: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector | Selector[] | 'NOT_FOUND' | UnsupportedResult {
  const syms = new SymbolTable();
  const irTarget = liftSel(targetSel, syms);
  const irFind = liftSel(find, syms);
  if (irFind.branches.length !== 1) {
    return UNSUPPORTED;
  }
  const findSeq = irFind.branches[0]!;

  const outBranches: Selector[] = [];
  const appendBranches: Selector[] = [];
  let anyEffective = false;
  let anyFound = false;
  for (const tb of irTarget.branches) {
    if (branchHasGraft(tb)) {
      const built = buildGraftBranch(tb, findSeq, find, extendWith, partial);
      if (built === UNSUPPORTED) {
        return UNSUPPORTED;
      }
      outBranches.push(built.node);
      if (built.effective) {
        anyEffective = true;
      }
      if (built.found) {
        anyFound = true;
      }
      if (built.appendFull) {
        anyEffective = true;
        for (const eb of extendWithBranches(extendWith)) {
          appendBranches.push(eb);
        }
      }
      continue;
    }
    // Plain branch inside a graft-bearing target list (e.g. `:is(.a), .z`): use the plain locate.
    const loc = locateFind(tb, findSeq);
    if (loc === UNSUPPORTED) {
      return UNSUPPORTED;
    }
    if (loc === null) {
      outBranches.push(seqToSelector(tb));
      continue;
    }
    anyFound = true;
    if (loc.full) {
      // full match on a plain branch → append extendWith after all branches
      outBranches.push(seqToSelector(tb));
      anyEffective = true;
      for (const eb of extendWithBranches(extendWith)) {
        appendBranches.push(eb);
      }
    } else if (partial) {
      const built = buildPartialBranch(tb, loc, findSeq, extendWithBranches(extendWith));
      if (built === UNSUPPORTED) {
        return UNSUPPORTED;
      }
      outBranches.push(built);
      anyEffective = true;
    } else {
      // full mode, proper-subset match → unchanged branch (found, not extended)
      outBranches.push(seqToSelector(tb));
    }
  }

  if (!anyFound) {
    return 'NOT_FOUND';
  }
  for (const eb of appendBranches) {
    outBranches.push(eb);
  }
  if (!anyEffective) {
    // Matched only as a proper subset (full mode) → target returned unchanged.
    return targetSel;
  }
  if (outBranches.length === 1) {
    return outBranches[0]!;
  }
  return sellist(outBranches);
}

function branchHasGraft(seq: IrSeq): boolean {
  return seq.some(step => compoundHasGraftAtom(step.compound));
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

  // `&` and constructor-atom FINDS are not built by the own engine yet. Gate to UNSUPPORTED
  // (never a wrong/NOT_FOUND answer). A `:not`/`:where`/`:has` FIND (pseudo-arg on the find side)
  // is caught by the node-level `findHasPseudoWithSelectorArg` guard below.
  if (hasAmpersand(targetSel) || hasAmpersand(find) || hasConstructorAtoms(find)) {
    return UNSUPPORTED;
  }
  if (nodeHasPseudoWithSelectorArg(find)) {
    return UNSUPPORTED; // find is/contains a `:is`/`:not`/pseudo-arg graft — not built yet
  }

  // GRAFT-INTO-TARGET: the target is or contains a `:is(...)`/`:not(...)`/pseudo-with-selector-arg.
  // Extend recurses INTO the graft (own construction), byte-identical to the oracle on the covered
  // shapes; boundary-cross flatten (`:is(.a,.b).c` find `.a.c` partial) stays UNSUPPORTED.
  if (hasGraftTarget(targetSel, find)) {
    return extendGraftTarget(targetSel, find, extendWith, partial);
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
  const branchResults: Array<{
    node: Selector;
    matchedFull: boolean;
    matchedPartial: boolean;
    /** SIBLING-SPLIT: siblings appended after all original branches (branch node stays unchanged). */
    siblings?: Selector[];
  }> = [];
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
      } else if (loc.remainderSplit?.wholeSpan) {
        // WHOLE-span multi-compound partial with a remainder → SIBLING-SPLIT: original branch
        // stays unchanged, one sibling (+ extendWith list tail) is appended after all branches.
        const siblings = buildRemainderSiblings(tb, loc, findSeq, extendWith);
        branchResults.push({ node: seqToSelector(tb), matchedFull: false, matchedPartial: true, siblings });
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
  // full matches APPEND extendWith branches after all original branches; sibling-splits append
  // their sibling branch(es) after all original branches (branch node itself unchanged).
  const outBranches: Selector[] = [];
  const siblingBranches: Selector[] = [];
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
    if (br.siblings) {
      for (const s of br.siblings) {
        siblingBranches.push(s);
      }
    }
  }
  if (anyFull) {
    for (const eb of extendBranches) {
      outBranches.push(eb);
    }
  }
  for (const s of siblingBranches) {
    outBranches.push(s);
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
