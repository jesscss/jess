/**
 * Extend family: `:extend(target)`, `&:extend(target)`, the
 * per-target `all` (partial) flag, and multi-target `:extend(.a, .b)` — built as
 * `ExtendInstruction`s attached to the ENCLOSING selector's `Rule`.
 *
 * The functional grammar models extend as part of the selector: a `ComplexSelector`
 * may end in an `ExtendPseudo` (`:extend(...)`), and a body statement may be an
 * `ExtendStatement` (`&:extend(...);`). This family BUILDS the instruction from the
 * grammar's structured children — the extend COMPUTATION (`:is()` compaction) is the
 * serialize-time engine (`ast/extend.ts`), downstream of here.
 *
 * Flow:
 *   `ExtendTarget`  → an `ExtendTargetMarker` { find-complex, partial(`all`) }.
 *                     The find-complex is F3's built `ComplexSelector` (reused, not
 *                     re-tokenized), so the target serializes byte-identically.
 *   `ExtendPseudo`  → an `ExtendMarker` carrying one `ExtendInstruction` per target
 *                     (multi-target fans out; each `target` is a `SelectorList` of
 *                     the one find-complex, exactly like the bridge).
 *   `ExtendStatement` (`&:extend(...);`) → the inner `ExtendMarker`, re-surfaced as
 *                     a body statement the Ruleset family drains onto its Rule.
 *
 * The selector / ruleset families HOIST the marker off the selector / body onto the
 * `Rule.extendInstructions` (see `host-context` `attachSelectorExtends` /
 * `isExtendMarker`) — so `:extend()` never emits as a selector token or body node.
 *
 * TOTAL: parseman builds these on backtracked branches too, so no action throws —
 * a missing/foreign child degrades to an inert (empty) marker, discarded with the
 * doomed branch.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type ExtendMarker,
  extendMarker,
  extendTargetMarker,
  isExtendMarker,
  isExtendTargetMarker,
  rawSpan,
} from '../host-context.js';

/** The parser's per-target flag: `all` / `!all` (both collapse to partial). */
function isAllFlag(s: string): boolean {
  return s === 'all' || s === '!all';
}

/** Coerce F3's built find selector to a `Complex` (it is a `ComplexSelector` →
 *  `Complex`; degrade a bare compound/simple/foreign child so the action stays
 *  total on a doomed branch). */
function toFindComplex(built: unknown, text: string): t2.Complex {
  if (t2.isNode(built)) {
    if (built.type === 'Complex') return built;
    if (built.type === 'Compound') return t2.complex([{ compound: built }]);
    if (built.type === 'Simple') return t2.complex([{ compound: t2.compoundOf([built]) }]);
  }
  return t2.complex([{ compound: t2.compoundOf([t2.simple(text)]) }]);
}

/**
 * `ExtendTarget` = `extendComplex optional(flag)` — one comma-separated find
 * branch. The complex is the first built child; the `all` flag is a trailing raw
 * leaf (`all` / `!all`).
 */
function buildExtendTarget(args: BuildArgs) {
  const src = args.ctx.src;
  const firstSpan = rawSpan(args.rawChildren[0]);
  const text = firstSpan ? src.slice(firstSpan.start, firstSpan.end) : '';
  const complex = toFindComplex(args.children[0], text);
  let partial = false;
  for (let i = 1; i < args.rawChildren.length; i++) {
    const span = rawSpan(args.rawChildren[i]);
    if (span && isAllFlag(src.slice(span.start, span.end))) {
      partial = true;
      break;
    }
  }
  return extendTargetMarker(complex, partial);
}

/** Collect the `ExtendTargetMarker` children of an extend body into instructions
 *  (one per target branch; each `target` a single-complex `SelectorList`, matching
 *  the bridge's `extractExtends`). */
function instructionsFrom(children: ReadonlyArray<unknown>): t2.ExtendInstruction[] {
  const out: t2.ExtendInstruction[] = [];
  for (const c of children) {
    if (isExtendTargetMarker(c)) {
      const { complex, partial } = c.__t2extendTarget;
      out.push({ target: t2.selist(complex), partial });
    }
  }
  return out;
}

/** `ExtendPseudo` = `:extend( targetList )` → the marker carrying its instructions. */
function buildExtendPseudo(args: BuildArgs): ExtendMarker {
  return extendMarker(instructionsFrom(args.children));
}

/** `ExtendStatement` = `& ExtendPseudo ;` → surface the inner marker as a body
 *  statement (subject = the enclosing rule's selector, drained by the Ruleset). */
function buildExtendStatement(args: BuildArgs): ExtendMarker {
  for (const c of args.children) if (isExtendMarker(c)) return c;
  return extendMarker([]);
}

export const EXTEND_ACTIONS: readonly BuildAction[] = [
  { type: 'ExtendTarget', build: buildExtendTarget },
  { type: 'ExtendPseudo', build: buildExtendPseudo },
  { type: 'ExtendStatement', build: buildExtendStatement },
];
