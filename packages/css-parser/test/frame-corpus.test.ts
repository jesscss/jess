/**
 * CSS spec-frame corpus (Phase 1 of the frame rework).
 *
 * The grammar models the two CSS "starting frames" structurally:
 *   • Frame 1 (stylesheet body) — qualified rules + at-rules, NO bare
 *     declarations.
 *   • Frame 2 (declaration list) — declarations interleaved with nested rules /
 *     at-rules.
 * The frames differ ONLY in their body content model. The selector grammar is
 * shared: `&` is valid in both frames (a top-level `&` is valid CSS = `:scope`).
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

describe('css frame corpus — the shared `&` selector', () => {
  test('top-level `&` is VALID CSS (`:scope`) — parses clean', () => {
    expect(errs('& { color: red }')).toBe(0);
    expect(errs('& > .a {}')).toBe(0);
    expect(errs('.a, & {}')).toBe(0);
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

describe('css frame corpus — @keyframes (keyframe-selector blocks)', () => {
  test('from/to blocks parse clean', () => {
    expect(errs('@keyframes k { from {} to {} }')).toBe(0);
    expect(errs('@keyframes k { from { opacity: 0 } to { opacity: 1 } }')).toBe(0);
  });

  test('a percentage selector parses clean', () => {
    expect(errs('@keyframes k { 50% { opacity: .5 } }')).toBe(0);
  });

  test('a comma-separated selector list parses clean', () => {
    expect(errs('@keyframes k { 0%, 100% { opacity: 1 } }')).toBe(0);
  });

  test('vendor-prefixed @-webkit-keyframes parses clean', () => {
    expect(errs('@-webkit-keyframes k { from {} to {} }')).toBe(0);
  });

  test('a bare declaration (no selector) is REJECTED', () => {
    expect(errs('@keyframes k { color: red }')).toBeGreaterThanOrEqual(1);
  });

  test('a ruleset inside @keyframes is REJECTED', () => {
    expect(errs('@keyframes k { .foo {} }')).toBeGreaterThanOrEqual(1);
  });
});

describe('css frame corpus — @page (descriptors + margin at-rules)', () => {
  test('a descriptor parses clean', () => {
    expect(errs('@page { margin: 1cm }')).toBe(0);
  });

  test('a page pseudo-selector prelude + margin at-rule parses clean', () => {
    expect(errs('@page :left { @top-center { content: "x" } }')).toBe(0);
  });

  test('a ruleset inside @page is REJECTED', () => {
    expect(errs('@page { .foo {} }')).toBeGreaterThanOrEqual(1);
  });
});

describe('css frame corpus — @font-feature-values (feature-value blocks)', () => {
  test('a feature-value block parses clean', () => {
    expect(errs('@font-feature-values Font { @styleset { nice: 1 } }')).toBe(0);
  });

  test('a bare declaration is REJECTED', () => {
    expect(errs('@font-feature-values F { color: red }')).toBeGreaterThanOrEqual(1);
  });
});

describe('css frame corpus — @document (frame-1 style-rule body)', () => {
  test('style rules inside @-moz-document parse clean', () => {
    expect(errs('@-moz-document url-prefix() { .a { color: red } }')).toBe(0);
  });
});

describe('css frame corpus — transparent bodies stay lenient', () => {
  test('a nested @layer with a bare declaration parses clean (transparent)', () => {
    expect(errs('.a { @layer overrides { color: blue } }')).toBe(0);
  });
});
