import { el, compound, is, sellist } from '../../index.js';
import { extendSelector } from '../extend.js';

describe('Extend selector trivia independence', () => {
  it('extends compound selectors without node-owned pre/post trivia', () => {
    const selector = compound([el('.a'), el('.b')]);
    const result = extendSelector(selector, el('.b'), el('.c'), true);

    expect(result.toTrimmedString()).toBe('.a:is(.b, .c)');
  });

  it('extends existing :is() selectors without node-owned pre/post trivia', () => {
    const selector = is(sellist([el('.inner'), el('.other')]));
    const result = extendSelector(selector, el('.inner'), el('.extended'), false);
    const out = result.toTrimmedString();

    expect(out).toContain(':is(');
    expect(out).toContain('.inner');
    expect(out).toContain('.other');
    expect(out).toContain('.extended');
  });
});
