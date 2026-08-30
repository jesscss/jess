/**
 * Element/ID conflict guard for partial `:is()`-wrap substitution.
 *
 * A partial extend wraps a matched compound in place as `S:is(matched, extender…)`,
 * where `S` is the compound's SURROUNDING simple tokens (the ones left outside the `:is`).
 * On serialization each `:is()` branch distributes back over `S`, so extender `e`
 * yields the compound `S · terminal(e)`. That compound is INVALID CSS when it holds
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
 *   2. The extender contributes only its TERMINAL compound (the compound that merges
 *      into the wrap slot); an ancestor part of a complex extender (`a > .foo`) lands
 *      in its own compound and cannot conflict.
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
 * True when wrapping the matched compound and merging ONE extender's terminal
 * compound would place >1 distinct element type OR >1 distinct id into a single
 * compound — the invalid-CSS shape extend must reject.
 *
 * `surrounding` are the matched compound's text simple tokens left OUTSIDE the `:is()`
 * (the wrapped/matched atoms excluded). `extenderTerminal` are the text simple tokens of
 * the extender branch's terminal compound. Pure and allocation-light: two tiny Sets
 * over O(surrounding + extender) atoms, no serialization.
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
