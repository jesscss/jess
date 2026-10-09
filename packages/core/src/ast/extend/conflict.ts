/**
 * Element/ID conflict guard for partial `:is()`-wrap substitution.
 *
 * A partial extend wraps a matched compound in place as `B:is(matched, extender…)A`,
 * where `B` and `A` are the compound's SURROUNDING simple tokens before and after the
 * `:is`. Each extender is written with `B` joining its first compound and `A` its last
 * (the Less 4.x placement, ledger X3), so extender `e` yields the compounds
 * `B · first(e)` and `last(e) · A`. Such a compound is INVALID CSS when it holds
 * two distinct element TYPE selectors (`a` + `div` → `adiv…`) or two distinct IDs
 * (`#a` + `#b`). less.js / tree-v1 REJECT such an extend and leave the branch as
 * authored; this module reproduces that decision for the AST-v2 matcher.
 *
 * Ported from tree-v1 `partialWrapMayConflict`
 * (`packages/core/src/tree/extend/extend-index.ts:817`) and its `collectTagsAndIds`
 * (`:785`). Two deliberate refinements make the AST-v2 port PRECISE rather than
 * conservative — tree-v1 could afford to over-reject because a hit routed to a
 * SEPARATE fallback engine (`UNSUPPORTED`), whereas AST-v2 builds the output
 * directly, so an over-reject would emit a WRONG (unchanged) selector:
 *
 *   1. Scope is the MATCHED COMPOUND'S surrounding simple tokens, not the whole subject
 *      selector. Type/id atoms sitting in a different compound (a different combinator
 *      context, e.g. `a > .x` extended at `.x`) never share a compound with the wrap
 *      and so never conflict.
 *   2. Each side meets only the extender compound it joins: `B` its first compound,
 *      `A` its last. `div.c` + `.p span:extend(.c all)` is `div.p span`, valid, while
 *      `span.p .q` would put `div` and `span` in one compound.
 *
 * Both refinements only ever REMOVE spurious rejections relative to tree-v1; every
 * genuinely-invalid-CSS case tree-v1 rejects is still rejected here.
 */

import type { Simple } from './ir.js';

const enum Kind {
  /** A type/element selector (`div`, `a`) — at most one per compound. */
  Type,

  /** An id selector (`#foo`) — at most one distinct id per compound. */
  Id,

  /** Class / attribute / pseudo / `&` / `*` / interpolated-empty — never a conflict source. */
  Other
}

/**
 * Classify one plain-text simple by its leading character. Mirrors tree-v1's
 * `BasicSelector.isTag` / `isId`: `#` ⇒ id, `.`/`[`/`:`/`&`/`*`/empty ⇒ non-conflicting,
 * everything else (a bare ident head) ⇒ an element type selector.
 */
function classify(text: string, at = 0): Kind {
  if (text.length <= at) {
    return Kind.Other;
  }
  switch (text.charCodeAt(at)) {
    case 0x23 /* # */:
      return Kind.Id;
    case 0x2e /* . */:
    case 0x5b /* [ */:
    case 0x3a /* : */:
    case 0x26 /* & */:
    case 0x2a /* * */:
      return Kind.Other;
    default:
      return Kind.Type;
  }
}

/** True when a simple's text is an element type selector, the one a compound may hold. */
export function isTypeSelector(text: string): boolean {
  return classify(text) === Kind.Type;
}

/**
 * True when merging the simples on one side of the wrap into the ONE extender compound
 * they join would place >1 distinct element type OR >1 distinct id into a single
 * compound — the invalid-CSS shape extend must reject.
 *
 * `surrounding` are the matched compound's text simple tokens left OUTSIDE the `:is()`
 * on one side (the wrapped/matched atoms excluded). `extenderTerminal` are the text
 * simple tokens of the extender compound that side joins. Pure, no serialization, and it
 * allocates nothing: a valid compound holds one type and one id at most, so the first of
 * each is all a second distinct one is compared against.
 */
export function wouldConflict(surrounding: readonly string[], extenderTerminal: readonly string[]): boolean {
  let type: string | undefined;
  let id: string | undefined;
  for (const t of extenderTerminal) {
    const kind = classify(t);
    if (kind === Kind.Type) {
      // CSS element type selectors are ASCII case-insensitive; ids are not.
      const value = t.toLowerCase();
      if (type !== undefined && type !== value) {
        return true;
      }
      type = value;
    } else if (kind === Kind.Id) {
      if (id !== undefined && id !== t) {
        return true;
      }
      id = t;
    }
  }

  /*
   * tree-v1 precondition: an extender with no type/id can never introduce a conflict
   * (a valid authored `surrounding` already holds ≤1 type and ≤1 id on its own).
   */
  if (type === undefined && id === undefined) {
    return false;
  }
  for (const s of surrounding) {
    const kind = classify(s);
    if (kind === Kind.Type) {
      const value = s.toLowerCase();
      if (type !== undefined && type !== value) {
        return true;
      }
      type = value;
    } else if (kind === Kind.Id) {
      if (id !== undefined && id !== s) {
        return true;
      }
      id = s;
    }
  }
  return false;
}

/**
 * True when the selector text from `at` opens with a type or universal selector, the
 * simple that must lead its compound.
 */
export function leadsWithElement(text: string, at: number): boolean {
  return text.charCodeAt(at) === 0x2A /* * */ || classify(text, at) === Kind.Type;
}

/** True for a text token that must lead its compound: a type or universal selector. */
function leadsCompound(text: string): boolean {
  return leadsWithElement(text, 0);
}

export const NO_SIMPLES: readonly Simple[] = [];

/**
 * `before`, `member` and `after` as one valid compound: the type (or universal)
 * selector leads, and a repeated type or a universal beside a type is dropped
 * (`div` + `div.b` → `div.b`, never 4.x's `divdiv.b`). Null when two different
 * element types meet.
 */
export function mergeCompound(before: readonly Simple[], member: readonly Simple[], after: readonly Simple[]): Simple[] | null {
  const merged = [...before, ...member, ...after];
  let lead: Extract<Simple, { t: 'text' }> | null = null;
  for (const s of merged) {
    if (s.t !== 'text' || !leadsCompound(s.text)) {
      continue;
    }
    if (lead === null || lead.text === '*') {
      lead = s;
    } else if (s.text !== '*' && s.text.toLowerCase() !== lead.text.toLowerCase()) {
      return null;
    }
  }
  if (lead === null) {
    return merged;
  }
  const out: Simple[] = [lead];
  for (const s of merged) {
    if (s.t !== 'text' || !leadsCompound(s.text)) {
      out.push(s);
    }
  }
  return out;
}
