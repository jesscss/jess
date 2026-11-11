import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';

/*
 * A body's at-rules route through one dispatch on the shared at-keyword, so the
 * keyword is read once wherever it stands, whichever directive it names and
 * whether or not a Sass directive claims it. `@return` is one of those arms; as
 * a dispatch of its own beside `SassDirective` (or `SassControlDirective` in a
 * function body), every at-rule the first dispatch missed read its keyword
 * again.
 *
 * The probe counts reads of the at-keyword token through the one regex only that
 * token reads in SCSS: the CSS-only descriptor names (`@font-palette-values`
 * and its siblings), the first alternative `AtRuleKeyword` tries. SCSS routes
 * none of them, so no other rule reads that regex.
 */
const exec = RegExp.prototype.exec;
afterEach(() => {
  RegExp.prototype.exec = exec;
});

const keywordReads = (source: string): Map<number, number> => {
  parse(source);
  const reads = new Map<number, number>();
  RegExp.prototype.exec = function(this: RegExp, input: string) {
    if (this.sticky && this.source.includes('@font-palette-values')) {
      reads.set(this.lastIndex, (reads.get(this.lastIndex) ?? 0) + 1);
    }
    return exec.call(this, input);
  };
  try {
    parse(source);
  } finally {
    RegExp.prototype.exec = exec;
  }
  return reads;
};

/* Every keyword inside a body. The root body (`@function` at 0) routes its at-rules on its own and is out of scope here. */
const bodyKeywords = (source: string): number[] =>
  [...source.matchAll(/@/g)].map(match => match.index).filter(offset => offset > 0);

describe('the at-keyword is read once', () => {
  it.each([
    ['a CSS at-rule in a rule', '.a { @media print { b: c } }'],
    ['an unknown at-rule in a rule', '.a { @foo x; }'],
    ['a Sass directive in a rule', '.a { @include m; }'],
    ['`@return` in a rule', '.a { @return 1; }'],
    ['control directives and `@return` in a function', '@function f() { @if true { @return 1; } @return 2; }'],
    ['`@return` in an `@each` in a function', '@function f() { @each $i in 1 { @return $i; } }']
  ])('%s', (_label, source) => {
    const reads = keywordReads(source);
    expect(bodyKeywords(source).map(offset => reads.get(offset))).toEqual(bodyKeywords(source).map(() => 1));
  });

  it('keeps `@return` out of the root', () => {
    expect(() => parse('@return 1;')).toThrow();
  });
});
