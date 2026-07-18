/**
 * Corpus 04 — Interpolation.
 *
 *   .widget-$[side]           → InterpolatedSelector (Interpolated + Reference)
 *   $['foo'] in a selector    → property interp (Quoted key)
 *   border-$[radius]-radius   → Declaration name is an Interpolated
 *   "$[foo]" / "$($foo)"      → Quoted whose value is an Interpolated
 */
import { describe, it } from 'vitest';
import { expectAst, expectAstContains, expectRoundTrip } from './_util.js';

describe('corpus/interpolation', () => {
  it('selector interpolation (ident) → InterpolatedSelector', () => {
    expectAstContains('.widget-$[side] { color: red; }', `
      (InterpolatedSelector
        value:
          (Interpolated [role=ident]
            source: '.widget-%%'
            replacements:
              [
                (Reference [role=ident]
                  key: 'side'
                )
              ]
          )
      )`);
  });

  it('selector interpolation round-trips to .widget-$[side]', () => {
    expectRoundTrip('.widget-$[side] { color: red; }', '.widget-$[side]');
  });

  it('selector interpolation with quoted key → property interp', () => {
    expectAstContains('.a-$[\'foo\'] { color: red; }', `
      (Interpolated [role=ident]
          role: 'ident'
        source: '.a-%%'
        replacements:
          [
            (Reference [role=ident]
                type: 'property'
                role: 'ident'
              key:
                (Quoted
                    quote: '\\''
                  value: 'foo'
                )
            )
          ]
      )`, { showOptions: true });
  });

  it('interpolation in the middle and multiple slots', () => {
    expectAstContains('.a-$[x]-b-$[y] { color: red; }', `
      (Interpolated [role=ident]
        source: '.a-%%-b-%%'
        replacements:
          [
            (Reference [role=ident]
              key: 'x'
            )
            (Reference [role=ident]
              key: 'y'
            )
          ]
      )`);
  });

  // ── String interpolation (grammar-level `Quoted` override) ──────────────────
  // `$[…]` (key) and `$(…)` (full expression) both structure INSIDE quoted
  // strings, interleaved with literal string-content chunks.
  it('string `$[foo]` key interpolation → Quoted(Interpolated) with a key ref', () => {
    expectAstContains('.a { content: "a $[foo] b"; }', `
      (Quoted
        value:
          (Interpolated [role=ident]
            source: 'a %% b'
            replacements:
              [
                (Reference [role=ident]
                  key: 'foo'
                )
              ]
          )
      )`);
  });

  it('string `$(…)` full-expression interpolation → Quoted(Interpolated) with an Expression', () => {
    expectAstContains('.a { content: "a $(1 + 2) b"; }', `
      (Quoted
        value:
          (Interpolated [role=ident]
            source: 'a %% b'
            replacements:
              [
                (Expression
                  value:
                    (Operation
                      left:
                        (Num 1)
                      right:
                        (Num 2)
                    )
                )
              ]
          )
      )`);
  });

  it('single-quoted string interpolates the same as double', () => {
    expectAstContains('.a { content: \'p $[k] q\'; }', `
      (Quoted
        value:
          (Interpolated [role=ident]
            source: 'p %% q'
            replacements:
              [
                (Reference [role=ident]
                  key: 'k'
                )
              ]
          )
      )`);
  });

  it('adjacent slots with no literal between → back-to-back placeholders', () => {
    expectAstContains('.a { content: "$[foo]$(1 + 2)"; }', `
      (Interpolated [role=ident]
        source: '%%%%'
        replacements:
          [
            (Reference [role=ident]
              key: 'foo'
            )
            (Expression`);
  });

  it('interp-free string stays a FLAT single Quoted leaf (byte-identical fast path)', () => {
    expectAst('.a { content: "plain"; }', `
      (Rules
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Declaration
                    name: 'content'
                    value:
                      (Quoted
                        value: 'plain'
                      )
                  )
                ]
            )
          ]
      )`);
  });

  it('a lone `$` and a `$x` (no `[`/`(`) stay literal — NOT interpolation', () => {
    expectAstContains('.a { content: "a $x $ b"; }', `
      (Quoted
        value: 'a $x $ b'
      )`);
  });

  it('flat-first arm keeps a `$` false-start flat but still routes `$[`/`$(` to interp', () => {
    // A `$` that does NOT open `$[`/`$(` matches the flat no-interp arm →
    // single-leaf flat `Quoted` (no `Interpolated`).
    expectAstContains('.a { content: "cost is $5"; }', `
      (Quoted
        value: 'cost is $5'
      )`);
    // A real `$[` opener fails the flat arm and backtracks to the interp
    // sequence → structured `Interpolated`.
    expectAstContains('.a { content: "$[foo]"; }', `
      (Quoted
        value:
          (Interpolated [role=ident]
            source: '%%'
            replacements:
              [
                (Reference [role=ident]
                  key: 'foo'
                )
              ]
          )
      )`);
  });

  it('string interpolation round-trips verbatim', () => {
    expectRoundTrip('.a { content: "a $[foo] b"; }', '"a $[foo] b"');
    expectRoundTrip('.a { content: "a $(1 + 2) b"; }', '"a $(1 + 2) b"');
    expectRoundTrip('.a { content: "a $x $ b"; }', '"a $x $ b"');
  });
});
