import { expect } from 'vitest';

/**
 * Shared cell assertions for one dialect's quarter of the 16-cell variant
 * matrix. Every dialect's `variant-matrix.test.ts` drives these with its own
 * four entry points, so the four packages pin the SAME contract and a lowering
 * that breaks one dialect's cell cannot hide behind another's.
 *
 * Deliberately written against the PUBLIC parse surface only. It reads no
 * opcode layout, no `_meta` stamp and no digest format, so it survives a change
 * of lowering underneath it — which is the whole point of having it.
 */

/**
 * Valid CSS, therefore valid in all four dialects, and shaped so the target is
 * on neither line 1 nor column 1: a variant that collapses every position to
 * the start of the file fails on BOTH axes rather than sliding past on one.
 */
export const MATRIX_SOURCE = '.a {\n  color: red;\n}\n\n  .b {\n    width: 10px;\n  }\n';

const TARGET_INDEX = MATRIX_SOURCE.indexOf('.b');

/**
 * Line/column counted from the source text with no help from the parser. This
 * is the independent leg of the check: the literals below are what a human
 * reads off the fixture, this is what the bytes say, and a tracking defect has
 * to fool both to pass.
 */
function lineColumnFromSource(index: number): { line: number; column: number } {
  const before = MATRIX_SOURCE.slice(0, index);
  const line = before.split('\n').length;
  const column = index - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

export const TARGET = {
  index: TARGET_INDEX,

  /* Literals, so a bug in lineColumnFromSource cannot make the check vacuous. */
  line: 5,
  column: 3
} as const;

/* Fixture guard: if the source is ever edited, the literals must be re-read. */
{
  const derived = lineColumnFromSource(TARGET_INDEX);
  if (derived.line !== TARGET.line || derived.column !== TARGET.column) {
    throw new Error(
      `variant-matrix fixture drift: '.b' is at line ${derived.line} column ${derived.column}, `
      + `but TARGET says line ${TARGET.line} column ${TARGET.column}. Update both.`
    );
  }
}

/* Narrowing by type predicate rather than assertion: an unexpected shape has to
 * reach an `expect` and fail the cell, not be asserted away into passing. */
type Unknowns = Record<string, unknown>;

function isRecord(value: unknown): value is Unknowns {
  return typeof value === 'object' && value !== null;
}

/**
 * An AST cell. The discriminator against a CST is `_tag`: every parseman CST
 * node carries it and no AST node does, so this fails loudly if a `.`/`positions`
 * entry is ever bound to a CST-host table.
 */
export function assertAstCell(document: unknown): void {
  expect(isRecord(document)).toBe(true);
  if (!isRecord(document)) {
    return;
  }
  expect(document.type).toBe('Stylesheet');
  expect(document._tag).toBeUndefined();
  expect(document.grammarType).toBeUndefined();
  expect(Array.isArray(document.rules)).toBe(true);
  expect(Array.isArray(document.rules) ? document.rules.length : -1).toBe(2);
}

type CstSpan = { start: number; end: number; startLine?: number; startColumn?: number };
type CstLike = {
  _tag: unknown;
  grammarType?: unknown;
  span: CstSpan;
  rules?: unknown[];
};

function isCstLike(value: unknown): value is CstLike {
  return isRecord(value) && isRecord(value.span) && typeof value.span.start === 'number';
}

function cstNodesAt(tree: CstLike, index: number): CstLike[] {
  const found: CstLike[] = [];
  const visit = (node: unknown): void => {
    if (!isCstLike(node) || node._tag !== 'node') {
      return;
    }
    if (node.span.start === index) {
      found.push(node);
    }
    for (const child of node.rules ?? []) {
      visit(child);
    }
  };
  visit(tree);
  return found;
}

/**
 * A CST cell. Asserts the host really is the CST host, and that the tracking
 * setting really took: `tracked: true` demands concrete line AND column on a
 * node that is on neither line 1 nor column 1, `tracked: false` demands their
 * absence. The `?? false` def-field collapse that made an unset `trackLines`
 * indistinguishable from an explicit `false` moves one of these two.
 *
 * `rootEnd` is supplied by the caller because the root-span convention SPLITS
 * 2-2 across the dialects and that split is a known, already-pinned defect:
 * css and Less cover the whole document, scss stops short of the final newline,
 * jess stops at the last statement. See the PINNED DEFECT block in
 * `scss-parser/test/body-span-trivia.test.ts`. Each dialect states its own
 * value so that unifying the convention fails these tests loudly rather than
 * letting a lowering change move a root span unnoticed.
 */
export function assertCstCell(tree: unknown, opts: { tracked: boolean; rootEnd: number }): void {
  expect(isCstLike(tree)).toBe(true);
  if (!isCstLike(tree)) {
    return;
  }
  const root = tree;
  expect(root._tag).toBe('node');
  expect(typeof root.grammarType).toBe('string');
  expect(root.span.start).toBe(0);
  expect(root.span.end).toBe(opts.rootEnd);

  const at = cstNodesAt(root, TARGET.index);
  expect(
    at.length,
    `expected at least one CST node starting at offset ${TARGET.index} ('.b')`
  ).toBeGreaterThan(0);

  const derived = lineColumnFromSource(TARGET.index);
  for (const node of at) {
    if (opts.tracked) {
      expect(node.span.startLine).toBe(TARGET.line);
      expect(node.span.startColumn).toBe(TARGET.column);
      expect(node.span.startLine).toBe(derived.line);
      expect(node.span.startColumn).toBe(derived.column);
    } else {
      expect(node.span.startLine).toBeUndefined();
      expect(node.span.startColumn).toBeUndefined();
    }
  }
  if (opts.tracked) {
    expect(root.span.startLine).toBe(1);
  } else {
    expect(root.span.startLine).toBeUndefined();
  }
}

/** Own properties including non-enumerable ones and symbols, walked deeply. */
function deepOwnProperties(value: unknown, path = '$', out: string[] = [], seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object') {
    out.push(`${path}=${String(value)}`);
    return out;
  }
  if (seen.has(value)) {
    out.push(`${path}=<cycle>`);
    return out;
  }
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    const mark = descriptor.enumerable ? '' : '#';
    if (typeof descriptor.get === 'function') {
      out.push(`${path}.${mark}${key}=<getter>`);
      continue;
    }
    deepOwnProperties(descriptor.value, `${path}.${mark}${key}`, out, seen);
  }
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    out.push(`${path}.@${String(symbol)}`);
  }
  return out;
}

