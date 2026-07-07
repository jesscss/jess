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

  const discovery = discover(targetSel, find, partial);
  if (!discovery.matched) {
    // Discovery says no match. It is AUTHORITATIVE (may short-circuit to NOT_FOUND) when
    // the selectors carry no `&` — `:is()` grafting is modeled soundly in reachableSyms,
    // but `&` crossing/hoist semantics are delegated, so an `&` present means discovery's
    // "no plain/:is() match" is not the final word (a parent-graft match could exist).
    // A find carrying its own constructor atom is likewise delegated.
    if (!hasAmpersand(targetSel) && !hasConstructorAtoms(find)) {
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
