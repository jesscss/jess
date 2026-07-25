/**
 * Test-only CST token-coverage probe.
 *
 * The invariant: for a SINGLE parse, walking the CST's leaves in source order and
 * writing each leaf's text back at its span must reconstruct the source exactly,
 * except over spans the grammar intentionally does not capture as leaves. That
 * allowance is TRIVIA and nothing else (see `TRIVIA_ALLOWANCE` below) — trivia is
 * skipped between terms and recorded on the trivia log, never as a child.
 *
 * This is strictly stronger than a differential: it needs no baseline version and
 * no second parser, so it fails at the commit that introduces the hole rather than
 * whenever someone happens to diff two builds. A production that CONSUMES input
 * without emitting a leaf over it is invisible to output-shape and byte-identity
 * tests, but every position-dependent consumer (language service, error ranges,
 * incremental reparse) reads that span as ABSENT rather than as unstructured text.
 *
 * No production code imports this module.
 */

export type Span = { readonly start: number; readonly end: number };

export type CstLeaf = { readonly _tag: 'leaf'; readonly value: string; readonly span: Span };
export type CstError = { readonly _tag: 'error'; readonly type: string; readonly span: Span; readonly children: readonly CstChild[] };
export type CstNode = { readonly _tag: 'node'; readonly type: string; readonly span: Span; readonly children: readonly CstChild[] };
export type CstChild = CstNode | CstLeaf | CstError;

export type CstParseResult = {
  readonly ok: boolean;
  readonly tree: CstNode;
  readonly unconsumedFrom: number | null;
};

export interface CorpusSource {
  readonly label: string;
  readonly text: string;
}

export interface Dialect {
  readonly name: string;
  readonly parse: (input: string) => CstParseResult;
  /**
   * The ONE allowance: which uncaptured runs are legal between leaves. Anchored
   * and total — a gap passes only if the WHOLE gap is trivia.
   */
  readonly trivia: RegExp;
  readonly sources: readonly CorpusSource[];
}

/*
 * Trivia allowances, stated explicitly per dialect rather than shared, so the CSS
 * lane does not silently inherit the SCSS/Less/Jess `//` line comment. Each mirrors
 * the `rw` trivia rule its grammar installs: whitespace + `/* … *\/` block comments
 * everywhere, plus `// …` line comments in the three preprocessor dialects.
 */
const WS = '[ \\t\\n\\r\\f]';
const BLOCK_COMMENT = '/\\*(?:[^*]|\\*(?!/))*\\*/';
const LINE_COMMENT = '//[^\\n\\r]*';

export const TRIVIA_ALLOWANCE = {
  css: new RegExp(`^(?:${WS}|${BLOCK_COMMENT})*$`),
  preprocessor: new RegExp(`^(?:${WS}|${BLOCK_COMMENT}|${LINE_COMMENT})*$`)
} as const;

export interface Violation {
  readonly dialect: string;
  readonly label: string;
  readonly kind: 'uncovered' | 'leaf-text-mismatch' | 'out-of-order' | 'parse-failed';
  readonly span: Span;
  readonly detail: string;
}

function collectLeaves(node: CstChild, out: CstLeaf[]): CstLeaf[] {
  if (node._tag === 'leaf') {
    out.push(node);
    return out;
  }
  for (const child of node.children) {
    collectLeaves(child, out);
  }
  return out;
}

/**
 * Check one source against one dialect. Returns every violation found rather than
 * the first, so a single run reports the whole hole set.
 */
export function checkSource(dialect: Dialect, source: CorpusSource): Violation[] {
  const { label, text } = source;
  const violations: Violation[] = [];
  const at = (span: Span, kind: Violation['kind'], detail: string): void => {
    violations.push({ dialect: dialect.name, label, kind, span, detail });
  };

  let result: CstParseResult;
  try {
    result = dialect.parse(text);
  } catch (error) {
    at({ start: 0, end: text.length }, 'parse-failed', error instanceof Error ? error.message : String(error));
    return violations;
  }

  /*
   * A corpus entry that does not parse cleanly proves nothing about coverage — the
   * uncovered tail would just be the unconsumed input. Fail loudly instead: the
   * corpus is meant to be valid in the dialect it is listed under.
   */
  if (!result.ok || result.unconsumedFrom !== null) {
    at(
      { start: result.unconsumedFrom ?? 0, end: text.length },
      'parse-failed',
      `parse did not consume the source (ok=${result.ok}, unconsumedFrom=${result.unconsumedFrom})`
    );
    return violations;
  }

  const leaves = collectLeaves(result.tree, []);
  let cursor = 0;
  for (const leaf of leaves) {
    const { start, end } = leaf.span;
    if (start < cursor) {
      at(leaf.span, 'out-of-order', `leaf ${JSON.stringify(leaf.value)} starts before the previous leaf ended (${cursor})`);
      continue;
    }
    if (leaf.value !== text.slice(start, end)) {
      at(leaf.span, 'leaf-text-mismatch', `leaf text ${JSON.stringify(leaf.value)} !== source ${JSON.stringify(text.slice(start, end))}`);
    }
    const gap = text.slice(cursor, start);
    if (gap !== '' && !dialect.trivia.test(gap)) {
      at({ start: cursor, end: start }, 'uncovered', `no leaf covers ${JSON.stringify(gap)}`);
    }
    cursor = end;
  }

  const tail = text.slice(cursor);
  if (tail !== '' && !dialect.trivia.test(tail)) {
    at({ start: cursor, end: text.length }, 'uncovered', `no leaf covers trailing ${JSON.stringify(tail)}`);
  }

  return violations;
}

export function formatViolations(violations: readonly Violation[], sources: ReadonlyMap<string, string>): string {
  return violations
    .map((v) => {
      const text = sources.get(`${v.dialect}:${v.label}`) ?? '';
      const context = text.slice(Math.max(0, v.span.start - 24), Math.min(text.length, v.span.end + 24));
      return `${v.dialect}/${v.label} [${v.span.start},${v.span.end}] ${v.kind}: ${v.detail}\n    …${context}…`;
    })
    .join('\n');
}
