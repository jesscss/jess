import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, call, decl, dimension, list, num, op, paren, ref, rules, ruleset, type Rules as RulesClass, vardecl } from '../index.js';

describe('Operation', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders operation syntax through toTrimmedString()', () => {
    const rule = op([num(10), '+', num(20)]);

    expect(rule.toTrimmedString()).toBe('10 + 20');
  });

  it('renders resolved operation values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]).render(context);

    expect(rendered).toBe('30');
  });

  it('resolves operation values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]).resolve(context);

    expect(`${resolved}`).toBe('30');
    expect(context.printState.writer).toBeUndefined();
  });

  it('preserves slash-list operands instead of forcing math on outer operations', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const renderedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    expect(renderedOperation.render(context)).toBe('10px / 2 * 2');

    const resolveContext = new Context();
    resolveContext.root = evald as RulesClass;
    resolveContext.rulesContext = evald as RulesClass;
    const resolvedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    const resolved = await resolvedOperation.resolve(resolveContext);
    expect(resolveContext.printState.writer).toBeUndefined();
    expect(resolved.type).toBe('Operation');
    expect(resolved.toTrimmedString()).toBe('10px / 2 * 2');
  });

  it('normalizes slash-list variable refs inside calc while preserving direct calc arithmetic', async () => {
    const node = rules([
      vardecl({
        name: any('val'),
        value: dimension([10, 'px'])
      }),
      vardecl({
        name: any('sum'),
        value: op([dimension([10, 'px']), '+', dimension([20, 'px'])])
      }),
      vardecl({
        name: any('offset'),
        value: paren(op([
          ref('val', { type: 'variable' }),
          '+',
          dimension([30, 'px'])
        ]))
      }),
      vardecl({
        name: any('var'),
        value: list([dimension([50, 'vh']), num(2)], { sep: '/' })
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const calcNode = call({
      name: 'calc',
      args: list([
        op([
          dimension([50, '%']),
          '+',
          paren(op([
            ref('var', { type: 'variable' }),
            '-',
            dimension([20, 'px'])
          ]))
        ])
      ])
    });
    const sumNode = call({
      name: 'calc',
      args: list([
        op([
          dimension([100, '%']),
          '-',
          ref('sum', { type: 'variable' })
        ])
      ])
    });
    const offsetNode = call({
      name: 'calc',
      args: list([
        op([
          dimension([100, '%']),
          '-',
          ref('offset', { type: 'variable' })
        ])
      ])
    });
    const resolved = await calcNode.resolve(context);
    const resolvedSum = await sumNode.resolve(context);
    const resolvedOffset = await offsetNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('calc(50% + (25vh - 20px))');
    expect(resolvedSum.toTrimmedString()).toBe('calc(100% - 30px)');
    expect(resolvedOffset.toTrimmedString()).toBe('calc(100% - 40px)');
    expect(context.printState.writer).toBeUndefined();
  });

  it('reduces calc arithmetic on the evaluated tree output path', async () => {
    const root = rules([
      vardecl({
        name: any('sum'),
        value: op([dimension([10, 'px']), '+', dimension([20, 'px'])])
      }),
      vardecl({
        name: any('var'),
        value: list([dimension([50, 'vh']), num(2)], { sep: '/' })
      }),
      ruleset({
        selector: any('.probe'),
        rules: rules([
          decl({
            name: 'margin',
            value: call({
              name: 'calc',
              args: list([op([dimension([10, 'px']), '*', num(2)])])
            })
          }),
          decl({
            name: 'min-height',
            value: call({
              name: 'calc',
              args: list([
                op([
                  paren(paren(dimension([10, 'vh']))),
                  '+',
                  call({
                    name: 'calc',
                    args: list([paren(dimension([5, 'vh']))])
                  })
                ])
              ])
            })
          }),
          decl({
            name: 'root',
            value: call({
              name: 'calc',
              args: list([
                op([
                  dimension([100, '%']),
                  '-',
                  ref('sum', { type: 'variable' })
                ])
              ])
            })
          }),
          decl({
            name: 'height',
            value: call({
              name: 'calc',
              args: list([
                op([
                  dimension([50, '%']),
                  '+',
                  paren(op([
                    ref('var', { type: 'variable' }),
                    '-',
                    dimension([20, 'px'])
                  ]))
                ])
              ])
            })
          })
        ])
      })
    ]);

    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const css = evald.toString({ context });

    expect(css).toContain('.probe {');
    expect(css).toContain('margin: 20px;');
    expect(css).toContain('min-height: 15vh;');
    expect(css).toContain('root: calc(100% - 30px);');
    expect(css).toContain('height: calc(50% + (25vh - 20px));');
  });
});
