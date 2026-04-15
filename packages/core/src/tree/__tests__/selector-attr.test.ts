import { attr, any, quoted, mixin, rules, ruleset, decl, call, ref, list, el, vardecl } from '../index.js';
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

  test('keeps interpolated attribute selector values isolated across repeated mixin calls', async () => {
    context = new Context({
      collapseNesting: true,
      leakyRules: true
    });

    const node = rules([
      mixin({
        name: any('.emit'),
        params: list([any('name', { role: 'property' })]),
        rules: rules([
          vardecl({
            name: 'attr-data',
            value: ref({ key: 'name' }, { type: 'variable' })
          }),
          ruleset({
            selector: attr({
              name: 'data',
              op: '=',
              value: any('@{attr-data}')
            }),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.one'),
        rules: rules([
          call({
            name: ref({ key: '.emit' }, { type: 'mixin' }),
            args: list([any('foo')])
          })
        ])
      }),
      ruleset({
        selector: el('.two'),
        rules: rules([
          call({
            name: ref({ key: '.emit' }, { type: 'mixin' }),
            args: list([any('bar')])
          })
        ])
      })
    ]);
    context.root = node;

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toContain('.one [data="foo"]');
    expect(css).toContain('.two [data="bar"]');
    expect(css).not.toContain('.one [data="bar"]');
    expect(css).not.toContain('.two [data="foo"]');
  });
});
