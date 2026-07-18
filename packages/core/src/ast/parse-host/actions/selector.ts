/**
 * Selector family: compound / complex / list selectors with
 * combinators and `&`, built as real tree2 `SelectorList` / `Complex` / `Compound`
 * / `Simple` structure (the foundation nesting/extend/`&` families build on).
 *
 * Why structure (not verbatim bytes): the tree2 serializer NORMALIZES combinators
 * (`.a>.b` → `.a > .b`, multi-space descendant → single space) exactly as the
 * bridge does, so a verbatim-bytes selector would diverge on non-normalized input.
 * Building the same structure the bridge builds makes the direct path byte-identical
 * AND gives `&`-resolution / extend-matching a real compound/simple tree.
 *
 * Source of truth: the grammar's `rawChildren`, which are index-aligned leaves
 * carrying spans. That structure is bracket/paren-aware (top-level `,` and
 * combinators only), so it avoids re-tokenizing selector bytes. A DESCENDANT
 * combinator inside a `CompoundSelector` (`.a .b` → one CompoundSelector rule with
 * two space-separated parts) is recovered from the SPAN GAP between consecutive
 * parts — the same signal the legacy builder reads from the whitespace trivia log.
 *
 * Leaf text is sliced VERBATIM from each part's span, so pseudo (`:hover`),
 * attribute (`[x="y"]`), and `&` / `&-suffix` tokens ride as `Simple` bytes —
 * byte-identical to the bridge's per-token serialization (structured attribute
 * eval is a later family's concern). An interpolation part (`.@{x}`) is instead a
 * grammar-built `Compound` child whose interp `Simple`s are spliced in directly.
 */
import * as t2 from '../../index.js';
import type { Combinator } from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type CommentRange,
  attachSelectorExtends,
  blockCommentTrivia,
  hasCommentTrivia,
  hasWhitespaceTriviaBefore,
  isExtendMarker,
  rawSpan,
  takeSelectorExtends,
} from '../host-context.js';

const COMBINATORS = new Set<string>(['>', '+', '~', '|', '||']);

/** A `Complex` for one selector-list / complex segment: reuse a built selector
 *  node, else wrap the verbatim token text in a single-compound Complex. */
function segmentToComplex(built: unknown, text: string): t2.Complex {
  if (t2.isNode(built)) {
    if (built.type === 'Complex') return built;
    if (built.type === 'Compound') return t2.complex([{ compound: built }]);
    if (built.type === 'Simple') return t2.complex([{ compound: t2.compoundOf([built]) }]);
  }
  return t2.complex([{ compound: t2.compoundOf([t2.simple(text)]) }]);
}

/** A `Compound` for one complex segment: reuse a built compound, else the token. */
function segmentToCompound(built: unknown, text: string): { compound: t2.Compound; complex?: t2.Complex } {
  if (t2.isNode(built)) {
    if (built.type === 'Compound') return { compound: built };
    if (built.type === 'Complex') return { compound: built.head, complex: built };
    if (built.type === 'Simple') return { compound: t2.compoundOf([built]) };
  }
  return { compound: t2.compoundOf([t2.simple(text)]) };
}

/**
 * `CompoundSelector`: consecutive parts concatenate into one `Compound`
 * (`.a:hover`, `.a/* *​/.b`); WHITESPACE trivia between two parts is a DESCENDANT
 * combinator that splits into a `Complex` (`.a .b`, `.a.b .c`). The split signal
 * is the parser's whitespace trivia — NOT a raw byte gap: a comment between
 * simples (`.a/* *​/.b`) opens a byte gap with no whitespace and must stay one
 * compound. A part the grammar already built into a `Compound` (an
 * `InterpolatedSelector` — `.a.@{n}`, `&.@{mod}`) contributes its interp `Simple`s
 * directly (P0: consume the built child, don't re-slice `@{…}`); every other part
 * is a verbatim-bytes `Simple` sliced from its own leaf span.
 */
function buildCompound(args: BuildArgs): t2.Compound | t2.Complex {
  const src = args.ctx.src;
  const groups: t2.Simple[][] = [[]];
  for (let i = 0; i < args.rawChildren.length; i++) {
    const span = rawSpan(args.rawChildren[i]);
    if (!span) continue;
    const cur = groups[groups.length - 1]!;
    if (cur.length > 0 && hasWhitespaceTriviaBefore(args.triviaLog, i)) groups.push([]); // ws → descendant
    const built = args.children[i];
    const group = groups[groups.length - 1]!;
    if (t2.isNode(built) && built.type === 'Compound') group.push(...built.simples);
    else group.push(t2.simple(src.slice(span.start, span.end)));
  }
  const compounds = groups.filter((g) => g.length > 0).map((g) => t2.compoundOf(g));
  if (compounds.length <= 1) return compounds[0] ?? t2.compoundOf([]);
  const [head, ...tail] = compounds;
  return t2.complex([{ compound: head! }, ...tail.map((c) => ({ comb: ' ' as Combinator, compound: c }))]);
}

/**
 * `ComplexSelector`: compound segments separated by explicit `>` / `+` / `~`
 * combinators (descendant compounds arrive already grouped from `CompoundSelector`).
 * A combinator before the first compound is a leading combinator (`> .b`).
 */
