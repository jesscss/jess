import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * The IE `name=value` filter argument (`filter: alpha(opacity=50)`) is removed
 * from Less v5 (ledger V11). `alpha` is interpreted like every other CSS
 * function, so its output is whatever the same call to any other name gives.
 */
const render = async (source: string): Promise<string> =>
  await new Compiler({ output: { collapseNesting: true } }).renderString(
    source,
    { language: 'less', filePath: '/virtual/alpha.less' }
  );

const value = async (source: string): Promise<string> => {
  const css = await render(`@v: 50; .x { a: ${source}; }`);
  return css.slice('.x {\n  a: '.length, -';\n}\n'.length);
};

describe('Less `alpha()` with a `name=value` argument', () => {
  it('renders exactly like the same call to any other function', async () => {
    for (const args of ['x=1', 'opacity=50', 'opacity = 50', 'opacity=@v', 'opacity=(1 + 2)', 'x=url(a.png)', 'a=1, b=2']) {
      expect(await value(`alpha(${args})`)).toBe((await value(`foo(${args})`)).replace(/^foo/, 'alpha'));
    }
  });

  it('keeps real comparisons evaluating', async () => {
    expect(await value('boolean(3 = 4)')).toBe('false');
    expect(await value('boolean(@v = 50)')).toBe('true');
    expect(await value('if((@v = 50), yes, no)')).toBe('yes');
    expect(await value('foo(@v = 50)')).toBe('foo(true)');
    expect(await value('foo(url(a.png) = url(a.png))')).toBe('foo(true)');
  });
});

/*
 * A chained `=` (P45, ledger N18) is not one comparison, and Less gives a chain
 * no meaning: the argument is the CSS run of component values, written as
 * authored, whatever the function is called.
 */
describe('a chained comparison argument', () => {
  it.each(['alpha(a=b=c)', 'foo(1 = 2 = 3)'])('%s is written as authored', async (call) => {
    expect(await value(call)).toBe(call);
  });
});
