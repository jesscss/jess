import { any, num, ref, rules, seq, type Rules as RulesClass, vardecl } from '../index.js';
import { Context } from '../../context.js';

/**
 * @todo - sequences need to make sure that the result could be re-parsed
 *         as distinct tokens. We should get rid of `spaced` and properly
 *         check that the result is spaced correctly.
 */
describe('Sequence', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders sequence syntax through toTrimmedString()', () => {
    const rule = seq([num(10), num(20), num(30)]);

    expect(rule.toTrimmedString()).toBe('10 20 30');
  });

  it('renders resolved sequence values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]).render(context);

    expect(rendered).toBe('10 20 30');
  });

  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)]);
    expect(`${rule}`).toBe('10 20 30');
  });

  it('should respect explicit zero-space boundary markers', () => {
    const first = num(10);
    const second = num(20);
    const third = num(30);
    second.pre = 0;
    const rule = seq([first, second, third]);
    expect(rule.toTrimmedString()).toBe('1020 30');
    expect(`${rule}`).toBe('1020 30');
  });
});