function buildComplex(args: BuildArgs): t2.Complex {
  const src = args.ctx.src;
  const segments: Array<{ comb?: Combinator; compound: t2.Compound }> = [];
  const extendInstructions: t2.ExtendInstruction[] = [];
  let leadingComb: Combinator | undefined;
  let pending: Combinator = ' ';
  let sawSegment = false;
  for (let i = 0; i < args.rawChildren.length; i++) {
    // [extend F11] A trailing `:extend(...)` pseudo rides here as an ExtendMarker —
    // it is NOT a selector token: hoist its instructions onto the built Complex so
    // the enclosing Rule fires them, and never emit it as a compound.
    const child = args.children[i];
    if (isExtendMarker(child)) {
      extendInstructions.push(...child.__t2extend);
      continue;
    }
    const span = rawSpan(args.rawChildren[i]);
    if (!span) continue;
    const text = src.slice(span.start, span.end);
    if (COMBINATORS.has(text)) {
      pending = text as Combinator;
      if (!sawSegment) leadingComb = text as Combinator;
      continue;
    }
    const { compound, complex } = segmentToCompound(args.children[i], text);
    if (!sawSegment) {
      segments.push({ compound });
      sawSegment = true;
    } else {
      segments.push({ comb: pending, compound });
    }
    // A segment that itself decomposed to a descendant Complex contributes its
    // remaining (descendant) tail after the head just pushed.
    if (complex) for (const seg of complex.tail) segments.push({ comb: seg.comb, compound: seg.compound });
    pending = ' ';
  }
  const out =
    segments.length === 0
      ? t2.complex([{ compound: t2.compoundOf([]) }])
      : t2.complex(segments, leadingComb);
  attachSelectorExtends(args.ctx, out, extendInstructions);
  return out;
}

/** Whether any block comment falls inside the byte range `[start, end)`. */
function commentInRange(comments: readonly CommentRange[], start: number, end: number): boolean {
  for (const c of comments) if (c.start >= start && c.end <= end) return true;
  return false;
}

/**
 * A verbatim `Complex` wrapping the selector segment's raw bytes as a single
 * `Simple` — the byte-faithful path for a comma segment that CARRIES A COMMENT
 * (`#a /* c *​/`, `/* c *​/ .b`). Less keeps selector comments in the element stream;
 * the structured build drops them (comments are parser trivia, never a selector
 * token), so a comment-bearing segment prints its source range verbatim instead.
 */
function verbatimComplex(text: string): t2.Complex {
  return t2.complex([{ compound: t2.compoundOf([t2.simple(text)]) }]);
}

/** `SelectorList`: comma-separated complexes → a tree2 `SelectorList`. */
function buildSelectorList(args: BuildArgs): t2.SelectorList | t2.Complex {
  const src = args.ctx.src;
  // A comment-free list (the overwhelming common case) does zero extra work — no
  // comment array, no byte-range lookahead; only a comment-bearing list pays for the
  // verbatim-segment path that preserves in-selector comments.
  const comments = hasCommentTrivia(args.triviaLog) ? blockCommentTrivia(args.triviaLog) : null;
  const complexes: t2.Complex[] = [];
  // Segment byte range spans from the previous comma end (or list start) to the
  // next comma start (or list end) — a range that INCLUDES the segment's comment
  // trivia (which sits between the complex token and the following comma, so it is
  // never inside the complex's own span).
  let segStart = args.span.start;
  for (let i = 0; i < args.rawChildren.length; i++) {
    const span = rawSpan(args.rawChildren[i]);
    if (!span) continue;
    const text = src.slice(span.start, span.end);
    if (text === ',') {
      segStart = span.end;
      continue;
    }
    if (comments !== null && comments.length > 0) {
      // Look ahead to the next top-level comma to bound this segment's byte range.
      let segEnd = args.span.end;
      for (let j = i + 1; j < args.rawChildren.length; j++) {
        const nspan = rawSpan(args.rawChildren[j]);
        if (nspan && src.slice(nspan.start, nspan.end) === ',') { segEnd = nspan.start; break; }
      }
      if (commentInRange(comments, segStart, segEnd)) {
        complexes.push(verbatimComplex(src.slice(segStart, segEnd).trim()));
        continue;
      }
    }
    complexes.push(segmentToComplex(args.children[i], text));
  }
  if (complexes.length === 1) return complexes[0]!;
  const list = t2.selist(...complexes);
  // [extend F11] Roll each group member's `:extend()` instructions up onto the
  // list node so the enclosing Rule sees the whole group's extends (`.a:extend(.b),
  // .c { … }`). A single-complex return needs no roll-up — the Rule drains it directly.
  for (const c of complexes) {
    const exts = takeSelectorExtends(args.ctx, c);
    if (exts) attachSelectorExtends(args.ctx, list, exts);
  }
  return list;
}

export const SELECTOR_ACTIONS: readonly BuildAction[] = [
  { type: 'CompoundSelector', build: buildCompound },
  { type: 'ComplexSelector', build: buildComplex },
  { type: 'SelectorList', build: buildSelectorList },
];
