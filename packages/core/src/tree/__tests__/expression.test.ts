import { expr, any, list, ref, rules, vardecl, type Rules as RulesClass } from '../index.js';
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

    const renderedNode = expr(ref({ key: 'value' }, { type: 'variable' }));
    const rendered = renderedNode.render(context);

    expect(rendered).toBe('foo');
    expect(renderedNode.evaluated).toBe(false);
    expect(renderedNode.preEvaluated).toBe(false);
  });

  it('resolves expression values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const nodeToResolve = expr(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await nodeToResolve.resolve(context);

    expect(`${resolved}`).toBe('foo');
    expect(nodeToResolve.evaluated).toBe(false);
    expect(nodeToResolve.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source expression child containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const nodeToResolve = expr(list([
      any('one'),
      ref({ key: 'value' }, { type: 'variable' })
    ]));
    const resolved = await nodeToResolve.resolve(context);

    expect(`${resolved}`).toBe('one, foo');
    expect(nodeToResolve.toTrimmedString()).toBe('$(one, $value)');
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
