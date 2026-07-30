import type { Trivia, TriviaMap } from '../types/index.js';

/**
 * Parser-authored source spans for canonical AST nodes.
 *
 * AST v2 nodes remain plain semantic data, so source locations live in a side
 * table instead of changing every hot node shape. Parseman reductions provide
 * the exact span; evaluation reads it only when constructing a diagnostic.
 */
export type AstSourceSpan = Readonly<{ start: number; end: number }>;

/**
 * Inline provenance slots.
 *
 * A parser-authored span lives in two plain integer fields ON the node, the way
 * every production compiler carries it (TypeScript's `pos`/`end`, rustc's
 * `Span`, swc's `span`, esbuild's `Loc`). The prior design kept four
 * identity-keyed `WeakMap`s, which cost one `{ start, end }` object plus one
 * ephemeron entry per span; reads outnumber writes ~2.6:1 and the dominant
 * consumer is the renderer, so a hash probe sat on the hot path.
 *
 * `NO_SPAN` (-1) is the absent sentinel: it cannot collide with a real offset.
 * Every factory for a span-bearing node type initializes both slots
 * unconditionally, so a later `withSourceSpan` stores into an existing Smi field
 * and never transitions the hidden class.
 *
 * Prefer {@link sourceStartOf} / {@link sourceEndOf} on hot paths: they read the
 * integer directly. {@link sourceSpanOf} keeps the historical object-returning
 * signature for cold diagnostic callers and MATERIALIZES a `{ start, end }`
 * object per call, so it must not be used per-node in the renderer.
 */
export const NO_SPAN = -1;

/** The two inline source-span slots carried by every span-bearing node. */
export interface SpanSlots {
  _s: number;
  _e: number;
}

/** The inline per-document trivia slot carried by a stylesheet root.
 *
 * Trivia is keyed by the ROOT only — one entry per document — so the former
 * `WeakMap` bought nothing but an ephemeron the collector had to track. The
 * field is initialized to `undefined` by the factory so a later
 * {@link withTriviaMap} stores into an existing Tagged slot without a
 * hidden-class transition. */
export interface TriviaSlot {
  _trivia?: TriviaMap;
}

/** The two inline body-span slots carried by every block-bearing node. */
export interface BodySpanSlots {
  _bs: number;
  _be: number;
}

/*
 * Factories write `_s: NO_SPAN, _e: NO_SPAN` as LITERAL fields in their object
 * literal — never by spreading a helper's return, which would reintroduce the
 * per-node allocation this change exists to remove.
 */
export type AstTriviaRange = AstSourceSpan;
export interface ParserTriviaEntriesView {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
  kind?(index: number): string | undefined;
}
export interface ParserRootTriviaGap {
  readonly start: number;
  readonly end: number;
  hasKind?(kind: string): boolean;
}
export interface ParserRootTriviaIndex {
  readonly labels?: readonly string[];

  /**
   * `selectedKinds` entries name markers inside an owned trivia range, so their
   * entry spans are not themselves renderable gap ranges.
   */
  readonly rootCaptureMode?: 'allEntries' | 'selectedKinds';
  readonly entries: ParserTriviaEntriesView;
  gapBefore(offset: number): ParserRootTriviaGap | undefined;
  gapAfter(offset: number): ParserRootTriviaGap | undefined;
  gaps(): readonly ParserRootTriviaGap[];
  gapsWithKind?(kind: string | readonly string[]): readonly ParserRootTriviaGap[];
}

const COMMENT_TRIVIA_KINDS = ['comment', 'blockComment', 'lineComment'] as const;
type CommentTriviaKind = typeof COMMENT_TRIVIA_KINDS[number];

function isCommentTriviaKind(label: string): label is CommentTriviaKind {
  return label === 'comment' || label === 'blockComment' || label === 'lineComment';
}

function gapHasCommentKind(gap: ParserRootTriviaGap): boolean {
  if (typeof gap.hasKind !== 'function') {
    return true;
  }
  return COMMENT_TRIVIA_KINDS.some(kind => gap.hasKind?.(kind) === true);
}

type TriviaRange = Readonly<{ start: number; end: number }>;

