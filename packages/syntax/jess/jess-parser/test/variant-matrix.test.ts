import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { parse as parseWithLines } from '../src/positions.js';
import { parseJessCst } from '../src/cst.js';
import { parseJessCst as parseJessCstWithLines } from '../src/cst/positions.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import {
  assertAstCell,
  assertAstTrackingHasNoObservableContract,
  assertCstCell,
  MATRIX_SOURCE,
  TARGET
} from './variant-matrix-cells.js';

/**
 * The Jess quarter of the 16-cell variant matrix: {AST, CST} x {trackLines off, on}.
 *
 * Each dialect ships FOUR separately compiled grammar tables for these four
 * cells, and a lowering change (the table driver being the live example)
 * re-derives all four. The failure mode this pins is not "does it parse" —
 * every cell parses under every defect below — it is "does the cell behave as
 * the cell it claims to be":
 *
 *   - a CST entry that silently hands back AST objects (`ok: true`, full
 *     capture cost paid, wrong tree),
 *   - a tracking entry that silently drops tracking (parses fine, spans wrong),
 *   - a tracking entry that collapses every position to line 1 / column 1.
 *
 * The line/column expectation is checked TWICE: against a literal, and against
 * a newline count taken from the source text itself. The source text is an
 * oracle independent of the parser, so the pair cannot agree vacuously.
 */
/*
 * PINNED — .jess's root span stops at the last statement, where css and Less
 * cover the whole document. On this fixture, whose last statement is followed
 * only by the final newline, that lands one byte short. Part of the
 * already-pinned 2-2 root-span split; the authoritative note is the PINNED
 * DEFECT block in `scss-parser/test/body-span-trivia.test.ts`.
 *
 * Stated as a literal rather than accommodated, so that unifying the root-span
 * convention fails here and forces this to be re-read.
 */
const ROOT_SPAN_END = MATRIX_SOURCE.length - 1;

describe('Jess variant matrix', () => {
  it('cell AST/trackLines=off — the `.` entry yields an AST, not a CST', () => {
    assertAstCell(parse(MATRIX_SOURCE));
  });

  it('cell AST/trackLines=on — the `/positions` entry yields an AST, not a CST', () => {
    assertAstCell(parseWithLines(MATRIX_SOURCE));
  });

  /*
   * PINNED KNOWN GAP — see variant-matrix-cells.ts. The AST tracking cell has
   * no observable contract to assert, so this pins that fact instead of
   * asserting a difference that does not exist.
   */
  it('cell AST/trackLines=on — PINNED: tracking is not observable on the AST', () => {
    assertAstTrackingHasNoObservableContract(
      () => parse(MATRIX_SOURCE),
      () => parseWithLines(MATRIX_SOURCE)
    );
  });

  it('cell CST/trackLines=off — yields a CST whose spans carry offsets and NO line facts', () => {
    assertCstCell(parseJessCst(MATRIX_SOURCE).tree, { tracked: false, rootEnd: ROOT_SPAN_END });
  });

  it('cell CST/trackLines=on — yields a CST whose spans carry real line AND column', () => {
    assertCstCell(parseJessCstWithLines(MATRIX_SOURCE).tree, { tracked: true, rootEnd: ROOT_SPAN_END });
  });

  /*
   * The small emission check the matrix owes.
   *
   * A tree comparison only proves two paths built the same object graph, and
   * two equally-wrong paths agree. This goes to the end of the pipeline: the
   * emitted CSS is a value with meaning outside the parser, so a cell that
   * drops a child, mangles a span or loses trivia moves it.
   *
   * Both AST cells must emit the SAME bytes: `trackLines` is a span-level
   * setting and has no business moving output. And the expected string is not
   * an echo of the input — the fixture indents `.b` by two spaces and the
   * emitted CSS does not — so this cannot pass by the serializer handing back
   * the source it was given.
   */
  it('cells AST/{off,on} emit CSS, emit it exactly, and emit it identically', () => {
    const expected = '.a {\n  color: red;\n}\n.b {\n  width: 10px;\n}\n';
    expect(expected).not.toBe(MATRIX_SOURCE);
    expect(serialize(parse(MATRIX_SOURCE)).css).toBe(expected);
    expect(serialize(parseWithLines(MATRIX_SOURCE)).css).toBe(expected);
  });

  it('the two CST cells agree on offsets, so only the line facts differ', () => {
    const off = parseJessCst(MATRIX_SOURCE).tree;
    const on = parseJessCstWithLines(MATRIX_SOURCE).tree;
    expect(on.span.start).toBe(off.span.start);
    expect(on.span.end).toBe(off.span.end);
    expect(TARGET.line).toBeGreaterThan(1);
    expect(TARGET.column).toBeGreaterThan(1);
  });
});
