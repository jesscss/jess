import { attr, any, quoted } from '..';
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
});