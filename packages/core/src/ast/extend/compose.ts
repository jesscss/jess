/**
 * Composition (nesting) — folds an ancestor path of selector levels into flat
 * branches exactly as the serializer composes authored nesting, including `&`
 * substitution against the parent context.
 *
 * [&-boundary] A `&`-compose now SPLICES the parent's segments in as SEPARATE
 * `SelectorPart`s (`.f {…}` under `.outer .mid` yields the three segments `.outer .mid .leaf`,
 * never one embedded-space text simple), and every composed branch carries a
 * per-segment `bnd` origin (`0` = own-local, `k>0` = the k-th enclosing `&`-hop).
 * The `bnd` marker is what lets the matcher tell a match that stays inside the
 * ruleset's own selector from one that crosses (or lives entirely inside) the
 * ampersand — the structural replacement for the old text-prefix hoist heuristics.
 * Serialization is unchanged: a spliced multi-segment parent renders byte-identically
 * to the old collapsed text (`.outer .mid` either way).
 */

import {
  branchText,
  cloneBranch,
  cloneSeg,
  cloneSimple,
  descendantBranch,
  isSimple,
  levelFromSelectorList,
  mkBranch,
  simpleText,
  textSimple
} from './ir.js';
import type { Branch, Level, SelectorPart, Simple } from './ir.js';
import { pseudoJoin, textHoldsParentRef } from '../nodes.js';
import type { PseudoSelector, SimpleToken } from '../nodes.js';
import { irEndsWithPseudoElement, isUserActionPseudoClass } from '../is-grouping.js';
import { leadsWithElement, placeComplex } from './conflict.js';

/**
 * The parser token a name continuation of `s` stands for: `s` is a text token the
 * parser built as a class, id or type name, so `&-x` glued onto it (`.btn` → `.btn-x`)
 * is still one simple of that kind. Undefined for any other token.
 */
function continuedName(s: Simple): SimpleToken | undefined {
  if (s.t !== 'text' || s.src === undefined || 'value' in s.src || s.src.type !== 'SimpleSelector') {
    return undefined;
  }
  const first = s.text.charCodeAt(0);
  return first === 0x2E /* . */ || first === 0x23 /* # */ || first === 0x2D /* - */ || first === 0x5F /* _ */
    || first >= 0x80 || ((first | 32) >= 0x61 && (first | 32) <= 0x7A)
    ? s.src
    : undefined;
}

/**
 * The token an `&` concatenation composes. A parser token that opens with its one `&`
 * (`&-x`) continues the name before it, so under a one-simple class, id or type parent
 * (`.btn`) the join (`.btn-x`) is one simple of that kind and stands for the parent's
 * token, which the `:is()` grouping scores (`../is-grouping.ts`). Any other join
 * (`.x&`, `&-x` under `.a.b`) has no parser token for its kind and stays out of every
 * group.
 */
function joinedSimple(text: string, ampToken: string, tail: Simple | undefined): Simple {
  const src = tail !== undefined && ampToken.charCodeAt(0) === 0x26 /* & */ && ampToken.indexOf('&', 1) === -1
    ? continuedName(tail)
    : undefined;
  return textSimple(text, undefined, src);
}

/** A text token holding a parent reference (its kind decides, `../nodes.ts`). */
function holdsAmp(s: Simple): boolean {
  return s.t === 'text' && textHoldsParentRef(s.text);
}

export function branchHasAmp(b: Branch): boolean {
  for (const seg of b.segments) {
    for (const s of seg.compound.value) {
      if (s.t === 'text') {
        if (textHoldsParentRef(s.text)) {
          return true;
        }
      } else if (s.branches.some(branchHasAmp)) {
        return true;
      }
    }
  }
  return false;
}

/** The `bnd` origin of a branch's segment `k`, defaulting to own-local (`0`) when
 * the branch carries no origin array (a raw own-local level before any compose). No
 * allocation — the common no-nested-`&` branch reads its implicit `0` directly. */
function bndAt(b: Branch, k: number): number {
  return b.bnd ? b.bnd[k]! : 0;
}

/** Stamp `arr` as the branch's per-segment origin. `undefined` is left as-is (the
 * "all own-local" default); an all-zero array is elided so a document with no nested
 * `&`-compose carries no `bnd` allocation and every reader's `?? 0` default holds. */
