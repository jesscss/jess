import { attr, any, expr, interpolated, quoted } from '../index.js';
import { Context } from '../../context.js';

let context: Context;

describe('Attribute Selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('normalization', () => {
    test('with or without quotes', () => {
      let rule1 = attr({
        name: 'foo',
        op: '=',
        value: any('bar')
      });

      expect(rule1.toString()).toBe('[foo=bar]');

      let quote = quoted('bar');
      quote.pre = 1;
      let rule2 = attr({
        name: 'FOO',
        op: '=',
        value: quote
      });

      expect(rule2.toString()).toBe('[FOO= "bar"]');
      expect(rule1.valueOf()).toBe(rule2.valueOf());
    });
  });

  describe('evaluation', () => {
    test('evaluates node-backed name and value before serialization', async () => {
      const rule = attr({
        name: interpolated({
          source: 'data-%%',
          replacements: [any('theme')]
        }),
        op: '=',
        value: expr(any('dark'))
      });

      const evald = await rule.eval(context);

      expect(evald.toTrimmedString({ context })).toBe('[data-theme=dark]');
    });
  });
});
