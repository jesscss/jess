import { el, compound, is, sellist } from '../../index.js';
import type { Selector } from '../../index.js';
import { extendSelector } from '../extend.js';

describe('Extend selector trivia independence', () => {
  it('extends compound selectors without node-owned pre/post trivia', () => {
    const selector = compound([el('.a'), el('.b')]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const result = extendSelector(selector, el('.b'), el('.c'), true) as Selector;

    expect(result.toTrimmedString()).toBe('.a:is(.b, .c)');
  });

  it('extends existing :is() selectors without node-owned pre/post trivia', () => {
    const selector = is(sellist([el('.inner'), el('.other')]));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const result = extendSelector(selector, el('.inner'), el('.extended'), false) as Selector;
    const out = result.toTrimmedString();

    expect(out).toContain(':is(');
    expect(out).toContain('.inner');
    expect(out).toContain('.other');
    expect(out).toContain('.extended');
  });
});