function withBnd(b: Branch, arr: number[]): Branch {
  for (const v of arr) {
    if (v !== 0) {
      b.bnd = Int8Array.from(arr);
      return b;
    }
  }
  return b;
}

/** True when a compound is exactly one bare `&` simple (`&`, as its own segment) —
 * the standalone ampersand that SPLICES the parent's segments in. A fused `.f&` or a
 * pure-`&` self-compound (`&&`) is NOT this case (handled by text substitution). */
function isBareAmp(seg: SelectorPart): boolean {
  const s = seg.compound.value;
  return s.length === 1 && s[0]!.t === 'text' && s[0]!.text === '&';
}

/** The single-compound parent's structured selector value, or null when its
 * substitution can stay on the existing text-only path. Called only after a fused
 * ampersand is found; bare `&` and amp-free branches never pay this scan. A parent
 * that ends with a pseudo-element stays structured too, so an `all` extend still
 * reaches the simples before it (`.a::before { &:hover {} }` and
 * `.z:extend(.a all)` give `:is(.a, .z)::before:hover`), as it does through a
 * parent list's `:is()`. */
function structuredParentValue(parent: Branch): Simple[] | null {
  const value = parent.segments[0]!.compound.value;
  for (let index = 0; index < value.length; index++) {
    if (value[index]!.t === 'is') {
      return value;
    }
  }
  return value.length > 1 && irEndsWithPseudoElement(parent) ? value : null;
}

/**
 * Substitute every `&` in `child` against the parent selector, producing a branch
 * whose `bnd` records each output segment's origin. A STANDALONE `&` (its own
 * segment) splices the parent's SEGMENTS in place — separate `SelectorPart`s carrying
 * `bnd = parentBnd + 1` — so a multi-segment parent (`.outer .mid`) stays matchable
 * per segment — where it opens the selector. Anywhere else a MULTI-segment parent is
 * one `:is(parent)` unit, and a `&` FUSED into a compound under one is placed as the
 * serializer composes it ({@link placeFusedAmp}); a parent ending with a pseudo-element
 * keeps the old splice ({@link spliceFusedAmp}), since `:is()` cannot hold it. A
 * single-compound structured parent keeps its `:is()` graft typed so the extend matcher
 * can still cross its arms; an ordinary text-only parent keeps the direct string
 * substitution. Own segments are `bnd = 0`.
 */
function substituteAmp(child: Branch, parent: Branch): Branch {
  const parentMultiSeg = parent.segments.length > 1;
  let parentStr: string | undefined;
  let structuredParent: Simple[] | null | undefined;
  const outSegs: SelectorPart[] = [];
  const outBnd: number[] = [];
  const place = parentMultiSeg && !irEndsWithPseudoElement(parent);
  for (let i = 0; i < child.segments.length; i++) {
    const seg = child.segments[i]!;

    /* The compound that opens the selector: nothing, not even a combinator, before it. */
    const head = i === 0 && seg.combinator === ' ';
    if (place && !head && isBareAmp(seg)) {
      outSegs.push({ combinator: seg.combinator, compound: { value: [isSimple([parent], false)] } });
      outBnd.push(bndAt(parent, parent.segments.length - 1) + 1);
      continue;
    }
    if (isBareAmp(seg)) {
      /*
       * Splice the parent's segments in. The first spliced segment takes THIS `&`
       * segment's combinator (its position in the child complex); the rest keep the
       * parent's own internal combinators. Each carries the parent's origin + 1.
       */
      for (let k = 0; k < parent.segments.length; k++) {
        const ps = parent.segments[k]!;
        outSegs.push({ combinator: k === 0 ? seg.combinator : ps.combinator, compound: { value: ps.compound.value.map(cloneSimple) } });
        outBnd.push(bndAt(parent, k) + 1);
      }
      continue;
    }
    if (parentMultiSeg && compoundHasAmp(seg.compound.value)) {
      if (!place || !placeFusedAmp(seg, head, parent, outSegs, outBnd)) {
        spliceFusedAmp(seg, parent, outSegs, outBnd);
      }
      continue;
    }
    const value: Simple[] = [];
    for (const s of seg.compound.value) {
      if (s.t !== 'text' || !textHoldsParentRef(s.text)) {
        value.push(withParent(s, parent));
        continue;
      }
      if (s.text === '&') {
        if (structuredParent === undefined) {
          structuredParent = structuredParentValue(parent);
        }
        if (structuredParent !== null) {
          for (let index = 0; index < structuredParent.length; index++) {
            value.push(structuredParent[index]!);
          }
          continue;
        }
      }
      parentStr ??= branchText(parent);

      /* A lone `&` under a one-compound parent stands for that compound. */
      const parentValue = parent.segments[0]!.compound.value;
      value.push(s.text === '&'
        ? textSimple(parentStr, undefined, parent.segments[0]!.compound)
        : joinedSimple(s.text.split('&').join(parentStr), s.text, parentValue.length === 1 ? parentValue[0] : undefined));
    }

    /* A fused/own segment is the ruleset's own element target, own-local (`bnd = 0`). */
    outSegs.push({ combinator: seg.combinator, compound: { value } });
    outBnd.push(0);
  }
  return withBnd(mkBranch(outSegs), outBnd);
}

