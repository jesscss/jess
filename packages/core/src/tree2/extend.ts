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
  segs.push({
    comb: c.leadingComb ?? ' ',
    compound: compoundFromSimples(c.head.simples.map((s) => s.text)),
  });
  for (const seg of c.tail) {
    segs.push({ comb: seg.comb, compound: compoundFromSimples(seg.compound.simples.map((s) => s.text)) });
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

/** Substitute every `&` text token in `child` with the parent's rendered text. */
function substituteAmp(child: Branch, parent: Branch): Branch {
  const parentStr = branchText(parent);
  const segs = child.segs.map((seg) => ({
    comb: seg.comb,
    compound: {
      simples: seg.compound.simples.map((s): Simple =>
        s.t === 'text' && s.text.includes('&')
          ? { t: 'text', text: s.text.split('&').join(parentStr) }
          : cloneSimple(s),
      ),
    },
  }));
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
    if (bKey === targetKey) {
      // whole-branch match → append extenders as siblings.
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
}

interface Plan {
  subjects: PlanSubject[];
  instructions: PlanInstruction[];
}

function collectPlan(root: Root): Plan {
  const subjects: PlanSubject[] = [];
  const instructions: PlanInstruction[] = [];
  let order = 0;
  let scopeCounter = 0;

  const walk = (statements: Statement[], path: Level[], scope: number[]): void => {
    for (const st of statements) {
      if (st.kind === Kind.Rule) {
        const rule = st;
        const own = levelFromSelectorList(rule.selector);
        const rulePath = [...path, own];
        subjects.push({ rule, path: rulePath, scope });
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
            }
          }
        }
        walk(rule.body, rulePath, scope);
      } else if (st.kind === Kind.AtRuleBlock) {
        const inner = [...scope, scopeCounter++];
        walk(st.body, path, inner);
      }
      // MixinDef / MixinCall / declarations / at-rule statements: no extend surface.
    }
  };

  walk(root.children, [], []);
  return { subjects, instructions };
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

/* --------------------------------------------------------------- EMIT/compose */

/** The ancestor keys of a subject path (every level's branch texts EXCEPT own). */
function ancestorKeys(path: Level[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    for (const b of path[i]!) keys.add(branchText(b));
  }
  return keys;
}

/**
 * Compose an extender's contribution relative to a subject path — the tree2
 * analogue of `composeExtendWithRelativeToTarget`. Collect the extender path
 * levels from its own local outward, stopping at a level shared with the
 * subject's ancestors, then compose outermost → innermost.
 */
function composeContribution(extenderPath: Level[], subjectPath: Level[]): Branch[] {
  const anc = ancestorKeys(subjectPath);
  const levels: Level[] = [];
  for (let i = extenderPath.length - 1; i >= 0; i--) {
    const level = extenderPath[i]!;
    // A level is shared when ALL its branches are subject ancestors.
    if (level.every((b) => anc.has(branchText(b)))) break;
    levels.unshift(level);
  }
  if (levels.length === 0) return [];
  return composePath(levels);
}

/* --------------------------------------------------------------- SOLVE */

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
  const reachable = plan.instructions.filter((i) => reaches(i.scope, subject.scope));
  const seed = composePath(subject.path);
  if (reachable.length === 0) return seed;
  const contribs = new Map<PlanInstruction, { extenders: Branch[]; keys: Set<string> }>();
  for (const inst of reachable) {
    const extenders = composePath(inst.extenderPath);
    contribs.set(inst, { extenders, keys: new Set(extenders.map(branchText)) });
  }
  return runFixpoint(seed.map(cloneBranch), reachable, contribs);
}

function solveSubject(subject: PlanSubject, plan: Plan, partialOnly: boolean): Branch[] {
  const own = subject.rule ? levelFromSelectorList(subject.rule.selector) : [];
  let list = own.map(cloneBranch);

  const reachable = plan.instructions.filter(
    (i) => reaches(i.scope, subject.scope) && (!partialOnly || i.partial),
  );
  if (reachable.length === 0) return list;

  // Precompute each instruction's extender contributions relative to this subject.
  const contribs = new Map<PlanInstruction, { extenders: Branch[]; keys: Set<string> }>();
  for (const inst of reachable) {
    const extenders = composeContribution(inst.extenderPath, subject.path);
    contribs.set(inst, { extenders, keys: new Set(extenders.map(branchText)) });
  }
  return runFixpoint(list, reachable, contribs);
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

/* --------------------------------------------------------------- public API */

/** One subject rule's extended own-local branch list, as text + `&` flag. */
export interface ExtendedBranch {
  text: string;
  hasAmp: boolean;
}

export interface ExtendResults {
  /**
   * FLAT mode: per-rule EXTENDED, fully-composed header branch strings. The
   * serializer emits these as the rule's header (children still compose against
   * the RAW parent and extend independently — the composed model needs no
   * child-parent propagation).
   */
  flatByRule: Map<Rule, string[]>;
  /**
   * NESTED mode: per-rule EXTENDED own-local header branches (text + `&` flag).
   * Nested keeps authored structure; only the local header is rewritten.
   */
  nestedByRule: Map<Rule, ExtendedBranch[]>;
}

function toExtendedBranches(list: Branch[]): ExtendedBranch[] {
  return list.map((b) => ({ text: branchText(b), hasAmp: branchHasAmp(b) }));
}

/**
 * Compute extend results for a bridged tree2 root. Returns `null` when the
 * document has NO `:extend()` at all (the serializer's zero-cost gate).
 */
export function computeExtends(root: Root): ExtendResults | null {
  const plan = collectPlan(root);
  if (plan.instructions.length === 0) return null;

  const flatByRule = new Map<Rule, string[]>();
  const nestedByRule = new Map<Rule, ExtendedBranch[]>();
  for (const subject of plan.subjects) {
    // FLAT — solve over the composed selector.
    const rawComposed = composePath(subject.path);
    const flat = solveComposed(subject, plan);
    if (listKey(flat) !== listKey(rawComposed)) {
      flatByRule.set(subject.rule, flat.map(branchText));
    }
    // NESTED — solve over the own-local selector.
    const own = levelFromSelectorList(subject.rule.selector);
    const nested = solveSubject(subject, plan, false);
    if (listKey(nested) !== listKey(own)) {
      nestedByRule.set(subject.rule, toExtendedBranches(nested));
    }
  }
  return { flatByRule, nestedByRule };
}
