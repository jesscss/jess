import { any, expr, pseudo } from '../index.js';
import { Context } from '../../context.js';

let context: Context;

describe('PseudoSelector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('evaluation', () => {
    it('evaluates the pseudo argument before serialization', async () => {
      const node = pseudo({
        name: ':not',
        arg: expr(any('blue'))
      });

      const evald = await node.eval(context);

      expect(evald.toTrimmedString()).toBe(':not(blue)');
    });
  });
});