function compoundHasAmp(value: readonly Simple[]): boolean {
  for (const s of value) {
    if (holdsAmp(s)) {
      return true;
    }
  }
  return false;
}

/**
 * A `&` fused into `seg`'s compound under a parent of several compounds, as the serializer
 * composes it (`serialize.ts` `placeParent`; owner 2026-10-09): the `&` is a plain reference
 * to the parent, `:is(parent)`. In the compound that opens the selector (`head`) the first
 * `&` writes the parent in place, the compound's other simples joined to its LAST compound,
 * a type or universal selector leading it — `.q&` and `&.q` under `.b .p` are `.b .p.q`,
 * `div&` is `.b div.p`. Every other `&` is one `:is(parent)` simple where it stands
 * (`.c .q&` → `.c .q:is(.b .p)`), as is the first where the parent's last compound and the
 * simples before the `&` both hold an element selector (`div&` under `.b span`). A `&-x`
 * stands for the parent with `-x` continuing its last simple ({@link namedParent}). A pseudo
 * whose argument holds a `&` composes that argument ({@link withParent}). False, writing
 * nothing, for a token holding a `&` after other text (`.q&` read as one token), which keeps
 * {@link spliceFusedAmp}. A segment holding the child's own simples is own-local
 * (`bnd = 0`); a parent compound written alone keeps the parent's origin + 1.
 */
function placeFusedAmp(seg: SelectorPart, head: boolean, parent: Branch, outSegs: SelectorPart[], outBnd: number[]): boolean {
  const value = seg.compound.value;
  let at = -1;
  for (let p = 0; p < value.length; p++) {
    const s = value[p]!;
    if (s.t !== 'text' || !textHoldsParentRef(s.text) || pseudoWithArgs(s) !== null) {
      continue;
    }
    if (s.text.charCodeAt(0) !== 0x26 /* & */ || s.text.indexOf('&', 1) !== -1) {
      return false;
    }
    if (head && at === -1) {
      at = p;
    }
  }
  const named = at === -1 ? null : namedParent(parent, value[at]!);
  const ps = named?.segments;
  const last = ps === undefined ? 0 : ps.length - 1;
  const lead = at > 0 && leadsWithElement(simpleText(value[0]!), 0);
  if (named === null || ps === undefined || (lead && leadsWithElement(simpleText(ps[last]!.compound.value[0]!), 0))) {
    outSegs.push({ combinator: seg.combinator, compound: { value: value.map(s => withParent(s, parent)) } });
    outBnd.push(0);
    return true;
  }
  const others: Simple[] = [];
  for (let p = 0; p < value.length; p++) {
    if (p !== at) {
      others.push(withParent(value[p]!, parent));
    }
  }

  /* No element selector meets another here (checked above), so it is placed. */
  const placed = placeComplex(ps, others, seg.combinator)!;
  for (let k = 0; k < last; k++) {
    outSegs.push(placed[k]!);
    outBnd.push(bndAt(parent, k) + 1);
  }
  outSegs.push(placed[last]!);
  outBnd.push(others.length > 0 || named !== parent ? 0 : bndAt(parent, last) + 1);
  return true;
}

