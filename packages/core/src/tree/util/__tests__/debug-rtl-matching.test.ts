import { el, sel, sellist, compound, is, co } from '../../..';
import { matchSelectors } from '../selector';

describe('Debug right-to-left matching', () => {
  it('should trace through the right-to-left matching step by step', () => {
    const targetSelector = sel([compound([el('.b'), el('.c')]), co('>'), compound([el('.d'), el('.e')])]);
    const findSelector = sel([compound([el('.c'), el('.b')]), co('>'), compound([el('.e'), el('.d')])]);

    console.log('=== Right-to-left matching trace ===');
    console.log('Target (.b.c>.d.e):', targetSelector.valueOf());
    console.log('Find (.c.b>.e.d):', findSelector.valueOf());

    // Let me manually test the components that should be compared
    console.log('\n=== Manual component comparisons ===');

    // Component 2 (rightmost): .d.e vs .e.d
    const targetComp2 = compound([el('.d'), el('.e')]);
    const findComp2 = compound([el('.e'), el('.d')]);
    const match2 = matchSelectors(targetComp2, findComp2, false);
    console.log('Component 2: .d.e vs .e.d =', match2.hasFullMatch);

    // Component 1 (middle): > vs >
    console.log('Component 1: > vs > = true (should be exact match)');

    // Component 0 (leftmost): .b.c vs .c.b
    const targetComp0 = compound([el('.b'), el('.c')]);
    const findComp0 = compound([el('.c'), el('.b')]);
    const match0 = matchSelectors(targetComp0, findComp0, false);
    console.log('Component 0: .b.c vs .c.b =', match0.hasFullMatch);

    // Now test the full matching
    console.log('\n=== Full complex matching ===');
    const fullMatch = matchSelectors(targetSelector, findSelector, true);
    console.log('Full match result:', {
      hasMatch: fullMatch.hasMatch,
      hasFullMatch: fullMatch.hasFullMatch,
      hasPartialMatch: fullMatch.hasPartialMatch,
      matched: fullMatch.matched.map(m => m.valueOf()),
      remainders: fullMatch.remainders.map(r => r.valueOf())
    });
  });
});
