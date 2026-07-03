/**
 * CSS syntax-error reporting (functional parser).
 *
 * Per the project's error-test policy, we assert the error CATEGORY (a stable
 * substring of the message), the FILE, and the LINE/COLUMN where it occurs — not
 * the exact rendered message string (too fragile).
 *
 * Fixtures live in test/css/errors/*.css; *.txt holds the human-facing message
 * for reference only.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseCssFn } from '../src/grammar.js';
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

// [file, message-category substring, expected line, expected column]
const CASES: Array<[string, string, number, number]> = [
  ['invalid-selector.css', 'input', 1, 1],     // `$b`, `@{c}` aren't CSS → unparsed input
  ['no-selector.css', 'input', 1, 1],          // bare `{` at top level → unparsed input
  ['atrule-no-semicolon.css', '}', 2, 16],     // `@content` stops the body → expect('}') fires
  ['charset.css', 'input', 3, 1]              // @charset not first → unparsed input
];

describe('css syntax errors (parseCssFn)', () => {
  for (const [file, category, line, column] of CASES) {
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
