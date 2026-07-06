/**
 * Corpus 11 — `$apply` (selectors as mixins).
 *
 *   $apply .rounded;          apply one ruleset as a mixin
 *   $apply .rounded, .shadow; apply several (comma list)
 *
 * `$apply <selector-list>` calls rulesets as mixins. The surface is ALWAYS
 * `$apply <list>` (space after `$apply`) — the `$|…` shorthand is INVALID and not
 * accepted (user-adjudicated). Each listed selector lowers to a mixin CALL of the
 * shape `$ > *[.sel]()` (`$apply .foo` ≈ `$ > *[.foo]`): a `Call` whose name is a
 * base-less `type:'mixin'` Reference keyed by a `SelectorCapture` of that selector.
 * A single selector → the lone Call; a comma list → a List of Calls.
 */
import { describe, it } from 'vitest';
import { expectAstContains, expectRoundTrip } from './_util.js';

describe('corpus/apply', () => {
  it('`$apply .rounded;` → a `$ > *[.rounded]()` mixin Call', () => {
    expectAstContains('.card { $apply .rounded; }', `
      (Call
        name:
          (Reference
            target:
              (Reference
                key: ''
              )
            key:
              (SelectorCapture
                selector:
                  (BasicSelector '.rounded')
              )
          )
        args:
          (List
            value:
              []
          )
      )`);
  });

  it('single `$apply` round-trips to the lowered `$ > *[.rounded]()`', () => {
    expectRoundTrip('.card { $apply .rounded; }', '$ > *[.rounded]()');
  });

  it('comma list → one Call per selector, wrapped in a List', () => {
    expectAstContains('.card { $apply .rounded, .shadow; }', `
      (List
        value:
          [
            (Call
              name:
                (Reference
                  target:
                    (Reference
                      key: ''
                    )
                  key:
                    (SelectorCapture
                      selector:
                        (BasicSelector '.rounded')
                    )
                )
              args:
                (List
                  value:
                    []
                )
            )
            (Call
              name:
                (Reference
                  target:
                    (Reference
                      key: ''
                    )
                  key:
                    (SelectorCapture
                      selector:
                        (BasicSelector '.shadow')
                    )
                )
              args:
                (List
                  value:
                    []
                )
            )
          ]
      )`);
  });
});
