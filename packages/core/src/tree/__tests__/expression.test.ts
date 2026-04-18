import { expr, any, ref, rules, vardecl, type Rules as RulesClass } from '../index.js';
import { Context } from '../../context.js';

let context: Context;
describe('Expression', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('renders expression syntax through toTrimmedString()', () => {
    const rule = expr(any('foo'));

    expect(rule.toTrimmedString()).toBe('$(foo)');
  });

  it('renders resolved expression values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = expr(ref({ key: 'value' }, { type: 'variable' })).render(context);

    expect(rendered).toBe('foo');
  });

  it('should serialize an expression', () => {
    let rule = expr(any('foo'));
    expect(`${rule}`).toBe('$(foo)');
  });

  it('should serialize an expression consistently', () => {
    let rule = expr(any('foo'));
    expect(`${rule}`).toBe('$(foo)');
  });

  // it('should serialize to a module', () => {
  //   let rule = call({
  //     name: 'rgb',
  //     value: list([num(100), num(100), num(100)])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.call({\n  name: "rgb",\n  value: $J.list([\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    })\n  ]),\n  ref: () => rgb,\n})'
  //   )
  // })
});
