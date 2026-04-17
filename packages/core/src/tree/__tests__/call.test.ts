import { any, call, coll, decl, list, num, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

let context: Context;
describe('Call', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should serialize a CSS function', () => {
    let rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('rgb(100, 100, 100)');
  });

  it('should serialize an optional function lookup', () => {
    let rule = call({
      name: ref('rgb', { fallbackValue: true }),
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('$rgb?(100, 100, 100)');
  });

  /** @todo */
  it('should serialize a mixin call', () => {
    let rule = call({
      name: ref('my-mixin', { type: 'mixin' }),
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('$ > my-mixin(100, 100, 100)');
  });

  it('keeps detached collection calls on the collection surface', async () => {
    const root = rules([
      vardecl({ name: 'hoverColor', value: any('blue') }),
      vardecl({
        name: 'themeMap',
        value: coll([
          decl({ name: 'background-color', value: ref('hoverColor', { type: 'variable' }) })
        ])
      })
    ]);

    context.root = root;
    const evaldRoot = await root.eval(context);
    context.rulesContext = evaldRoot;

    const result = await call({ name: ref('themeMap', { type: 'variable' }) }).eval(context);
    expect(isNode(result, N.Collection)).toBe(true);
    expect(`${result}`).toContain('background-color');
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
