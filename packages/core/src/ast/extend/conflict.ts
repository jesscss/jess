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
function classify(text: string): Kind {
  if (text.length === 0) {
    return Kind.Other;
  }
  switch (text.charCodeAt(0)) {
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

/** Add a simple's type value (case-folded) or id value (verbatim) into the sets. */
function collect(text: string, types: Set<string>, ids: Set<string>): void {
  switch (classify(text)) {
    case Kind.Type:
      // CSS element type selectors are ASCII case-insensitive; ids are not.
      types.add(text.toLowerCase());
      break;
    case Kind.Id:
      ids.add(text);
      break;
    default:
      break;
  }
}

/**
 * True when merging the simples on one side of the wrap into the ONE extender compound
 * they join would place >1 distinct element type OR >1 distinct id into a single
 * compound — the invalid-CSS shape extend must reject.
 *
 * `surrounding` are the matched compound's text simple tokens left OUTSIDE the `:is()`
 * on one side (the wrapped/matched atoms excluded). `extenderTerminal` are the text
 * simple tokens of the extender compound that side joins. Pure and allocation-light: two
 * tiny Sets over O(surrounding + extender) atoms, no serialization.
 */
export function wouldConflict(surrounding: readonly string[], extenderTerminal: readonly string[]): boolean {
  /*
   * tree-v1 precondition: an extender with no type/id can never introduce a conflict
   * (a valid authored `surrounding` already holds ≤1 type and ≤1 id on its own).
   */
  const extTypes = new Set<string>();
  const extIds = new Set<string>();
  for (const t of extenderTerminal) {
    collect(t, extTypes, extIds);
  }
  if (extTypes.size === 0 && extIds.size === 0) {
    return false;
  }
  const types = new Set(extTypes);
  const ids = new Set(extIds);
  for (const s of surrounding) {
    collect(s, types, ids);
  }
  return types.size > 1 || ids.size > 1;
}
