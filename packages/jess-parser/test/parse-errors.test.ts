/**
 * Jess syntax-error reporting (functional parser).
 *
 * Mirrors css-parser/test/parse-errors.test.ts: we assert the error CATEGORY (a
 * stable substring of the message), the FILE, and the LINE/COLUMN — not the exact
 * rendered message string (too fragile).
 *
 * Fixtures live in test/errors/*.jess.
 *
 * Jess is composed on the CSS base (grammar.ts: `compose([cssGrammar, …])`), NOT
 * on Less/SCSS. Its control flow is `$if`/`$else`/`$for`/`$while` (dollar-prefixed)
 * and its mixins are `name(...)` definitions with Less-style `when` guards — those
 * already reject a missing header correctly (`$if { }` errors, `$if ($x) { }` does
 * not). The Sass/Less `@if`/`@each`/`@for`/`@mixin`/`@include` at-rules are NOT Jess
 * syntax: they parse clean only because they fall through to the generic
 * `UnknownAtRuleBlock` catch-all, which MUST stay permissive so legitimate
 * unknown/vendor at-rules (`@tailwind`, `@apply`, …) are accepted. So there is no
 * Jess missing-prelude false negative to fix here.
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

  for (const [name, src] of VALID) {
    test(`valid: ${name} parses clean`, () => {
      const { errors, tree } = parseJessFn(src);
      expect(errors).toHaveLength(0);
      expect(tree).toBeDefined();
    });
  }
});