/**
 * PINNED KNOWN GAP — the AST half of the `trackLines` axis has NO observable
 * contract.
 *
 * Measured, not assumed: for every dialect the `/positions` AST entry returns a
 * tree identical to the offsets-only entry down to non-enumerable own
 * properties and symbols, carries no line or column key anywhere, and both
 * entries throw parse errors reporting the SAME `line`/`column` (those are
 * derived from the offset, not from the tracked table). Nothing under any
 * package's `src/` imports the AST `positions` entry.
 *
 * So the AST tracking cell cannot be asserted the way the CST one is, and a
 * test that tried would be comparing undefined to undefined. This pins the gap
 * instead. WHEN THIS FAILS that is the good outcome: AST tracking has gained an
 * observable contract, and this pin must be replaced by a real assertion on it
 * (the shape of `assertCstCell`'s `tracked: true` branch).
 *
 * It also fails if the two AST cells ever diverge for a reason OTHER than line
 * facts, which is the defect a lowering change would introduce.
 */
export function assertAstTrackingHasNoObservableContract(
  parseOffsets: () => unknown,
  parseTracked: () => unknown
): void {
  const offsets = deepOwnProperties(parseOffsets());
  const tracked = deepOwnProperties(parseTracked());

  expect(tracked.filter(entry => /[Ll]ine|[Cc]olumn/.test(entry))).toEqual([]);
  expect(tracked).toEqual(offsets);
}