/** The structured pseudo a text token was built from, when its argument is a selector list. */
function pseudoWithArgs(s: Simple): PseudoSelector | null {
  return s.t === 'text' && s.src !== undefined && !('value' in s.src) && s.src.type === 'PseudoSelector' && s.src.args !== null
    ? s.src
    : null;
}

/**
 * One simple of a compound composed under a parent of several compounds where it stands:
 * a `&` is `:is(parent)`, a pseudo whose selector argument holds a `&` has each argument
 * branch composed ({@link argWithParent}; `:not(.c &)` → `:not(.c :is(.b .p))`), any other
 * simple is itself.
 */
function withParent(s: Simple, parent: Branch): Simple {
  if (s.t === 'is') {
    return branchesHaveAmp(s.branches) ? { t: 'is', branches: argsWithParent(s.branches, parent), fold: s.fold } : cloneSimple(s);
  }
  if (!holdsAmp(s)) {
    return cloneSimple(s);
  }
  const pseudo = pseudoWithArgs(s);
  if (pseudo === null) {
    return isSimple([namedParent(parent, s)], false);
  }
  return textSimple(pseudoJoin(pseudo, argsWithParent(levelFromSelectorList(pseudo.args!), parent).map(branchText)));
}

function branchesHaveAmp(branches: readonly Branch[]): boolean {
  for (const b of branches) {
    if (branchHasAmp(b)) {
      return true;
    }
  }
  return false;
}

/**
 * The branches of a selector argument (`:is(…)`, `:not(…)`) with each `&` composed against
 * `parent`. An argument is a whole selector, so a branch without a `&` is itself, and a
 * branch that is only `&` stands for the parent's own list where the parent is one `:is()`
 * (`:is(&)` under `.a, .c .d` → `:is(.a, .c .d)`, as the serializer writes it).
 */
function argsWithParent(branches: readonly Branch[], parent: Branch): Branch[] {
  const out: Branch[] = [];
  for (const b of branches) {
    if (!branchHasAmp(b)) {
      out.push(b);
      continue;
    }
    const only = parent.segments.length === 1 && parent.segments[0]!.compound.value.length === 1 ? parent.segments[0]!.compound.value[0]! : null;
    if (only !== null && only.t === 'is' && b.segments.length === 1 && isBareAmp(b.segments[0]!) && b.segments[0]!.combinator === ' ') {
      for (const arm of only.branches) {
        out.push(arm);
      }
      continue;
    }
    const composed = substituteAmp(b, parent);
    composed.bnd = undefined;
    out.push(composed);
  }
  return out;
}

/** The selector a `&` token stands for: the parent itself, or for `&-x` the parent with
 * `-x` continuing its last simple (`.b .p-x`). */
function namedParent(parent: Branch, s: Simple): Branch {
  const text = simpleText(s);
  if (text.length === 1) {
    return parent;
  }
  const segments = parent.segments.slice();
  const last = segments.length - 1;
  const value = segments[last]!.compound.value.slice();
  const tail = value[value.length - 1]!;
  value[value.length - 1] = joinedSimple(simpleText(tail) + text.slice(1), text, tail);
  segments[last] = { combinator: segments[last]!.combinator, compound: { value } };
  return mkBranch(segments);
}

/**
 * A `&` fused into `seg`'s compound under a parent of several compounds that ends with a
 * pseudo-element (or a token holding a `&` after other text), spliced as the serializer
 * writes that parent's text in place (ledger X5; the parent cannot sit in `:is()`, O17):
 * the simples before the `&` join the parent's first compound, the parent's inner
 * compounds follow, and the simples after it join the parent's last compound. A suffix
 * glued to the `&` token (`&-foo`) continues the parent's last simple
 * ({@link joinedSimple}). A segment holding any of the child's own simples is own-local
 * (`bnd = 0`); a parent compound spliced alone keeps the parent's origin + 1.
 */