/**
 * Legacy Parseman root capture stores every labeled trivia chunk. When the
 * renderer only needs comments, derive just their complete contiguous gaps
 * directly from that packed log. Calling `gapsWithKind()` on the legacy index
 * first materializes a map, gap object, and entry-index array for every
 * whitespace run in the document.
 *
 * Selected-root capture deliberately stores marker spans instead; its sparse
 * index owns the complete ranges and is queried through `gapsWithKind()`.
 */
function labeledCommentRangesFromEntries(
  index: ParserRootTriviaIndex,
  hasCommentKind: boolean
): readonly TriviaRange[] | undefined {
  if (!hasCommentKind || index.rootCaptureMode === 'selectedKinds') {
    return undefined;
  }
  const { entries } = index;
  if (typeof entries.kind !== 'function') {
    return undefined;
  }
  if (entries.length === 0) {
    return [];
  }

  const ranges: TriviaRange[] = [];
  let start = entries.start(0);
  let end = entries.end(0);
  let containsComment = isCommentTriviaKind(entries.kind(0) ?? '');
  for (let entry = 1; entry < entries.length; entry++) {
    const nextStart = entries.start(entry);
    const nextEnd = entries.end(entry);
    if (nextStart === end) {
      end = nextEnd;
      containsComment ||= isCommentTriviaKind(entries.kind(entry) ?? '');
      continue;
    }
    if (containsComment) {
      ranges.push({ start, end });
    }
    start = nextStart;
    end = nextEnd;
    containsComment = isCommentTriviaKind(entries.kind(entry) ?? '');
  }
  if (containsComment) {
    ranges.push({ start, end });
  }
  return ranges;
}

/** Authored separator/trivia facts for a raw ValueSlot array.
 *
 * ValueSlot deliberately stays a plain readonly array in the public AST.  A
 * parser may still retain each exact authored boundary run—ordinary spaces or
 * tabs, comments, line breaks, and continuation indentation—in this side
 * table, rather than adding a dialect-specific field to the array or turning
 * the array back into a SpacedValue node.
 */
export type ValueLayout = readonly string[];

/*
 * Value layout is the one side table that MUST stay identity-keyed: its subject
 * is a raw `ValueSlot` ARRAY, and named properties on an array are not a shape a
 * factory can pre-initialize (and would push the array out of its fast elements
 * kind). Measured on `benchmark.less`: 145 layout writes per render, versus
 * 9,813 span writes that are now inline fields. Spans, body spans, and the
 * per-document trivia map all moved onto the nodes themselves.
 *
 * Parser packages consume the public `@jesscss/core/ast` subpath while core
 * evaluation is also loaded through the package root, so build tools may
 * materialize more than one copy of this module. A process-global symbol keeps
 * this one remaining side table shared across those module identities.
 */
const layoutStoreKey = Symbol.for('jess.ast.value-layout-store');
const layoutGlobal = globalThis as typeof globalThis & {
  [layoutStoreKey]?: WeakMap<object, ValueLayout>;
};
const layouts = layoutGlobal[layoutStoreKey] ??= new WeakMap<object, ValueLayout>();

function rangeHasComment(src: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) {
      return true;
    }
  }
  return false;
}

function makeAstTrivia(src: string, start: number, end: number, hasComment = rangeHasComment(src, start, end)): Trivia {
  return { start, end, src, hasComment };
}

/** Build the sparse renderer-facing trivia lookup from parser-owned source ranges. */
export function createTriviaMapFromRanges(
  src: string,
  ranges: Iterable<AstTriviaRange>
): TriviaMap {
  const before = new Map<number, Trivia>();
  const after = new Map<number, Trivia>();
  let sortedComments: readonly Trivia[] | undefined;
  for (const range of ranges) {
    if (range.end <= range.start) {
      continue;
    }
    const run = makeAstTrivia(src, range.start, range.end);
    after.set(range.start, run);
    before.set(range.end, run);
  }
  return {
    lookup(offset, direction) {
      if (offset === undefined) {
        return undefined;
      }
      return direction === 'before'
        ? before.get(offset)
        : after.get(offset);
    },
    entries(direction) {
      return direction === 'before'
        ? before.entries()
        : after.entries();
    },
    has(offset, direction) {
      if (offset === undefined) {
        return false;
      }
      return direction === 'before'
        ? before.has(offset)
        : after.has(offset);
    },
    commentRuns() {
      if (sortedComments === undefined) {
        const runs: Trivia[] = [];
        for (const run of after.values()) {
          if (run.hasComment) {
            runs.push(run);
          }
        }
        runs.sort((a, b) => a.start - b.start);
        sortedComments = runs;
      }
      return sortedComments;
    }
  };
}

