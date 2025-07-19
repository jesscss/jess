import { el, sel, sellist, compound, is, co } from '../../..';
import { matchSelectors } from '../selector';

describe('Debug Test 6 compound matching', () => {
  it('should debug why compound selectors are not matching', () => {
    console.log('=== Debug compound selector matching ===');

    // Individual compounds that should match
    const compound1 = compound([el('.b'), el('.c')]);  // .b.c
    const compound2 = compound([el('.c'), el('.b')]);  // .c.b

    console.log('Compound1 (.b.c):', compound1.valueOf());
    console.log('Compound2 (.c.b):', compound2.valueOf());

    const match1 = matchSelectors(compound1, compound2, true);
    console.log('Match compound1 vs compound2:', match1.hasMatch);

    const match2 = matchSelectors(compound2, compound1, true);
    console.log('Match compound2 vs compound1:', match2.hasMatch);

    // Now test substring matching
    console.log('\n=== Test subsequence matching ===');

    // Test if .b.c>.d.e matches .c.b>.e.d
    const subSelector = sel([compound([el('.b'), el('.c')]), co('>'), compound([el('.d'), el('.e')])]);
    const target = sel([compound([el('.c'), el('.b')]), co('>'), compound([el('.e'), el('.d')])]);

    console.log('Sub selector (.b.c>.d.e):', subSelector.valueOf());
    console.log('Target (.c.b>.e.d):', target.valueOf());

    const subMatch = matchSelectors(subSelector, target, true);
    console.log('Sub match result:', subMatch.hasMatch, subMatch.hasPartialMatch, subMatch.hasFullMatch);

    // Now test the full complex selectors
    const selector = sel([
      el('.a'),
      co('>'),
      compound([el('.b'), el('.c')]),
      co('>'),
      compound([el('.d'), el('.e')])
    ]);

    console.log('\nFull selector:', selector.valueOf());
    console.log('Full target:', target.valueOf());

    const fullMatch = matchSelectors(selector, target, true);
    console.log('Full match result:', fullMatch.hasMatch, fullMatch.hasPartialMatch, fullMatch.hasFullMatch);
    if (fullMatch.hasMatch) {
      console.log('Matched:', fullMatch.matched.map(m => m.valueOf()));
      console.log('Remainders:', fullMatch.remainders.map(r => r.valueOf()));
    }
  });
});
