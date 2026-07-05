import {
  el, extend, ruleset, rules,
  type Ruleset,
  type Selector
} from '../index.js';
import { Context } from '../../context.js';

let context: Context;
describe.skip('Extend', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should extend a simple selector', async () => {
    let rule = rules([
      ruleset({
        selector: el('.a'),
        rules: []
      }),
      ruleset({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        selector: extend({
          selector: el('.b'),
          target: el('.a')
        }) as unknown as Selector,
        rules: []
      })
    ]);
    let evald = await rule.eval(context);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    let firstRuleset = evald.rules[0]! as Ruleset;
    expect(`${firstRuleset.selector}`).toBe('.a,\n.b');
  });
});