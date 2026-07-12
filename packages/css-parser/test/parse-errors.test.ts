/**
 * CSS syntax-error reporting (functional parser).
 *
 * Per the project's error-test policy, we assert the error CATEGORY (a stable
 * substring of the message), the FILE, and the LINE/COLUMN where it occurs — not
 * the exact rendered message string (too fragile).
 *
 * Mirrors jess-parser/test/parse-errors.test.ts: DETECTED cases SHOULD error and
 * DO (real passing assertions); MISSED cases SHOULD error but currently DON'T —
 * genuine false negatives marked `test.fails` so the suite stays green today
 * while tracking every missed error. When the grammar is hardened (Phase 2) the
 * `test.fails` starts failing and must be flipped to a real `test`.
 *
 * Fixtures live in test/css/errors/*.css; *.txt holds the human-facing message
 * for reference only. Valid-CSS fixtures that (correctly) parse clean live in
 * test/css/*.css and are exercised by css-files.test.ts / parseman.test.ts.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseCssFn } from '../src/functional-parser.js';
import { JessError } from '@jesscss/core';

const dir = path.join(__dirname, 'css', 'errors');

function lineCol(src: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset; i++) {
    if (src[i] === '\n') {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

// -------------------------------------------------------------------------
// Cases that SHOULD error and DO — real, passing assertions.
// [file, message-category substring, expected line, expected column]
// -------------------------------------------------------------------------
const DETECTED: Array<[string, string, number, number]> = [
  ['invalid-selector.css', 'input', 1, 1],     // `$b`, `@{c}` aren't CSS → unparsed input
  ['no-selector.css', 'input', 1, 1],          // bare `{` at top level → unparsed input
  ['atrule-no-semicolon.css', '}', 2, 16],     // `@content` stops the body → expect('}') fires
  ['charset.css', 'input', 3, 1],              // @charset not first → unparsed input
  ['root-declaration.css', 'input', 1, 1]      // `one: 1;` at top level → declaration not allowed at root
];

// -------------------------------------------------------------------------
// Cases that SHOULD error but currently DON'T — tracked false negatives.
// Each parses clean today; `test.fails` keeps the suite green while asserting
// the missing error. When the grammar is fixed these flip to `test` (and gain
// category/line/column assertions). Ground truth: lessc rejects media-empty,
// media-decl and import-empty; media-no-selector and supports-no-condition are
// invalid per the CSS spec (a declaration directly inside @media has no owning
// qualified rule; @supports requires a condition). Note import-empty is rejected
// by the less-parser but tolerated here by the css-parser.
// -------------------------------------------------------------------------
const MISSED: Array<[string, string]> = [
  ['media-no-selector.css', '@media block wrapping a bare declaration'],
  ['media-empty.css', '@media with empty prelude and body'],
  ['media-decl.css', '@media wrapping a bare declaration (no qualified rule)'],
  ['supports-no-condition.css', '@supports with no condition'],
  ['import-empty.css', '@import with empty prelude']
];

describe('css syntax errors (parseCssFn)', () => {
  for (const [file, category, line, column] of DETECTED) {
    test(`${file} reports a ${category} error at ${line}:${column}`, () => {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const { errors } = parseCssFn(src);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const err = errors[0]!;
      // Every parser emits a typed JessError (same shape across css/less).
      expect(err).toBeInstanceOf(JessError);
      expect(err.code).toBe('parse/syntax-error');
      // category, not exact message
      expect(err.message.toLowerCase()).toContain(category);
      // typed line/column directly off the JessError (not recomputed from offset)
      expect({ line: err.line, column: err.column }).toEqual({ line, column });
      void lineCol;
    });
  }

  // Tracked-failing: these SHOULD error. They don't yet, so `test.fails` is green.
  // Flip to `test` (and add category/line/column assertions) once the grammar
  // rejects them.
  for (const [file, desc] of MISSED) {
    test.fails(`[tracked] ${file} (${desc}) should report a parse error`, () => {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const { errors } = parseCssFn(src);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  }

  test('valid CSS reports no errors', () => {
    expect(parseCssFn('.a { color: red } @media (width > 0) { .b { x: 1 } }').errors).toHaveLength(0);
  });
});