function spliceFusedAmp(seg: SelectorPart, parent: Branch, outSegs: SelectorPart[], outBnd: number[]): void {
  const ps = parent.segments;
  const last = ps.length - 1;
  let combinator = seg.combinator;
  let value: Simple[] = [];
  let own = false;
  for (const s of seg.compound.value) {
    if (!holdsAmp(s)) {
      value.push(cloneSimple(s));
      own = true;
      continue;
    }
    const text = simpleText(s);
    const parts = text.split('&');
    if (parts[0]!.length > 0) {
      value.push(textSimple(parts[0]!));
      own = true;
    }
    for (let i = 1; i < parts.length; i++) {
      for (const p of ps[0]!.compound.value) {
        value.push(cloneSimple(p));
      }
      outSegs.push({ combinator, compound: { value } });
      outBnd.push(own ? 0 : bndAt(parent, 0) + 1);
      for (let k = 1; k < last; k++) {
        outSegs.push(cloneSeg(ps[k]!));
        outBnd.push(bndAt(parent, k) + 1);
      }
      combinator = ps[last]!.combinator;
      value = ps[last]!.compound.value.map(cloneSimple);
      own = false;
      const suffix = parts[i]!;
      if (suffix.length > 0) {
        const tail = value[value.length - 1]!;
        value[value.length - 1] = joinedSimple(simpleText(tail) + suffix, text, tail);
        own = true;
      }
    }
  }
  outSegs.push({ combinator, compound: { value } });
  outBnd.push(own || value.length === 0 ? 0 : bndAt(parent, last) + 1);
}

/** The parent token for composing a child under a multi-branch parent. */
function parentToken(parents: Branch[]): Branch {
  if (parents.length === 1) {
    return cloneBranch(parents[0]!);
  }

  /*
   * A multi-branch parent collapses to one sealed `:is(...)` segment; its inner
   * branches keep their own boundary provenance, but as a single top-level segment
   * it is one origin unit (own-local `0` here — the composeOne `+1` lifts it).
   */
  return descendantBranch([isSimple(parents, false)]);
}

/** Compose one child branch under a parent token branch (mirrors serialize). */
function composeOne(parent: Branch, child: Branch): Branch {
  if (branchHasAmp(child)) {
    return substituteAmp(child, parent);
  }

  /*
   * Descendant: parent then space then child. The parent's segments shift one hop
   * deeper (origin + 1); the child's own segments keep their origin (own-local `0`).
   */
  const outBnd: number[] = [];
  for (let k = 0; k < parent.segments.length; k++) {
    outBnd.push(bndAt(parent, k) + 1);
  }
  for (let k = 0; k < child.segments.length; k++) {
    outBnd.push(bndAt(child, k));
  }
  return withBnd(mkBranch([...parent.segments.map(cloneSeg), ...cloneBranch(child).segments]), outBnd);
}

/**
 * Compose a child selector list under a parent selector list. A child whose `&` keeps a
 * pseudo-element last ({@link keepsPseudoElementLast}) composes under each parent that
 * ends with one on its own, and under one `:is()` of the rest, as the serializer
 * substitutes it (`serialize.ts` `parentUnits`): `:is()` cannot hold a pseudo-element
 * (owner 2026-10-06: an output transformation never makes output more invalid or match
 * fewer elements).
 */
function composeLevel(childBranches: Branch[], parentBranches: Branch[]): Branch[] {
  const token = parentToken(parentBranches);
  let units: Branch[] | undefined;
  const out: Branch[] = [];
  for (const raw of childBranches) {
    const c = withNamesJoined(raw);

    /* A name a `&` builds is built on each parent, as the serializer distributes it ({@link buildsName}). */
    if (parentBranches.length > 1 && buildsName(c)) {
      for (const p of parentBranches) {
        out.push(composeOne(cloneBranch(p), c));
      }
      continue;
    }
    if (parentBranches.length > 1 && keepsPseudoElementLast(c)) {
      units ??= parentUnits(parentBranches, token);
      for (const unit of units) {
        out.push(composeOne(unit, c));
      }
      continue;
    }
    out.push(composeOne(token, c));
  }
  return out;
}

