/**
 * Cross-dialect leakage matrix — SCSS side (task #35, W2 + W12).
 *
 * SCSS and Less are SIBLINGS over CSS; SCSS must NOT accept Less-only syntax.
 * dart-sass (sass-spec) ships no Less fixtures, so these wrong-accepts are
 * INVISIBLE to the sass-spec oracle — hence this dedicated reject matrix.
 *
 * Two locking mechanisms are used deliberately:
 *  - GREEN reject assertions: constructs SCSS already rejects (a regression
 *    guard — flips red if the grammar ever starts accepting them).
 *  - `it.fails` TRACKED wrong-accepts: constructs SCSS wrongly ACCEPTS today.
 *    The structural fix is the dialect re-base (W5/W6 — SCSS stops composing on
 *    the Less delta); until it lands, `it.fails` keeps the suite green while
 *    LOCKING the expectation. When the re-base rejects one of these, its
 *    `it.fails` flips red — delete the `it.fails` wrapper and promote it to a
 *    plain `it` at that point.
 *
 * NOTE (owner decision — permissive unknown at-rules): `@`-form Less-isms
 * leaking into SCSS is BY DESIGN, not a bug. Anything that parses as an unknown
 * at-rule (`@dr: { … }` detached-ruleset assignment reads as an at-rule) is NOT
 * asserted as a reject here. This file tracks the NON-`@` Less constructs.
 *
 * TEST-ONLY. Do not relax the grammar to make anything here pass.
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/jess.js';

const parser = new Parser();

/** True iff parsing `src` as a stylesheet yields at least one lexer/parser error. */
function hasParseError(src: string): boolean {
  try {
    const r = parser.parse(src, 'Stylesheet');
    return r.lexerResult.errors.length > 0 || r.errors.length > 0;
  } catch {
    // A thrown parse still means the input was not accepted.
    return true;
  }
}

describe('SCSS rejects Less-only constructs (W2 — cross-dialect leakage)', () => {
  // Constructs SCSS wrongly ACCEPTS today. Tracked via `it.fails` so the suite
  // stays green while the expectation is LOCKED for the W5/W6 re-base to satisfy.
  const trackedWrongAccepts: Array<[string, string]> = [
    ['a Less `.mixin()` call (inside a rule)', '.a { .mixin(); }'],
    ['a Less `.mixin()` call (top level)', '.mixin();'],
    ['a Less `when()` guard on a selector', '.a when (true) { color: red }'],
    ['a Less detached-ruleset assignment `@dr: { … }`', '@dr: { color: red };'],
    ['a Less `+:` merge property', '.a { box-shadow+: inset 0 0 red; }'],
    ['a Less `+_:` (space) merge property', '.a { transform+_: scale(2); }'],
    ['a Less `#ns[$var]` namespace lookup', '.a { width: #ns[$var]; }'],
    ['a numeric-leading identifier selector `1a {}`', '1a { color: red }']
  ];

  for (const [name, src] of trackedWrongAccepts) {
    // `it.fails` = tracked wrong-accept (LOCKED for the W5/W6 re-base), not a disabled test.
    it.fails(`[tracked wrong-accept] SCSS should reject ${name}`, () => {
      expect(hasParseError(src), `expected SCSS to reject: ${src}`).toBe(true);
    });
  }

  // Positive controls: the SCSS-native equivalents MUST parse clean, proving the
  // rejects above are dialect-specific and not a blanket rejection of the shape.
  const scssNativeAccepts: Array<[string, string]> = [
    ['SCSS `@include` mixin call', '.a { @include mixin; }'],
    ['SCSS `@if` guard', '@if true { color: red }'],
    ['SCSS `$var` map/list assignment', '$dr: (color: red);'],
    ['SCSS `#{$var}` interpolation in a value', '.a { width: #{$var}; }'],
    ['SCSS `%placeholder` selector', '%btn { color: red }']
  ];

  for (const [name, src] of scssNativeAccepts) {
    it(`[control] SCSS accepts ${name}`, () => {
      expect(hasParseError(src), `expected SCSS to accept: ${src}`).toBe(false);
    });
  }
});
