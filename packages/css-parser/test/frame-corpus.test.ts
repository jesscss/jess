/**
 * CSS spec-frame corpus (Phase 1 of the frame rework).
 *
 * The grammar models the two CSS "starting frames" structurally:
 *   • Frame 1 (stylesheet body) — qualified rules + at-rules, NO bare
 *     declarations, selectors carry NO `&`.
 *   • Frame 2 (declaration list) — declarations interleaved with nested rules /
 *     at-rules, selectors DO include `&`.
 *
 * These tests pin the STRUCTURAL boundaries the frames enforce. Per the guiding
 * principle (parser structures + recovers; the language service judges severity),
 * we assert only the parse-level distinction: does a structurally-invalid shape
 * surface at least one parse error (recovered as a parseError), and does a
 * structurally-valid shape parse clean — regardless of whether the descriptor /
 * property NAME is known (names are an LS concern, never a parse error).
 */
import { describe, test, expect } from 'vitest';
import { parseCssFn } from '../src/functional-parser.js';

function errs(src: string): number {
  return parseCssFn(src).errors.length;
}

describe('css frame corpus — structural & split', () => {
  test('top-level `&` is REJECTED (frame 1 has no parent reference)', () => {
    expect(errs('& { color: red }')).toBeGreaterThanOrEqual(1);
  });

  test('nested `&` is ACCEPTED at any depth (frame 2)', () => {
    expect(errs('.a { & { color: red } }')).toBe(0);
    expect(errs('.a { & .b { color: red } }')).toBe(0);
    expect(errs('.a { &:hover { color: red } }')).toBe(0);
    expect(errs('.a { .b { & .c { x: 1 } } }')).toBe(0);
    expect(errs('.a { :not(&) { x: 1 } }')).toBe(0);
  });

  test('bare declaration at the root is REJECTED (frame 1 has no bare decls)', () => {
    expect(errs('one: 1;')).toBeGreaterThanOrEqual(1);
  });
});

describe('css frame corpus — descriptor bodies (declarations only)', () => {
  test('a ruleset inside @font-face is REJECTED (structural garbage)', () => {
    expect(errs('@font-face { .foo {} }')).toBeGreaterThanOrEqual(1);
  });

  test('a nested `&` inside @font-face is REJECTED', () => {
    expect(errs('@font-face { & { x: 1 } }')).toBeGreaterThanOrEqual(1);
  });

  test('valid @font-face descriptors parse CLEAN', () => {
    expect(errs('@font-face { font-family: x; src: url(a) }')).toBe(0);
  });

  test('an UNKNOWN descriptor NAME is NOT a parse error (shape only)', () => {
    expect(errs('@font-face { colour: red }')).toBe(0);
  });

  test('@property: declarations clean, a ruleset inside is REJECTED', () => {
    expect(errs('@property --x { syntax: "*"; inherits: false }')).toBe(0);
    expect(errs('@property --x { .a { x: 1 } }')).toBeGreaterThanOrEqual(1);
  });

  test('@counter-style declarations parse clean', () => {
    expect(errs('@counter-style thumbs { system: cyclic; symbols: "x" }')).toBe(0);
  });
});

describe('css frame corpus — conditional groups (transparent frame)', () => {
  test('a bare declaration in a TOP-LEVEL @media is REJECTED', () => {
    expect(errs('@media (width > 0) { color: red }')).toBeGreaterThanOrEqual(1);
  });

  test('a nested @media (frame 2) accepts bare declarations', () => {
    expect(errs('.a { @media (width > 0) { color: red } }')).toBe(0);
  });

  test('a top-level @media wrapping a ruleset parses clean', () => {
    expect(errs('@media (width > 0) { .a { color: red } }')).toBe(0);
  });
});

describe('css frame corpus — Phase 2 bodies stay lenient (frame 2 for now)', () => {
  test('@keyframes with from/to blocks parses clean', () => {
    expect(errs('@keyframes k { from { opacity: 0 } to { opacity: 1 } }')).toBe(0);
  });

  test('@page with a descriptor parses clean', () => {
    expect(errs('@page :left { margin: 0 }')).toBe(0);
  });

  test('a nested @layer with a bare declaration parses clean (transparent)', () => {
    expect(errs('.a { @layer overrides { color: blue } }')).toBe(0);
  });
});
