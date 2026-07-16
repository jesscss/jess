/**
 * [tree2-native] Selector family (F3): compound / complex / list selectors with
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
 * attribute (`[x="y"]`), `&` / `&-suffix`, and interpolation (`@{x}`) tokens ride
 * as `Simple` bytes — byte-identical to the bridge's per-token serialization for
 * these shapes (structured attribute/interp eval is a later family's concern).
 */
import * as t2 from '../../tree2/index.js';
import type { Combinator } from '../../tree2/index.js';
import { type BuildAction, type BuildArgs } from '../host-context.js';
// [F4] interp-aware simple-token builder: a `@{…}`-bearing part becomes an
// interpolation `Simple` (resolved at ruleset-enter); any other part stays the
// verbatim-bytes `t2.simple` this used before. See `selector-interp.ts`.
import { simpleFromText } from './selector-interp.js';

const COMBINATORS = new Set<string>(['>', '+', '~']);

interface Span {
  start: number;
  end: number;
}

/** The source span of a raw parseman child leaf/node, if it carries one. */
function rawSpan(rc: unknown): Span | undefined {
  const span = (rc as { span?: Span } | undefined)?.span;
  return span && typeof span.start === 'number' && typeof span.end === 'number' ? span : undefined;
}

/** A `Complex` for one selector-list / complex segment: reuse a built selector
 *  node, else wrap the verbatim token text in a single-compound Complex. */
function segmentToComplex(built: unknown, text: string): t2.Complex {
  if (built instanceof t2.Complex) return built;
  if (built instanceof t2.Compound) return t2.complex([{ compound: built }]);
  if (built instanceof t2.Simple) return t2.complex([{ compound: new t2.Compound([built]) }]);
  return t2.complex([{ compound: new t2.Compound([t2.simple(text)]) }]);
}

/** A `Compound` for one complex segment: reuse a built compound, else the token. */
function segmentToCompound(built: unknown, text: string): { compound: t2.Compound; complex?: t2.Complex } {
  if (built instanceof t2.Compound) return { compound: built };
  if (built instanceof t2.Complex) return { compound: built.head, complex: built };
  if (built instanceof t2.Simple) return { compound: new t2.Compound([built]) };
  return { compound: new t2.Compound([t2.simple(text)]) };
}

/**
 * `CompoundSelector`: consecutive parts with NO span gap concatenate into one
 * `Compound` (`.a:hover`); a span gap is a DESCENDANT combinator that splits into
 * a `Complex` (`.a .b`, `.a.b .c`). Parts are sliced verbatim from their spans.
 */
function buildCompound(args: BuildArgs): t2.Compound | t2.Complex {
  const src = args.ctx.src;
  const groups: t2.Simple[][] = [[]];
  let prevEnd = -1;
  for (const rc of args.rawChildren) {
    const span = rawSpan(rc);
    if (!span) continue;
    if (prevEnd >= 0 && span.start > prevEnd) groups.push([]); // gap → descendant
    groups[groups.length - 1]!.push(simpleFromText(src.slice(span.start, span.end)));
    prevEnd = span.end;
  }
  const compounds = groups.filter((g) => g.length > 0).map((g) => new t2.Compound(g));
  if (compounds.length <= 1) return compounds[0] ?? new t2.Compound([]);
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
  let leadingComb: Combinator | undefined;
  let pending: Combinator = ' ';
  let sawSegment = false;
  for (let i = 0; i < args.rawChildren.length; i++) {
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
  if (segments.length === 0) return t2.complex([{ compound: new t2.Compound([]) }]);
  return t2.complex(segments, leadingComb);
}

/** `SelectorList`: comma-separated complexes → a tree2 `SelectorList`. */
function buildSelectorList(args: BuildArgs): t2.SelectorList | t2.Complex {
  const src = args.ctx.src;
  const complexes: t2.Complex[] = [];
  for (let i = 0; i < args.rawChildren.length; i++) {
    const span = rawSpan(args.rawChildren[i]);
    if (!span) continue;
    const text = src.slice(span.start, span.end);
    if (text === ',') continue;
    complexes.push(segmentToComplex(args.children[i], text));
  }
  return complexes.length === 1 ? complexes[0]! : t2.selist(...complexes);
}

export const SELECTOR_ACTIONS: readonly BuildAction[] = [
  { type: 'CompoundSelector', build: buildCompound },
  { type: 'ComplexSelector', build: buildComplex },
  { type: 'SelectorList', build: buildSelectorList },
];
