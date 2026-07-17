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
  ['supports-no-condition.css', 'supports condition', 1, 11], // empty @supports (no <supports-condition>)
  ['supports-bare-ident.css', 'supports condition', 1, 11],   // `@supports color` — bare ident, not a condition
  ['import-empty.css', 'import path', 1, 9],     // @import with no path
  // Numeric / dimension tokens in ident-required grammar slots. Per CSS Syntax 3,
  // `1foo` and `.1foo` each tokenize as a single <dimension-token> (greedy numeric
  // token consuming a trailing ident sequence) — NOT a `.`-delim plus an ident — so
  // they cannot satisfy productions that require an <ident-token>.
  ['selector-class-numeric.css', 'input', 1, 1], // `.1foo` is a dimension-token, not `.`+ident → invalid class selector
  ['selector-type-numeric.css', 'input', 1, 1],  // `1foo` dimension-token → invalid type selector
  ['declaration-numeric-name.css', '}', 1, 6],   // `1foo:` — declaration name must be an ident-token
  ['atrule-numeric-name.css', 'input', 1, 1],    // `@1foo` — at-rule name must be an ident-token
  // @keyframes carve-out: the selector slot accepts `from | to | <percentage>`, so a
  // percentage-token is valid there — but a bare dimension/number/other ident is not.
  ['keyframes-dimension-selector.css', '}', 1, 16], // `50px` is a dimension-token, not a <percentage>
  ['keyframes-number-selector.css', '}', 1, 16],    // bare `0` is a number-token, not a <percentage>
  ['keyframes-bad-ident-selector.css', '}', 1, 16], // `foo` is an ident but not `from`/`to`
  // An unquoted `url(...)` body is a <url-token>, which may not contain interior
  // whitespace (css-syntax-3 §4.3.6 — `url(foo bar)` is a <bad-url-token>). The
  // `url(` open commits, so the trailing `)` is expected right after the body run.
  ['url-interior-whitespace.css', ')', 1, 17],  // `url(foo bar)` — ws inside unquoted url
  // The unquoted <url-token> body is `( url-code-point | escape )+` (css-syntax-3
  // §4.3.6). `(` and a bare `"`/`'` are NOT url code points (a `(` inside makes a
  // <bad-url-token>), so the body stops there and the committed `)` is missing.
  ['url-token-open-paren.css', ')', 1, 14],     // `url(a(b))` — `(` inside url-token
  ['url-token-bare-quote.css', ')', 1, 14],     // `url(a"b)` — bare `"` inside url-token
  // A `calc(...)` body is a <calc-sum>, which requires ≥1 <calc-value>
  // (css-values-4 §10). An empty `calc()` and a lone-operator `calc(+)` have no
  // value; the `calc(` open commits (expect), so they error rather than
  // backtracking into the generic Call arm that would accept them.
  ['calc-empty.css', 'calc value', 1, 14],       // `calc()` — no <calc-value>
  ['calc-lone-operator.css', 'calc value', 1, 14] // `calc(+)` — a bare operator is not a value
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

  // Counter-cases: the same numeric/dimension tokens are VALID where the grammar
  // accepts them, so the rejections above are position-specific, not blanket.
  test('a dimension-token is valid in value position', () => {
    // `1foo` is a <dimension-token>; a declaration value accepts arbitrary component values.
    expect(parseCssFn('.a { x: 1foo }').errors).toHaveLength(0);
  });

  test('@keyframes accepts from/to/<percentage> selectors', () => {
    const src =
      '@keyframes x { 50% { opacity: 1 } from { opacity: 0 } to { opacity: 1 } 0%, 100% { opacity: 1 } }';
    expect(parseCssFn(src).errors).toHaveLength(0);
  });

  // Counter-cases for the `url(...)` boundary: only interior whitespace in an
  // unquoted <url-token> is rejected. The plain, whitespace-trimmed, empty, and
  // quoted-function forms all stay valid.
  test('valid url() forms parse clean', () => {
    expect(parseCssFn('.a { x: url(foo) }').errors).toHaveLength(0);   // plain unquoted
    expect(parseCssFn('.a { x: url( foo ) }').errors).toHaveLength(0); // leading/trailing ws trimmed
    expect(parseCssFn('.a { x: url() }').errors).toHaveLength(0);      // empty
    expect(parseCssFn('.a { x: url("a b") }').errors).toHaveLength(0); // quoted function form (ws ok)
    expect(parseCssFn('.a { x: url(a\\ b) }').errors).toHaveLength(0);  // escaped space = one url code point
    expect(parseCssFn('.a { x: url(a\\41 b) }').errors).toHaveLength(0); // hex escape `\41` + trailing-space terminator → one token
  });

  // Counter-cases for the `calc(...)` boundary: only the value-less bodies are
  // rejected. A single value, an operator expression, and a whitespace-padded
  // value all stay valid.
  test('valid calc() forms parse clean', () => {
    expect(parseCssFn('.a { x: calc(1) }').errors).toHaveLength(0);     // single value
    expect(parseCssFn('.a { x: calc(1 + 2) }').errors).toHaveLength(0); // sum expression
    expect(parseCssFn('.a { x: calc( 1 ) }').errors).toHaveLength(0);   // padded value
  });

  // Counter-cases for the `@supports` boundary: only `@supports` requires a
  // `<supports-condition>` (parens / `not` / function). The `@media`/`@container`
  // bare-query forms stay valid, and every parenthesized/not/function `@supports`
  // condition — including the custom-property test `(--x: y)` that the structured
  // path can't feature-parse — is accepted.
  test('valid conditional-group preludes parse clean', () => {
    expect(parseCssFn('@supports (color: red) { .a { x: 1 } }').errors).toHaveLength(0);
    expect(parseCssFn('@supports not (x: y) { .a { x: 1 } }').errors).toHaveLength(0);
    expect(parseCssFn('@supports (--custom: value) { .a { x: 1 } }').errors).toHaveLength(0);
    expect(parseCssFn('@supports selector(a > b) { .a { x: 1 } }').errors).toHaveLength(0);
    expect(parseCssFn('@media screen { .a { x: 1 } }').errors).toHaveLength(0);       // bare media-type stays valid
    expect(parseCssFn('@container name (width > 0) { .a { x: 1 } }').errors).toHaveLength(0);
  });
});
