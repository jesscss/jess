/**
 * Corpus 04 — Interpolation.
 *
 *   .widget-$[side]           → InterpolatedSelector (Interpolated + Reference)
 *   $['foo'] in a selector    → property interp (Quoted key)
 *   border-$[radius]-radius   → Declaration name is an Interpolated
 *   "$[foo]" / "$($foo)"      → Quoted whose value is an Interpolated
 */
import { describe, it } from 'vitest';
import { expectAstContains, expectRoundTrip } from './_util.js';

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
});
