/**
 * Corpus 10 — Selector capture `*[…]`.
 *
 *   $type: *[.notice];        capture a single selector
 *   $type: *[.a, .b];         capture a selector list
 *   $type: *[.foo .bar];      capture a complex selector
 *
 * A `*[…]` payload is a selector-VALUED expression — a core `SelectorCapture`
 * wrapping a Selector node. It serializes back as `*[…]` with NO `$` sigil (user-
 * adjudicated: `*[…]` is canonical, matching core's `SelectorCapture.writeSyntax`;
 * the docs' `$*[…]` is wrong and gets the `$` dropped in the docs-update task). The
 * inner selector is coerced to a real node: a lone selector → BasicSelector, a
 * comma list → SelectorList, a complex one → ComplexSelector.
 *
 * `*[…]` feeds `$extend` (see corpus 09): both `$extend *[.sel];` (literal capture)
 * and `$extend $type;` (a variable holding one) build the Extend target.
 */
import { describe, it } from 'vitest';
import { expectAstContains } from './_util.js';

describe('corpus/selector-capture', () => {
  it('`*[.notice]` → SelectorCapture wrapping a BasicSelector', () => {
    expectAstContains('$type: *[.notice];', `
      (SelectorCapture
        selector:
          (BasicSelector '.notice')
      )`);
  });

  it('allows trivia around the selector list inside `*[…]`', () => {
    expectAstContains('$type: *[ .notice ];', `
      (SelectorCapture
        selector:
          (BasicSelector '.notice')
      )`);
  });

  it('`*[.a, .b]` → SelectorCapture wrapping a SelectorList', () => {
    expectAstContains('$type: *[.a, .b];', `
      (SelectorCapture
        selector:
          (SelectorList
            value:
              [
                (BasicSelector '.a')
                (BasicSelector '.b')
              ]
          )
      )`);
  });

  it('`*[.foo .bar]` → SelectorCapture wrapping a ComplexSelector', () => {
    expectAstContains('$type: *[.foo .bar];', `
      (SelectorCapture
        selector:
          (ComplexSelector
            value:
              [
                '.foo'
                ' '
                '.bar'
              ]
          )
      )`);
  });
});
