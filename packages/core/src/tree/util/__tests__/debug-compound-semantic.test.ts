import { el, sel, sellist, compound, is, co } from '../../..';
import { matchSelectors } from '../selector';

describe('Debug compound semantic matching', () => {
  it('should test compound semantic matching specifically', () => {
    const compound1 = compound([el('.d'), el('.e')]);  // .d.e
    const compound2 = compound([el('.e'), el('.d')]);  // .e.d

    console.log('=== Compound Semantic Matching ===');
    console.log('Compound1 (.d.e):', compound1.valueOf());
    console.log('Compound2 (.e.d):', compound2.valueOf());

    const result1 = matchSelectors(compound1, compound2, false);
    console.log('Match compound1 vs compound2 (full):', result1.hasFullMatch);

    const result2 = matchSelectors(compound2, compound1, false);
    console.log('Match compound2 vs compound1 (full):', result2.hasFullMatch);

    // And test the individual elements
    console.log('\n=== Individual elements ===');
    const result3 = matchSelectors(el('.d'), el('.d'), false);
    console.log('Match .d vs .d:', result3.hasFullMatch);

    const result4 = matchSelectors(el('.e'), el('.e'), false);
    console.log('Match .e vs .e:', result4.hasFullMatch);
  });
});
