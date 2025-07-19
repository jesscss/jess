import { el, sel, sellist, compound, is, co } from '../../..';
import { extendSelector } from '../extend';
import { matchSelectors } from '../selector';

describe('Debug Test 6 and 7', () => {
  it('should debug Test 6 - complex partial match with compound boundaries', () => {
    // Test 6: Selector: .a > .b.c > .d.e, Target: .c.b > .e.d (partial), Extend with: .f
    // Expected: .a > .b.c > .d.e, .a > .f
    // Error: No match found for target selector
    const selector = sel([
      el('.a'),
      co('>'),
      compound([el('.b'), el('.c')]),
      co('>'),
      compound([el('.d'), el('.e')])
    ]);
    const target = sel([compound([el('.c'), el('.b')]), co('>'), compound([el('.e'), el('.d')])]);
    const extendWith = el('.f');

    console.log('=== Debug Test 6 ===');
    console.log('Selector:', selector.valueOf());
    console.log('Target:', target.valueOf());
    console.log('ExtendWith:', extendWith.valueOf());

    // Test the matching first
    const matchResult = matchSelectors(selector, target, true); // true = partial match
    console.log('Match result hasMatch:', matchResult.hasMatch);
    console.log('Match result hasFullMatch:', matchResult.hasFullMatch);
    console.log('Match result hasPartialMatch:', matchResult.hasPartialMatch);

    if (matchResult.hasMatch) {
      console.log('Matched selectors:', matchResult.matched.map(m => m.valueOf()));
      console.log('Remainders:', matchResult.remainders.map(r => r.valueOf()));

      const result = extendSelector(selector, target, extendWith, true);
      console.log('Result:', result.valueOf());
      console.log('Result type:', result.constructor.name);
      console.log('Expected: .a>.b.c>.d.e,.a>.f');
    } else {
      console.log('No match found - this is the issue!');
    }
  });

  it('should debug Test 7 - missing context issue', () => {
    // Test 7: Selector: .a > .b, Target: .b (partial), Extend with: .d > .e
    // Expected: .a>:is(.b,.d>.e)
    // Actual: :is(.b,.d>.e)
    const selector = sel([el('.a'), co('>'), el('.b')]);
    const target = el('.b');
    const extendWith = sel([el('.d'), co('>'), el('.e')]);

    console.log('=== Debug Test 7 ===');
    console.log('Selector:', selector.valueOf());
    console.log('Target:', target.valueOf());
    console.log('ExtendWith:', extendWith.valueOf());

    // Test the matching first
    const matchResult = matchSelectors(selector, target, true); // true = partial match
    console.log('Match result hasMatch:', matchResult.hasMatch);
    console.log('Match result hasFullMatch:', matchResult.hasFullMatch);
    console.log('Match result hasPartialMatch:', matchResult.hasPartialMatch);

    if (matchResult.hasMatch) {
      console.log('Matched selectors:', matchResult.matched.map(m => m.valueOf()));
      console.log('Remainders:', matchResult.remainders.map(r => r.valueOf()));
      console.log('Remainder types:', matchResult.remainders.map(r => r.constructor.name));

      const result = extendSelector(selector, target, extendWith, true);
      console.log('Result:', result.valueOf());
      console.log('Result type:', result.constructor.name);
      console.log('Expected: .a>:is(.b,.d>.e)');
    }
  });
});
