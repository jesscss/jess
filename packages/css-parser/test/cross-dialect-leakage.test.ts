/**
 * Cross-dialect leakage matrix — CSS side (task #35, W12).
 *
 * `cssGrammar` is the shared base under less/scss/jess; it must reject the
 * preprocessor SIGIL constructs that the dialects add (`$var`, `#{}`
 * interpolation, `.mixin()` calls, `%placeholder`). This is the base-level
 * regression guard: if plain CSS ever starts accepting a preprocessor sigil,
 * every dialect inherits the leak.
 *
 * By-design boundary (owner decision — permissive unknown at-rules): an unknown
 * at-rule such as `@x: 1;` parses permissively; that is pinned as ACCEPTED, not
 * treated as a leak. Native CSS nesting (`&`) is valid CSS and also accepted.
 *
 * TEST-ONLY. Do not relax the grammar to make anything here pass.
 */
import { describe, it, expect } from 'vitest';
import { parseCssFn } from '../src/functional-parser.js';

/** True iff parsing `src` as CSS yields at least one parser error. */
function hasParseError(src: string): boolean {
  try {
    return parseCssFn(src).errors.length > 0;
  } catch {
    // A thrown parse still means the input was not accepted.
    return true;
  }
}

describe('CSS rejects preprocessor sigil constructs (W12 — cross-dialect leakage)', () => {
  const enforcedRejects: Array<[string, string]> = [
    ['a SCSS `$var` declaration', '$x: 1;'],
    ['a `#{}` interpolation in a value', '.a { width: #{y}; }'],
    ['a Less `.mixin()` call', '.a { .mixin(); }'],
    ['a SCSS `%placeholder` selector', '%btn { color: red }']
  ];

  for (const [name, src] of enforcedRejects) {
    it(`CSS rejects ${name}`, () => {
      expect(hasParseError(src), `expected CSS to reject: ${src}`).toBe(true);
    });
  }

  // By-design / valid-CSS accepts, pinned so future flips are deliberate.
  const accepts: Array<[string, string]> = [
    ['an unknown at-rule `@x: 1;` (permissive)', '@x: 1;'],
    ['native CSS nesting with `&`', '.a { &:hover { color: red } }']
  ];

  for (const [name, src] of accepts) {
    it(`[by-design] CSS accepts ${name}`, () => {
      expect(hasParseError(src), `expected CSS to accept: ${src}`).toBe(false);
    });
  }
});
