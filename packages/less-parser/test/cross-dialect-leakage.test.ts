/**
 * Cross-dialect leakage matrix — Less side (task #35, W12).
 *
 * Less and SCSS are SIBLINGS over CSS; Less must NOT accept SCSS-only SIGIL
 * syntax (`$var`, `#{}` interpolation, `%placeholder`). No bundled oracle
 * covers this direction — it is the exact gap that let wrong-accepts hide behind
 * green suites, so it is asserted explicitly here.
 *
 * By-design boundary (owner decision — permissive unknown at-rules): `@`-form
 * SCSS at-rules (`@mixin`, `@include`, `@if`, `@use`, …) are unknown at-rules to
 * Less and leak BY DESIGN. That permissive acceptance is PINNED below (asserted
 * as accepted), so a future change that flips it surfaces as a deliberate
 * decision rather than silent drift — it is NOT a bug to fix.
 *
 * TEST-ONLY. Do not relax the grammar to make anything here pass.
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/jess.js';

const parser = new Parser();

/** True iff parsing `src` yields at least one lexer/parser error. */
function hasParseError(src: string): boolean {
  try {
    const r = parser.parse(src);
    const lexer = r.lexerResult?.errors ?? [];
    return lexer.length > 0 || r.errors.length > 0;
  } catch {
    // A thrown parse still means the input was not accepted.
    return true;
  }
}

describe('Less rejects SCSS-only sigil constructs (W12 — cross-dialect leakage)', () => {
  // Enforced GREEN rejects — Less already rejects these SCSS sigils; this is a
  // regression guard that flips red if the grammar ever starts accepting them.
  const enforcedRejects: Array<[string, string]> = [
    ['a SCSS `$var` declaration', '$x: 1;'],
    ['a SCSS `#{}` interpolation in a value', '.a { width: #{y}; }'],
    ['a SCSS `%placeholder` selector (top level)', '%btn { color: red }'],
    ['a SCSS `%placeholder` selector (nested)', '.a { %btn { color: red } }']
  ];

  for (const [name, src] of enforcedRejects) {
    it(`Less rejects ${name}`, () => {
      expect(hasParseError(src), `expected Less to reject: ${src}`).toBe(true);
    });
  }

  // Positive controls: Less-native equivalents MUST parse clean.
  const lessNativeAccepts: Array<[string, string]> = [
    ['Less `@var` declaration', '@x: 1;'],
    ['Less `@{}` interpolation in a value', '.a { width: ~"@{y}"; }'],
    ['Less `.mixin()` call', '.a { .mixin(); }']
  ];

  for (const [name, src] of lessNativeAccepts) {
    it(`[control] Less accepts ${name}`, () => {
      expect(hasParseError(src), `expected Less to accept: ${src}`).toBe(false);
    });
  }

  // By-design permissive leak: `@`-form SCSS at-rules parse as unknown at-rules.
  // Pinned as ACCEPTED so the owner's permissive-unknown-at-rule decision is
  // explicit and any future flip is a tracked change, not silent drift.
  const byDesignPermissiveAccepts: Array<[string, string]> = [
    ['SCSS `@mixin` (unknown at-rule)', '@mixin foo { color: red }'],
    ['SCSS `@include` (unknown at-rule)', '.a { @include foo; }'],
    ['SCSS `@if` (unknown at-rule)', '@if 1 { color: red }'],
    ['SCSS `@use` (unknown at-rule)', '@use "x";']
  ];

  for (const [name, src] of byDesignPermissiveAccepts) {
    it(`[by-design] Less permissively accepts ${name}`, () => {
      expect(hasParseError(src), `expected Less to permissively accept: ${src}`).toBe(false);
    });
  }
});