/** Whether a text simple opens with an identifier code point, so glued after a `&` it continues the name the `&` builds. */
function continuesName(s: Simple | undefined): boolean {
  if (s === undefined || s.t !== 'text' || s.text.length === 0) {
    return false;
  }
  const c = s.text.charCodeAt(0);
  return c === 0x2D /* - */ || c === 0x5F /* _ */ || c >= 0x80 || (c >= 0x30 && c <= 0x39) || ((c | 32) >= 0x61 && (c | 32) <= 0x7A);
}

/**
 * `b` with a lone `&` and the name continuation glued after it as one token, the way the
 * Less and `.jess` grammars read `&__el` (`.scss` reads it as `&` then `__el`), so the
 * name is built as one simple (`.a__el`) that sibling compaction never splits into
 * `:is(.a, .b)__el`, no selector. `b` itself when it holds none, allocating nothing.
 */
function withNamesJoined(b: Branch): Branch {
  let segments: SelectorPart[] | null = null;
  for (let k = 0; k < b.segments.length; k++) {
    const value = b.segments[k]!.compound.value;
    for (let i = 0; i + 1 < value.length; i++) {
      const s = value[i]!;
      if (s.t === 'text' && s.text === '&' && continuesName(value[i + 1])) {
        segments ??= b.segments.slice();
        const joined = value.slice();
        joined.splice(i, 2, textSimple('&' + simpleText(value[i + 1]!)));
        segments[k] = { combinator: b.segments[k]!.combinator, compound: { value: joined } };
        break;
      }
    }
  }
  if (segments === null) {
    return b;
  }
  const out = mkBranch(segments);
  if (b.bnd) {
    out.bnd = b.bnd;
  }
  if (b.hidden) {
    out.hidden = true;
  }
  if (b.ext) {
    out.ext = true;
  }
  return out;
}

/**
 * Whether a child branch builds a name on its parent: a `&`-led token with text after
 * its `&` (`&__el`, `&-m`; {@link withNamesJoined}). Built on a parent list as one
 * `:is()`, it would be no selector (`:is(.a, .b)__el`), so it is built on each parent,
 * as the serializer distributes it.
 */
