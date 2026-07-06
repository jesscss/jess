/**
 * Corpus 11 — `$apply` (selectors as mixins).
 *
 *   $apply .rounded;          apply one ruleset as a mixin
 *   $apply .rounded, .shadow; apply several (comma list)
 *
 * `$apply <selector-list>` calls rulesets as mixins. The surface is ALWAYS
 * `$apply <list>` (space after `$apply`) — the `$|…` shorthand is INVALID and not
 * accepted (user-adjudicated). `$apply` stays FIRST-CLASS in the AST: it builds a
 * single dedicated `Apply` core node holding the applied-selector list (each target
 * coerced to a real Selector node, e.g. a lone `.rounded` → `BasicSelector`). One
 * selector and a comma list are both just an `Apply` with 1 or N selectors; it
 * round-trips structurally (`$apply .rounded, .shadow;`).
 *
 * (Eval-time expansion into the applied rules is TBD — the Apply node is
 * structural / parse-only for now; see NOTES.)
 */
import { describe, it } from 'vitest';
import { expectAstContains, expectRoundTrip } from './_util.js';

describe('corpus/apply', () => {
  it('`$apply .rounded;` → an Apply node with one selector', () => {
    expectAstContains('.card { $apply .rounded; }', `
      (Apply
        selectors:
          [
            (BasicSelector '.rounded')
          ]
      )`);
  });

  it('single `$apply` round-trips to `$apply .rounded;`', () => {
    expectRoundTrip('.card { $apply .rounded; }', '$apply .rounded;');
  });

  it('comma list → one Apply node holding all selectors', () => {
    expectAstContains('.card { $apply .rounded, .shadow; }', `
      (Apply
        selectors:
          [
            (BasicSelector '.rounded')
            (BasicSelector '.shadow')
          ]
      )`);
  });

  it('comma list round-trips to `$apply .rounded, .shadow;`', () => {
    expectRoundTrip('.card { $apply .rounded, .shadow; }', '$apply .rounded, .shadow;');
  });
});
