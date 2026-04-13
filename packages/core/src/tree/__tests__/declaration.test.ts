import { decl, spaced, color, rules, any, ref, atrule, ruleset, el, forNode, List, VarDeclaration, op, num, dimension } from '..';
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

  it('preserves multiline declaration values while enforcing a minimum continuation indent', async () => {
    const node = rules([
      decl({ name: any('background'), value: any('the,\n              great,\n              wall') }),
      decl({ name: any('color'), value: any('\nwhite') }),
      decl({ name: any('background-position'), value: any('45\n-23') })
    ]);

    const evald = await node.eval(context);
    expect(evald.toString()).toBeString(`
      background: the,
                    great,
                    wall;
      color:
        white;
      background-position: 45
        -23;
    `);
  });

  it('does not re-merge sequence assignments during post-eval coalescing in nested at-rules', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('nav'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              decl({ name: any('padding'), value: any('10px') }, { assign: '&_:' as any }),
              decl({ name: any('padding'), value: any('8px') }, { assign: '&_:' as any }),
              decl({ name: any('padding'), value: any('6px') }, { assign: '&_:' as any }),
              decl({ name: any('padding'), value: any('4px') }, { assign: '&_:' as any })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      nav {
        @starting-style {
          padding: 10px 8px 6px 4px;
        }
      }
    `);
  });

  it('coalesces sequence assignments emitted through nested $for output rules', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('aside'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              forNode({
                pattern: {
                  kind: 'single',
                  value: new VarDeclaration({
                    name: any('value', { role: 'property' }),
                    value: any('_')
                  })
                },
                iterable: {
                  kind: 'node',
                  value: new List([
                    any('10px'),
                    any('20px'),
                    any('30px'),
                    any('40px')
                  ])
                },
                rules: rules([
                  decl({ name: any('padding'), value: ref('value', { type: 'variable' }) }, { assign: '&_:' as any })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      aside {
        @starting-style {
          padding: 10px 20px 30px 40px;
        }
      }
    `);
  });

  it('coalesces sequence assignments emitted through tuple-pattern each()-style loops', async () => {
    context = new Context({ collapseNesting: true, leakyRules: true });
    const node = rules([
      ruleset({
        selector: el('aside'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              forNode({
                pattern: {
                  kind: 'tuple',
                  values: [
                    new VarDeclaration({ name: any('value', { role: 'property' }), value: any('_') }),
                    new VarDeclaration({ name: any('key', { role: 'property' }), value: any('_') }),
                    new VarDeclaration({ name: any('index', { role: 'property' }), value: any('_') })
                  ]
                },
                iterable: {
                  kind: 'node',
                  value: new List([
                    num(1),
                    num(2),
                    num(3),
                    num(4)
                  ])
                },
                rules: rules([
                  decl({
                    name: any('padding'),
                    value: op([ref('value', { type: 'variable' }), '*', dimension([10, 'px'])])
                  }, { assign: '&_:' as any })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      aside {
        @starting-style {
          padding: 10px 20px 30px 40px;
        }
      }
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
