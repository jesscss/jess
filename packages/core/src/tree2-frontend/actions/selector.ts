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
 * attribute (`[x="y"]`), and `&` / `&-suffix` tokens ride as `Simple` bytes —
 * byte-identical to the bridge's per-token serialization (structured attribute
 * eval is a later family's concern). An interpolation part (`.@{x}`) is instead a
 * grammar-built `Compound` child whose interp `Simple`s are spliced in directly.
 */
import * as t2 from '../../tree2/index.js';
import type { Combinator } from '../../tree2/index.js';
import {
  type BuildAction,
  type BuildArgs,
  attachSelectorExtends,
  isExtendMarker,
  takeSelectorExtends,
} from '../host-context.js';

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
 * a `Complex` (`.a .b`, `.a.b .c`). A part the grammar already built into a
 * `Compound` (an `InterpolatedSelector` — `.a.@{n}`, `&.@{mod}`) contributes its
 * interp `Simple`s directly (P0: consume the built child, don't re-slice `@{…}`);
 * every other part is a verbatim-bytes `Simple` sliced from its own leaf span.
 */
function buildCompound(args: BuildArgs): t2.Compound | t2.Complex {
  const src = args.ctx.src;
  const groups: t2.Simple[][] = [[]];
  let prevEnd = -1;
  for (let i = 0; i < args.rawChildren.length; i++) {
    const span = rawSpan(args.rawChildren[i]);
    if (!span) continue;
    if (prevEnd >= 0 && span.start > prevEnd) groups.push([]); // gap → descendant
    const built = args.children[i];
    const group = groups[groups.length - 1]!;
    if (built instanceof t2.Compound) group.push(...built.simples);
    else group.push(t2.simple(src.slice(span.start, span.end)));
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
      ? t2.complex([{ compound: new t2.Compound([]) }])
      : t2.complex(segments, leadingComb);
  attachSelectorExtends(out, extendInstructions);
  return out;
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
  if (complexes.length === 1) return complexes[0]!;
  const list = t2.selist(...complexes);
  // [extend F11] Roll each group member's `:extend()` instructions up onto the
  // list node so the enclosing Rule sees the whole group's extends (`.a:extend(.b),
  // .c { … }`). A single-complex return needs no roll-up — the Rule drains it directly.
  for (const c of complexes) {
    const exts = takeSelectorExtends(c);
    if (exts) attachSelectorExtends(list, exts);
  }
  return list;
}

export const SELECTOR_ACTIONS: readonly BuildAction[] = [
  { type: 'CompoundSelector', build: buildCompound },
  { type: 'ComplexSelector', build: buildComplex },
  { type: 'SelectorList', build: buildSelectorList },
];