/** Adapt Parseman's lazy root trivia index without rebuilding intermediate ranges. */
export function createTriviaMapFromParseman(
  src: string,
  index: ParserRootTriviaIndex
): TriviaMap {
  const canonicalByStart = new Map<number, Map<number, Trivia>>();
  const hasCommentKind = index.labels?.some(isCommentTriviaKind) === true;
  let sortedComments: readonly Trivia[] | undefined;

  const triviaForRange = (
    start: number,
    end: number,
    knownHasComment?: boolean
  ): Trivia | undefined => {
    if (end <= start) {
      return undefined;
    }
    let byEnd = canonicalByStart.get(start);
    if (byEnd === undefined) {
      byEnd = new Map<number, Trivia>();
      canonicalByStart.set(start, byEnd);
    }
    let run = byEnd.get(end);
    if (run === undefined) {
      run = makeAstTrivia(src, start, end, knownHasComment);
      byEnd.set(end, run);
    }
    return run;
  };

  const triviaForGap = (gap: ParserRootTriviaGap | undefined): Trivia | undefined => {
    if (gap === undefined) {
      return undefined;
    }
    const start = gap.start;
    const end = gap.end;
    const labeledHasComment = hasCommentKind && typeof gap.hasKind === 'function'
      ? gapHasCommentKind(gap)
      : undefined;
    return triviaForRange(start, end, labeledHasComment === true ? true : undefined);
  };

  return {
    lookup(offset, direction) {
      if (offset === undefined) {
        return undefined;
      }
      return triviaForGap(direction === 'before'
        ? index.gapBefore(offset)
        : index.gapAfter(offset));
    },
    * entries(direction) {
      for (const gap of index.gaps()) {
        const run = triviaForGap(gap);
        if (run === undefined) {
          continue;
        }
        yield [
          direction === 'before' ? run.end : run.start,
          run
        ];
      }
    },
    has(offset, direction) {
      if (offset === undefined) {
        return false;
      }
      return direction === 'before'
        ? index.gapBefore(offset) !== undefined
        : index.gapAfter(offset) !== undefined;
    },
    commentRuns() {
      if (sortedComments === undefined) {
        const runs: Trivia[] = [];
        const labeledRanges = labeledCommentRangesFromEntries(index, hasCommentKind);
        const labeledGaps = labeledRanges === undefined && hasCommentKind && index.gapsWithKind !== undefined
          ? index.gapsWithKind(COMMENT_TRIVIA_KINDS)
          : undefined;
        if (labeledRanges !== undefined && labeledRanges.length > 0) {
          for (const range of labeledRanges) {
            const run = triviaForRange(range.start, range.end, true);
            if (run !== undefined) {
              runs.push(run);
            }
          }
        } else {
          const candidates = labeledGaps ?? index.gaps();
          for (const gap of candidates) {
            if (labeledGaps === undefined && !rangeHasComment(src, gap.start, gap.end)) {
              continue;
            }
            const run = triviaForGap(gap);
            if (run?.hasComment === true) {
              runs.push(run);
            }
          }
        }
        runs.sort((a, b) => a.start - b.start);
        sortedComments = runs;
      }
      return sortedComments;
    }
  };
}

/** @deprecated Use `createTriviaMapFromParseman`. */
export const createTriviaMapFromRootIndex = createTriviaMapFromParseman;

/**
 * Retain the exact Parseman reduction span for an AST factory result.
 *
 * The node's factory already initialized `_s`/`_e` to {@link NO_SPAN}, so this is
 * a same-map Smi store. A node built outside a factory (a hand-written literal
 * in a test) transitions once here and is not on any hot path.
 */
export function withSourceSpan<T extends object>(node: T, span: AstSourceSpan): T {
  const slots = node as Partial<SpanSlots>;
  slots._s = span.start;
  slots._e = span.end;
  return node;
}

