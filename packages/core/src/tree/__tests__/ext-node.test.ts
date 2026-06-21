import {
  el, extend, ruleset, rules,
  type Ruleset
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
        selector: extend({
          selector: el('.b'),
          target: el('.a')
        }),
        rules: []
      })
    ]);
    let evald = await rule.eval(context);
    let firstRuleset = evald.rules[0]! as Ruleset;
    expect(`${firstRuleset.selector}`).toBe('.a,\n.b');
  });
});