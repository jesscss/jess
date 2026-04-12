import { decl, spaced, color, rules, any, ref } from '..';
import { Context } from '../../context.js';

let context: Context;
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(`${rule}`).toBe('color: #eee');
  });

  it('serializes important declarations with one space before !important', async () => {
    const node = rules([
      decl({
        name: any('color'),
        value: any('red'),
        important: any('!important', { role: 'flag' })
      })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      color: red !important;
    `);
  });

  it('does not keep an empty leading item when += normalization has no prior declaration', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red'),
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo'),
      }, { assign: '+:' })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      background-color: red, foo;
    `);
  });

  it('resolves merged declaration lookups without duplicating or keeping empty placeholders', async () => {
    const node = rules([
      decl({
        name: any('background-color'),
        value: any('red'),
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo'),
      }, { assign: '+:' }),
      decl({
        name: any('background'),
        value: ref({ key: 'background-color' }, { type: 'declaration' })
      })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      background-color: red, foo;
      background: red, foo;
    `);
  });

  it('resolves merged declaration lookups from a nested child ruleset in source order', async () => {
    const node = rules([
      rules([
        decl({
          name: any('background-color'),
          value: any('red'),
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo'),
        }, { assign: '+:' }),
        rules([
          decl({
            name: any('background'),
            value: ref({ key: 'background-color' }, { type: 'declaration' })
          })
        ])
      ])
    ]);

    const parent = node.value[0]!;
    const child = parent.value[2]!;
    child.parent = parent;

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      background-color: red, foo;
      background: red, foo;
    `);
  });
  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
});
