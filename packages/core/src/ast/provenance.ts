import type { Trivia, TriviaMap } from '../types/index.js';

/**
 * Parser-authored source spans for canonical AST nodes.
 *
 * AST v2 nodes remain plain semantic data, so source locations live in a side
 * table instead of changing every hot node shape. Parseman reductions provide
 * the exact span; evaluation reads it only when constructing a diagnostic.
 */
export type AstSourceSpan = Readonly<{ start: number; end: number }>;
export type AstTriviaRange = AstSourceSpan;
export interface ParserTriviaEntriesView {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}
export interface ParserRootTriviaIndex {
  readonly entries: ParserTriviaEntriesView;
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
 * Parser packages consume the public `@jesscss/core/ast` subpath while core
 * evaluation is also loaded through the package root. Build tools may therefore
 * materialize more than one copy of this small module. A process-global symbol
 * keeps the one parser-authored side table shared across those module identities
 * without adding properties to AST nodes or creating a test-only metadata path.
 */
const spanStoreKey = Symbol.for('jess.ast.source-span-store');
const globalStore = globalThis as typeof globalThis & {
  [spanStoreKey]?: WeakMap<object, AstSourceSpan>;
};
const spans = globalStore[spanStoreKey] ??= new WeakMap<object, AstSourceSpan>();

const layoutStoreKey = Symbol.for('jess.ast.value-layout-store');
const layoutGlobal = globalThis as typeof globalThis & {
  [layoutStoreKey]?: WeakMap<object, ValueLayout>;
};
const layouts = layoutGlobal[layoutStoreKey] ??= new WeakMap<object, ValueLayout>();

const triviaStoreKey = Symbol.for('jess.ast.trivia-map-store');
const triviaGlobal = globalThis as typeof globalThis & {
  [triviaStoreKey]?: WeakMap<object, TriviaMap>;
};
const triviaMaps = triviaGlobal[triviaStoreKey] ??= new WeakMap<object, TriviaMap>();

const bodySpanStoreKey = Symbol.for('jess.ast.body-span-store');
const bodySpanGlobal = globalThis as typeof globalThis & {
  [bodySpanStoreKey]?: WeakMap<object, AstSourceSpan>;
};
const bodySpans = bodySpanGlobal[bodySpanStoreKey] ??= new WeakMap<object, AstSourceSpan>();

function makeAstTrivia(src: string, start: number, end: number): Trivia {
  let hasComment = false;
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) {
      hasComment = true;
      break;
    }
  }
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
export function createTriviaMapFromRootIndex(
  src: string,
  index: ParserRootTriviaIndex
): TriviaMap {
  const cache = new Map<number, Trivia>();
  const canonicalByRange = new Map<string, Trivia>();
  let maps: {
    readonly before: Map<number, Trivia>;
    readonly after: Map<number, Trivia>;
  } | undefined;
  let sortedComments: readonly Trivia[] | undefined;

  const runAt = (entryIndex: number): Trivia | undefined => {
    const start = index.entries.start(entryIndex);
    const end = index.entries.end(entryIndex);
    if (end <= start) {
      return undefined;
    }
    let run = cache.get(entryIndex);
    if (run === undefined) {
      const key = `${start}:${end}`;
      run = canonicalByRange.get(key);
      if (run === undefined) {
        run = makeAstTrivia(src, start, end);
        canonicalByRange.set(key, run);
      }
      cache.set(entryIndex, run);
    }
    return run;
  };

  const getMaps = () => {
    if (maps !== undefined) {
      return maps;
    }
    const before = new Map<number, Trivia>();
    const after = new Map<number, Trivia>();
    for (let entryIndex = 0; entryIndex < index.entries.length; entryIndex++) {
      const run = runAt(entryIndex);
      if (run === undefined) {
        continue;
      }
      after.set(run.start, run);
      before.set(run.end, run);
    }
    maps = { before, after };
    return maps;
  };

  return {
    lookup(offset, direction) {
      if (offset === undefined) {
        return undefined;
      }
      const entries = getMaps();
      return direction === 'before'
        ? entries.before.get(offset)
        : entries.after.get(offset);
    },
    *entries(direction) {
      yield* (direction === 'before' ? getMaps().before : getMaps().after).entries();
    },
    has(offset, direction) {
      if (offset === undefined) {
        return false;
      }
      const entries = getMaps();
      return direction === 'before'
        ? entries.before.has(offset)
        : entries.after.has(offset);
    },
    commentRuns() {
      if (sortedComments === undefined) {
        const runs: Trivia[] = [];
        const seen = new Set<string>();
        for (let entryIndex = 0; entryIndex < index.entries.length; entryIndex++) {
          const run = runAt(entryIndex);
          if (run?.hasComment === true) {
            const key = `${run.start}:${run.end}`;
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
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

/** Retain the exact Parseman reduction span for an AST factory result. */
export function withSourceSpan<T extends object>(node: T, span: AstSourceSpan): T {
  spans.set(node, span);
  return node;
}

/** Read a parser-authored span, if the AST node originated in source. */
export function sourceSpanOf(node: object): AstSourceSpan | undefined {
  return spans.get(node);
}

/** Retain parser-owned document trivia without adding fields to the AST root. */
export function withTriviaMap<T extends object>(node: T, trivia: TriviaMap): T {
  triviaMaps.set(node, trivia);
  return node;
}

/** Read parser-owned document trivia attached to a canonical AST root. */
export function triviaMapOf(node: object): TriviaMap | undefined {
  return triviaMaps.get(node);
}

/** Retain the exact source span inside a block's braces. */
export function withBodySpan<T extends object>(node: T, span: AstSourceSpan): T {
  bodySpans.set(node, span);
  return node;
}

/** Read the parser-authored source span inside a block's braces. */
export function bodySpanOf(node: object): AstSourceSpan | undefined {
  return bodySpans.get(node);
}

/** Retain authored separator/trivia runs for a raw ValueSlot array or List fact.
 *
 * The carrier deliberately remains out-of-band: neither recursive ValueSlot
 * arrays nor the public List shape grows a dialect-specific `separators` field.
 * The same side table can therefore preserve a comma boundary on a List while
 * keeping the semantic payload (`value` + `sep`) minimal.
 */
export function withValueLayout<T extends object>(value: T, separators: ValueLayout): T {
  layouts.set(value, separators);
  return value;
}

/** Read parser-authored separators for a raw ValueSlot array. */
export function valueLayoutOf(value: object): ValueLayout | undefined {
  return layouts.get(value);
}