/** The parser-authored start offset, or {@link NO_SPAN}. The hot-path reader. */
export function sourceStartOf(node: object): number {
  return (node as Partial<SpanSlots>)._s ?? NO_SPAN;
}

/** The parser-authored end offset, or {@link NO_SPAN}. The hot-path reader. */
export function sourceEndOf(node: object): number {
  return (node as Partial<SpanSlots>)._e ?? NO_SPAN;
}

/**
 * Read a parser-authored span, if the AST node originated in source.
 *
 * MATERIALIZES an object per call. Cold diagnostic callers only — hot readers
 * use {@link sourceStartOf} / {@link sourceEndOf}.
 */
export function sourceSpanOf(node: object): AstSourceSpan | undefined {
  const slots = node as Partial<SpanSlots>;
  const start = slots._s;
  if (start === undefined || start === NO_SPAN) {
    return undefined;
  }
  return { start, end: slots._e ?? NO_SPAN };
}

/**
 * Retain parser-owned document trivia.
 *
 * Keyed by the stylesheet ROOT only — one entry per document — so a `WeakMap`
 * bought nothing but an ephemeron the collector had to track. It rides on the
 * root as an ordinary field.
 */
export function withTriviaMap<T extends object>(node: T, trivia: TriviaMap): T {
  (node as { _trivia?: TriviaMap })._trivia = trivia;
  return node;
}

/** Read parser-owned document trivia attached to a canonical AST root. */
export function triviaMapOf(node: object): TriviaMap | undefined {
  return (node as { _trivia?: TriviaMap })._trivia;
}

/** Retain the exact source span inside a block's braces. */
export function withBodySpan<T extends object>(node: T, span: AstSourceSpan): T {
  const slots = node as Partial<BodySpanSlots>;
  slots._bs = span.start;
  slots._be = span.end;
  return node;
}

/** The body-span start offset inside a block's braces, or {@link NO_SPAN}. */
export function bodyStartOf(node: object): number {
  return (node as Partial<BodySpanSlots>)._bs ?? NO_SPAN;
}

/** The body-span end offset inside a block's braces, or {@link NO_SPAN}. */
export function bodyEndOf(node: object): number {
  return (node as Partial<BodySpanSlots>)._be ?? NO_SPAN;
}

/**
 * Read the parser-authored source span inside a block's braces.
 *
 * MATERIALIZES an object per call — see {@link sourceSpanOf}.
 */
export function bodySpanOf(node: object): AstSourceSpan | undefined {
  const slots = node as Partial<BodySpanSlots>;
  const start = slots._bs;
  if (start === undefined || start === NO_SPAN) {
    return undefined;
  }
  return { start, end: slots._be ?? NO_SPAN };
}

/** Retain authored separator/trivia runs for a raw ValueSlot array or List fact.
 *
 * The carrier deliberately remains out-of-band: neither recursive ValueSlot
 * arrays nor the public List shape grows a dialect-specific `separators` field.
 * The same side table can therefore preserve a comma boundary on a List while
 * keeping the semantic payload (`value` + `sep`) minimal.
 */
export function withValueLayout<T extends object>(value: T, separators: ValueLayout): T {
  /* The normal raw ValueSlot renderer already joins absent layout with one space,
   * so recording `[' ', …]` duplicates an implied fact. The one exception is a
   * Less top-level slash: its authored spacedness carries deferred-division
   * semantics (see `variableValueSlot`), so keep that boundary explicit. */
  let hasOnlyDefaultSpaces = true;
  for (const separator of separators) {
    if (separator !== ' ') {
      hasOnlyDefaultSpaces = false;
      break;
    }
  }
  if (separators.length > 0 && hasOnlyDefaultSpaces && !hasTopLevelSlash(value)) {
    return value;
  }
  layouts.set(value, separators);
  return value;
}

function hasTopLevelSlash(value: object): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const part of value) {
    if (
      typeof part === 'object'
      && part !== null
      && 'src' in part
      && typeof part.src === 'string'
      && part.src.trim() === '/'
    ) {
      return true;
    }
  }
  return false;
}

/** Read parser-authored separators for a raw ValueSlot array. */
export function valueLayoutOf(value: object): ValueLayout | undefined {
  return layouts.get(value);
}
