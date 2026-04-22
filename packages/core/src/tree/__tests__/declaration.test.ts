import { decl, spaced, color, rules, any, ref, atrule, ruleset, el, forNode, List, VarDeclaration, op, num, dimension, AssignmentType, vardecl, interpolated, call, JsFunction } from '../index.js';
import { Context } from '../../context.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';

let context: Context;
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(`${rule}`).toBe('color: #eee');
  });

  it('does not allocate options when serializing a default declaration', () => {
    const rule = decl({ name: 'color', value: color('#eee') });

    expect(rule.toTrimmedString()).toBe('color: #eee');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved declarations through render(context)', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const rendered = decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    }).render(context);

    expect(rendered).toBe('color: red');
  });

  it('resolves declarations without touching render state', async () => {
    const root = rules([
      vardecl({ name: any('tone'), value: any('red') })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const resolved = await decl({
      name: any('color'),
      value: ref({ key: 'tone' }, { type: 'variable' })
    }).resolve(context);

    expect(resolved.toTrimmedString()).toBe('color: red');
    expect(context.printState.writer).toBeUndefined();
  });

  it('renders indexed references inside custom property values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('tone'),
        value: any('red')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('--custom'),
      value: ref({ key: 'tone' }, { type: 'index' })
    });

    expect(node.toTrimmedString()).toBe('--custom:$[tone]');
    expect(node.render(context)).toBe('--custom:red');
  });

  it('renders interpolated custom property values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('tone'),
        value: any('red')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const node = decl({
      name: any('--custom'),
      value: interpolated({
        source: `prefix-${INTERPOLATION_PLACEHOLDER}`,
        replacements: [ref({ key: 'tone' }, { type: 'variable' })]
      })
    });

    expect(node.toTrimmedString()).toBe('--custom:prefix-$tone');
    expect(node.render(context)).toBe('--custom:prefix-red');
  });

  it('preserves generic calls in custom property values during render(context)', () => {
    const node = decl({
      name: any('--custom'),
      value: call({
        name: 'if',
        args: new List([
          call({ name: 'not', args: new List([any('true')]) }),
          any('5')
        ])
      })
    });

    expect(node.toTrimmedString()).toBe('--custom:if(not(true), 5)');
    expect(node.render(context)).toBe('--custom:if(not(true), 5)');
  });

  it('preserves Less-style function calls in custom property values during render(context)', () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'rgba',
      fn: () => any('rgb(0, 30, 0)')
    }));
    context.root = root;
    context.rulesContext = root;

    const node = decl({
      name: any('--custom'),
      value: call({
        name: ref('rgba', { type: 'function', fallbackValue: true }),
        args: new List([num(0), num(30), num(0), num(238)])
      }, { silentFail: true })
    });

    expect(node.render(context)).toBe(node.toTrimmedString());
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
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
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
        value: any('red')
      }, { assign: '+:' }),
      decl({
        name: any('background-color'),
        value: any('foo')
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
          value: any('red')
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo')
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

  it('does not pull a prior plain declaration into Less-style property merge chains', async () => {
    const node = rules([
      decl({
        name: any('src'),
        value: any('base')
      }),
      decl({
        name: any('src'),
        value: any('one')
      }, { assign: AssignmentType.MergeList }),
      decl({
        name: any('src'),
        value: any('two')
      }, { assign: AssignmentType.MergeSequence }),
      decl({
        name: any('src'),
        value: any('three')
      }, { assign: AssignmentType.MergeList })
    ]);

    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      src: base;
      src: one two, three;
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
              decl({ name: any('padding'), value: any('10px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('8px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('6px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: any('padding'), value: any('4px') }, { assign: AssignmentType.MergeSequence })
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
                  decl({ name: any('padding'), value: ref('value', { type: 'variable' }) }, { assign: AssignmentType.MergeSequence })
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
                  }, { assign: AssignmentType.MergeSequence })
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
