import { describe, expect, it } from 'vitest';
import { evalErrorFrameFrom, extractRelevantLines, lineColAt } from '../error/code-frame.js';
import { stampEvalErrorLocation } from '../error/eval-error-location.js';

describe('code-frame source index', () => {
  it('returns correct locations and frame slices for CRLF source without splitting it', () => {
    const source = 'first\r\nsecond\r\nthird\r\n';
    const file = { source };

    expect(lineColAt(source, source.indexOf('second'), file)).toEqual({ line: 2, column: 1 });
    expect(lineColAt(source, source.indexOf('third') + 3, file)).toEqual({ line: 3, column: 4 });
    expect(extractRelevantLines(source, 2, 1, file)).toEqual({
      1: 'first',
      2: 'second',
      3: 'third'
    });
  });

  /*
   * Ledger O16: a diagnostic in the authored file counts from its first authored
   * character, past text a host prepended (`banner`, `globalVars`); the legacy
   * eval seam's generic-error frame counts the same way.
   */
  it('frames a stamped eval error in the file as written, past prepended text', () => {
    const prepared = '@g1: 1;\n@g2: 2;\n.a {\n  b: c;\n}\n';
    const file = { source: prepared, sourceOffset: prepared.indexOf('.a') };
    const error = new TypeError('boom');
    const at = prepared.indexOf('b: c');
    stampEvalErrorLocation(error, at, at + 4, file);
    expect(evalErrorFrameFrom(error)).toEqual({
      line: 2,
      column: 3,
      endLine: 2,
      endColumn: 7,
      lines: { 1: '.a {', 2: '  b: c;', 3: '}' }
    });
  });

  it('refreshes the per-file index when that file supplies different source', () => {
    const file = {};
    expect(lineColAt('one\ntwo', 4, file)).toEqual({ line: 2, column: 1 });
    expect(lineColAt('one\ntwo\nthree', 8, file)).toEqual({ line: 3, column: 1 });
  });
});
