/**
 * Jess syntax-error reporting (functional parser).
 *
 * Mirrors css-parser/test/parse-errors.test.ts: we assert the error CATEGORY (a
 * stable substring of the message), the FILE, and the LINE/COLUMN — not the exact
 * rendered message string (too fragile).
 *
 * Fixtures live in test/errors/*.jess.
 *
 * Jess is composed from css + less + scss + jess, so it inherits Sass/Less
 * at-rules (@if/@each/@for/@mixin/@include). Several of those currently accept a
 * MISSING prelude without error — genuine false negatives. Those cases are marked
 * `test.fails` so the suite stays green today while tracking every missed error:
 * when the grammar is hardened (Phase 2) the `test.fails` will start failing and
 * must be flipped to a real `test`.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseJessFn } from '../src/functional-parser.js';
import { JessError } from '@jesscss/core';

const dir = path.join(__dirname, 'errors');

function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// -------------------------------------------------------------------------
// Cases that SHOULD error and DO — real, passing assertions.
// [file, message-category substring, expected line, expected column]
// -------------------------------------------------------------------------
const DETECTED: Array<[string, string, number, number]> = [
  ['unclosed-brace.jess', '}', 2, 1],        // `.a { color: red` → expect('}') fires at EOF (after trailing newline)
  ['bare-declaration.jess', 'input', 1, 1]   // `color: red` at top level → unparsed input
];

// -------------------------------------------------------------------------
// Cases that SHOULD error but currently DON'T — tracked false negatives.
// Each parses clean today; `test.fails` keeps the suite green while asserting
// the missing error. When the grammar is fixed these flip to `test`.
// -------------------------------------------------------------------------
const MISSED: Array<[string, string]> = [
  ['if-no-condition.jess', '@if with no condition'],
  ['each-no-prelude.jess', '@each with no prelude'],
  ['for-no-prelude.jess', '@for with no prelude'],
  ['mixin-no-name.jess', '@mixin with no name'],
  ['include-no-name.jess', '@include with no name']
];

// Clearly-valid snippets that must parse CLEAN (positive coverage).
const VALID: Array<[string, string]> = [
  ['basic rule', '.a { color: red; }'],
  ['nested ruleset', '.parent { color: red; .child { color: blue; } }'],
  ['$var declaration', '$color: red;'],
  ['@media rule', '@media (min-width: 768px) { .a { color: red; } }']
];

describe('jess syntax errors (parseJessFn)', () => {
  for (const [file, category, line, column] of DETECTED) {
    test(`${file} reports a "${category}" error at ${line}:${column}`, () => {
      const { errors } = parseJessFn(read(file));
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const err = errors[0]!;
      expect(err).toBeInstanceOf(JessError);
      expect(err.code).toBe('parse/syntax-error');
      expect(err.message.toLowerCase()).toContain(category.toLowerCase());
      expect({ line: err.line, column: err.column }).toEqual({ line, column });
    });
  }

  // Tracked-failing: these SHOULD error. They don't yet, so `test.fails` is green.
  // Flip to `test` (and add category/line/column assertions) once the grammar
  // rejects the missing prelude.
  for (const [file, desc] of MISSED) {
    test.fails(`[tracked] ${file} (${desc}) should report a parse error`, () => {
      const { errors } = parseJessFn(read(file));
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  }

  for (const [name, src] of VALID) {
    test(`valid: ${name} parses clean`, () => {
      const { errors, tree } = parseJessFn(src);
      expect(errors).toHaveLength(0);
      expect(tree).toBeDefined();
    });
  }
});
