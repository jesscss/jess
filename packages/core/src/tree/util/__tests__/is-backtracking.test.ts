import { el, sel, sellist, compound, is, co } from '../../..';
import { matchSelectors } from '../selector';

describe(':is() Right-to-Left Backtracking Tests', () => {
  it('should understand the basic concept with simple example', () => {
    // Simplified test to understand the backtracking concept
    // target: :is(.a).b, find: .b (should match the .b part)
    const target = compound([is(sel([el('.a')])), el('.b')]);
    const find = el('.b');
    const result = matchSelectors(target, find);

    console.log('Simple compound + :is() test result:', result);
    // This should match because .b is in the compound
    expect(result.hasMatch).toBe(true);
  });

  it('should demonstrate right-to-left :is() backtracking concept', () => {
    // The challenging case that requires sophisticated backtracking
    // target: .x + :is(.a > .b).d > .c
    // find: .a > .b > .c

    // Right-to-left matching should work like:
    // 1. Start from right: .c matches .c ✓
    // 2. Move left: > matches > ✓
    // 3. Try compound :is(.a > .b).d against .b:
    //    - Try .d against .b (no match)
    //    - Try :is(.a > .b) against .b - need to expand and match rightmost component
    //    - The .b from :is(.a > .b) matches .b ✓
    //    - This leaves .a > unmatched in the :is() alternative
    // 4. Continue matching: > matches > ✓
    // 5. .a matches .a ✓
    // 6. But we still have .x + unmatched -> partial match

    const target = sel([
      el('.x'),
      co('+'),
      compound([is(sellist([sel([el('.a'), co('>'), el('.b')])])), el('.d')]),
      co('>'),
      el('.c')
    ]);

    const find = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);

    const result = matchSelectors(target, find, true);

    console.log('Target structure:', target.value.map(v => v.valueOf ? v.valueOf() : v));
    console.log('Find structure:', find.value.map(v => v.valueOf ? v.valueOf() : v));
    console.log('Complex backtracking test result:', result);

    // Should be a partial match because:
    // - .c matches .c
    // - .b from :is(.a > .b) matches .b
    // - .a matches .a
    // - but .x + and .d remain unmatched
    expect(result.hasMatch).toBe(true);
    expect(result.hasPartialMatch).toBe(true);
  });
});
