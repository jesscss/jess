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
  ['root-declaration.css', 'input', 1, 1],     // `one: 1;` at top level → declaration not allowed at root
  // Previously tracked-failing (MISSED); now hardened into real errors.
  ['media-no-selector.css', '}', 2, 3],        // bare decl in a TOP-LEVEL @media → strict body → expect('}')
  ['media-decl.css', 'query', 1, 8],           // empty @media query → required prelude missing
  ['media-empty.css', 'query', 1, 8],          // empty @media query + empty body
  ['supports-no-condition.css', 'query', 1, 11], // empty @supports condition
  ['import-empty.css', 'import path', 1, 9]     // @import with no path
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

  test('valid CSS reports no errors', () => {
    expect(parseCssFn('.a { color: red } @media (width > 0) { .b { x: 1 } }').errors).toHaveLength(0);
  });
});
