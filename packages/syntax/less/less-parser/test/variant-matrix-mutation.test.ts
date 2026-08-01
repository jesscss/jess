import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { parse as parseWithLines } from '../src/positions.js';
import { parseLessCst } from '../src/cst.js';
import { parseLessCst as parseLessCstWithLines } from '../src/cst/positions.js';
import {
  assertAstCell,
  assertAstTrackingHasNoObservableContract,
  assertCstCell,
  MATRIX_SOURCE
} from './variant-matrix-cells.js';

/* Must match the dialect's value in variant-matrix.test.ts. */
const ROOT_SPAN_END = MATRIX_SOURCE.length;

/**
 * The cells in `variant-matrix.test.ts` claim to catch specific defects. A
 * claim like that is worth exactly as much as its demonstration, and this repo
 * has shipped assertions that held whether or not the code worked — a
 * three-way sweep that agreed because all three sides were broken, a
 * comparison of `undefined` to `undefined` on a field that did not exist.
 *
 * So each case here injects one defect and requires the matching assertion to
 * REJECT it. If a cell is ever weakened into vacuity, its mutation stops
 * throwing and this file goes red.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function deepCopy(value: unknown): unknown {
  const copied: unknown = JSON.parse(JSON.stringify(value));
  return copied;
}

/** Deep copy of a CST with the named span fields all rewritten to 1. */
function collapseSpanFields(tree: unknown, fields: readonly string[]): unknown {
  const copy = deepCopy(tree);
  const visit = (node: unknown): void => {
    if (!isRecord(node)) {
      return;
    }
    const span = node.span;
    if (isRecord(span)) {
      for (const field of fields) {
        if (span[field] !== undefined) {
          span[field] = 1;
        }
      }
    }
    const rules = node.rules;
    if (Array.isArray(rules)) {
      rules.forEach(visit);
    }
  };
  visit(copy);
  return copy;
}

function mustThrow(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  expect(threw, `MUTATION NOT CAUGHT: ${label}`).toBe(true);
}

describe('mutation check — the variant-matrix cells must reject these', () => {
  it('CST entry silently handing back AST objects', () => {
    mustThrow('AST tree passed to assertCstCell(tracked:false)', () =>
      assertCstCell(parse(MATRIX_SOURCE), { tracked: false, rootEnd: ROOT_SPAN_END }));
    mustThrow('AST tree passed to assertCstCell(tracked:true)', () =>
      assertCstCell(parseWithLines(MATRIX_SOURCE), { tracked: true, rootEnd: ROOT_SPAN_END }));
  });

  it('AST entry silently handing back CST objects', () => {
    mustThrow('CST tree passed to assertAstCell', () =>
      assertAstCell(parseLessCst(MATRIX_SOURCE).tree));
    mustThrow('CST tracked tree passed to assertAstCell', () =>
      assertAstCell(parseLessCstWithLines(MATRIX_SOURCE).tree));
  });

  it('trackLines silently dropped — the tracking cell served by the offsets table', () => {
    mustThrow('offsets CST passed to assertCstCell(tracked:true)', () =>
      assertCstCell(parseLessCst(MATRIX_SOURCE).tree, { tracked: true, rootEnd: ROOT_SPAN_END }));
  });

  it('trackLines silently enabled — the offsets cell served by the tracking table', () => {
    mustThrow('tracked CST passed to assertCstCell(tracked:false)', () =>
      assertCstCell(parseLessCstWithLines(MATRIX_SOURCE).tree, { tracked: false, rootEnd: ROOT_SPAN_END }));
  });

  it('line/column collapsed to the start of the file', () => {
    const collapsed = collapseSpanFields(
      parseLessCstWithLines(MATRIX_SOURCE).tree,
      ['startLine', 'startColumn']
    );
    mustThrow('every position collapsed to 1:1', () =>
      assertCstCell(collapsed, { tracked: true, rootEnd: ROOT_SPAN_END }));
  });

  it('line tracked but column collapsed', () => {
    const collapsed = collapseSpanFields(
      parseLessCstWithLines(MATRIX_SOURCE).tree,
      ['startColumn']
    );
    mustThrow('columns collapsed to 1', () =>
      assertCstCell(collapsed, { tracked: true, rootEnd: ROOT_SPAN_END }));
  });

  it('the AST pin fires when the two AST cells diverge', () => {
    mustThrow('AST pin against two different trees', () =>
      assertAstTrackingHasNoObservableContract(
        () => parse(MATRIX_SOURCE),
        () => parse('.a { color: red; }')
      ));
  });

  it('the AST pin fires when AST tracking gains line facts', () => {
    mustThrow('AST pin against a tree carrying a line key', () =>
      assertAstTrackingHasNoObservableContract(
        () => parse(MATRIX_SOURCE),
        () => {
          const doc = deepCopy(parse(MATRIX_SOURCE));
          if (isRecord(doc) && Array.isArray(doc.rules) && isRecord(doc.rules[0])) {
            doc.rules[0].startLine = 1;
          }
          return doc;
        }
      ));
  });
});