function buildsName(b: Branch): boolean {
  for (const seg of b.segments) {
    for (const s of seg.compound.value) {
      if (s.t === 'text' && s.text.length > 1 && s.text.charCodeAt(0) === 0x26 /* & */ && s.text.indexOf('&', 1) === -1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The parent tokens a child keeping a pseudo-element last composes under: each parent
 * that ends with one alone, and one `:is()` of the rest at the place of the first of
 * them — `token` itself when no parent ends with one.
 */
function parentUnits(parents: Branch[], token: Branch): Branch[] {
  if (!parents.some(irEndsWithPseudoElement)) {
    return [token];
  }
  const units: Branch[] = [];
  let rest: Branch[] | null = null;
  let restAt = 0;
  for (const p of parents) {
    if (irEndsWithPseudoElement(p)) {
      units.push(cloneBranch(p));
    } else if (rest === null) {
      rest = [p];
      restAt = units.push(token) - 1;
    } else {
      rest.push(p);
    }
  }
  if (rest !== null) {
    units[restAt] = parentToken(rest);
  }
  return units;
}

/**
 * Whether a child branch's `&` keeps a pseudo-element last: its last compound is a bare
 * `&` followed only by user-action pseudo-classes (`&:hover`), and no earlier compound
 * holds an `&` (`../is-grouping.ts` `keepsPseudoElementLast` for the parsed selector).
 */
function keepsPseudoElementLast(b: Branch): boolean {
  const segments = b.segments;
  const last = segments[segments.length - 1]!.compound.value;
  const lead = last[0];
  if (lead === undefined || lead.t !== 'text' || lead.text !== '&') {
    return false;
  }
  for (let i = 1; i < last.length; i++) {
    const s = last[i]!;
    if (s.t !== 'text' || !isUserActionPseudoClass(s.text)) {
      return false;
    }
  }
  for (let k = 0; k < segments.length - 1; k++) {
    if (compoundHasAmp(segments[k]!.compound.value)) {
      return false;
    }
  }
  return true;
}

/** Strip every `&` from a ROOT-context branch, returning `null` when nothing but
 * `&` (and combinators) is left. A segment emptied by the strip is dropped along
 * with its combinator, so `& .x` yields `.x` — the structural equivalent of the
 * serializer's `value.split('&').join('').trim()`. The first surviving segment
 * takes a descendant combinator so a leading `>`/`+`/`~` never trails a parent
 * that no longer exists. Always returns a FRESH branch: path levels are shared by
 * reference across every descendant subject, so this must not mutate.
 *
 * A root branch with no `&` at all — every root level in a document that never
 * writes one — takes the plain clone this replaced, so its cost and its `bnd`
 * origin are unchanged. `hidden`/`ext` are provenance, not text, and survive the
 * strip; `bnd` cannot, since the strip drops segments it was aligned with (an
 * absent `bnd` reads as all-own-local, which is what a root level is). */
function stripRootAmp(b: Branch): Branch | null {
  if (!branchHasAmp(b)) {
    return cloneBranch(b);
  }
  const segments: SelectorPart[] = [];
  for (const seg of b.segments) {
    const value: Simple[] = [];
    for (const s of seg.compound.value) {
      if (s.t !== 'text') {
        value.push(cloneSimple(s));
        continue;
      }
      const text = textHoldsParentRef(s.text) ? s.text.split('&').join('') : s.text;
      if (text.length > 0) {
        value.push(text === s.text ? cloneSimple(s) : textSimple(text));
      }
    }
    if (value.length > 0) {
      segments.push({ combinator: segments.length === 0 ? ' ' : seg.combinator, compound: { value } });
    }
  }
  if (segments.length === 0) {
    return null;
  }
  const out = mkBranch(segments);
  if (b.hidden) {
    out.hidden = true;
  }
  if (b.ext) {
    out.ext = true;
  }
  return out;
}

/**
 * [nesting] Normalize the ROOT level of a path — the IR mirror of the serializer's
 * `rootStrings`. At a root context a parentless `&` resolves to EMPTY, so a branch
 * that is nothing but `&` is not a selector: it contributes no header branch and no
 * descendant prefix to the rules nested inside it. Dropping it here is what stops a
 * root `& when (…) { … }` guard block from projecting a literal `&` into its
 * children's flat branches.
 */
function rootLevel(level: Level): Branch[] {
  const out: Branch[] = [];
  for (const b of level) {
    const stripped = stripRootAmp(b);
    if (stripped !== null) {
      out.push(stripped);
    }
  }
  return out;
}

/**
 * Compose an ancestor path (outermost → own local) into a flat selector list,
 * wrapping a multi-branch inner level in `:is(...)` before composing (so the
 * parent is not distributed across the group). Every returned branch carries its
 * per-segment `bnd` origin. `hidden` stamps each intermediate selector-list branch
 * while it is still structurally available, so a later `:is()` parent token retains
 * per-arm reference visibility without changing authored structured pseudos.
 */
export function composePath(levels: Level[], hidden = false): Branch[] {
  /*
   * [nesting] Peel the leading levels that root-normalize to nothing (a parentless
   * `&` guard block wrapping the real rules). The first level that survives IS the
   * root context; the levels above it were never a `&`-boundary hop, so the peeled
   * branches carry no `bnd` origin for them either.
   */
  let result: Branch[] = [];
  let i = 0;
  for (; i < levels.length; i++) {
    result = rootLevel(levels[i]!);
    if (result.length > 0) {
      if (hidden) {
        for (let branch = 0; branch < result.length; branch++) {
          result[branch]!.hidden = true;
        }
      }
      i++;
      break;
    }
  }
  if (result.length === 0) {
    /*
     * Every level was a bare root `&` (the guard block itself is the subject).
     * Keep the authored innermost level rather than resolving to nothing.
     */
    result = levels[levels.length - 1]!.map(cloneBranch);
    if (hidden) {
      for (let branch = 0; branch < result.length; branch++) {
        result[branch]!.hidden = true;
      }
    }
    return result;
  }

  /*
   * The root level's own segments are own-local at this stage (`bnd = 0`); each
   * `composeLevel` step lifts the accumulated parent one hop deeper.
   */
  for (; i < levels.length; i++) {
    result = composeLevel(levels[i]!, result);
    if (hidden) {
      for (let branch = 0; branch < result.length; branch++) {
        result[branch]!.hidden = true;
      }
    }
  }
  return result;
}
