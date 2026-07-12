import {
  el, extend, root, ruleset, rules,
  type Ruleset
} from '..';
import { Context } from '../../context';

let context: Context;
describe('Extend', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should extend a simple selector', async () => {
    let rule = root([
      ruleset({
        selector: el('.a'),
        rules: rules([])
      }),
      ruleset({
        selector: extend({
          selector: el('.b'),
          target: el('.a')
        }),
        rules: rules([])
      })
    ]);
    let evald = await rule.eval(context);
    let firstRuleset = evald.value[0]! as Ruleset;
    expect(`${firstRuleset.selector}`).toBe('.a,\n.b');
  });
});