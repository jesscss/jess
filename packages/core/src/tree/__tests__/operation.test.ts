import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, call, Call, decl, dimension, List, list, num, op, Operation, paren, ref, rules, Rules, ruleset, vardecl } from '../index.js';
import { OutputWriter, getPrintOptions } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

class WholeBufferCountingWriter extends OutputWriter {
  wholeBufferReads = 0;
  readbacks = 0;

  override getSince(mark: number): string {
    this.readbacks++;
    if (mark === 0) {
      this.wholeBufferReads++;
    }
    return super.getSince(mark);
  }
}

async function setEvaluatedRoot(context: Context, node: Rules): Promise<Rules> {
  const evald = await node.eval(context);
  expect(evald).toBeInstanceOf(Rules);
  if (!(evald instanceof Rules)) {
    throw new Error('Expected Rules result');
  }
  context.root = evald;
  context.rulesContext = evald;
  return evald;
}

describe('Operation', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders operation syntax through toTrimmedString()', () => {
    const rule = op([num(10), '+', num(20)]);

    expect(rule.toTrimmedString()).toBe('10 + 20');
  });

  it('streams operation operands without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = op([num(10), '+', num(20)]);

    expect(rule.toTrimmedString({ writer })).toBe('10 + 20');
    expect(writer.captures).toBe(0);
  });

  it('writes operation operands without public toString transport', () => {
    const left = any('10');
    const right = any('20');
    let stringCalls = 0;
    left.toString = right.toString = () => {
      stringCalls++;
      return '';
    };

    expect(op([left, '+', right]).toTrimmedString()).toBe('10 + 20');
    expect(stringCalls).toBe(0);
  });

  it('captures operation source syntax without outer whole-buffer readback', () => {
    const writer = new WholeBufferCountingWriter();
    const rule = op([num(10), '+', ref({ key: 'rhs' }, { type: 'variable' })]);

    expect(rule.toTrimmedString({ writer })).toBe('10 + $rhs');
    expect(writer.wholeBufferReads).toBe(1);
  });

  it('writes operation syntax without public string readback', () => {
    const writer = new CountingWriter();
    const rule = op([num(10), '+', num(20)]);

    rule.writeSyntax(getPrintOptions({ writer }));

    expect(writer.toString()).toBe('10 + 20');
    expect(writer.marks).toBe(1);
    expect(writer.reads).toBe(0);
    expect(writer.captures).toBe(0);
  });

  it('renders resolved operation values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const operationNode = op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]);
    const rendered = operationNode.render(context);

    expect(rendered).toBe('30');
    expect(operationNode.registrationPrepared).toBe(false);
  });

  it('writes resolved operation render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const buffer = createRenderBuffer('flat');
    const operationNode = op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]);
    let operationResolveCalls = 0;
    operationNode.resolve = (renderContext: Context) => {
      operationResolveCalls++;
      return operationNode.evalNode(renderContext);
    };

    expect(await operationNode.render(context, buffer)).toBe('30');
    expect(buffer.parts).toEqual(['30']);
    expect(operationResolveCalls).toBe(0);
    expect(operationNode.registrationPrepared).toBe(false);
  });

  it('renders resolved operation values directly without public resolve', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const operationNode = op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]);
    operationNode.resolve = () => {
      throw new Error('Operation direct render should evaluate operands natively');
    };

    expect(operationNode.render(context)).toBe('30');
    expect(operationNode.registrationPrepared).toBe(false);
  });

  it('renders unresolved operation syntax without materializing replacement operands', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    await setEvaluatedRoot(context, node);
    const descriptor = Object.getOwnPropertyDescriptor(Operation.prototype, 'withOperands');
    if (!descriptor) {
      throw new Error('Expected Operation.withOperands for render materialization proof');
    }
    const renderedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    Object.defineProperty(Operation.prototype, 'withOperands', {
      ...descriptor,
      value: () => {
        throw new Error('Operation render should stream evaluated operands without a replacement operation');
      }
    });
    try {
      expect(renderedOperation.render(context)).toBe('10px / 2 * 2');
    } finally {
      Object.defineProperty(Operation.prototype, 'withOperands', descriptor);
    }
  });

  it('keeps preserved operation buffer output out of explicit writers', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    await setEvaluatedRoot(context, node);
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');
    const operationNode = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    expect(await Promise.resolve(operationNode.render(context, buffer, { writer }))).toBe('10px / 2 * 2');
    expect(buffer.parts).toEqual(['10px / 2 * 2']);
    expect(writer.toString()).toBe('');
    expect(writer.marks).toBe(0);
  });

  it('writes preserved operation render output to explicit writers once', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    await setEvaluatedRoot(context, node);
    const writer = new CountingWriter();
    const operationNode = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    expect(await Promise.resolve(operationNode.render(context, { writer }))).toBe('10px / 2 * 2');
    expect(writer.toString()).toBe('10px / 2 * 2');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('resolves operation values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const operationNode = op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]);
    const resolved = await operationNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('30');
    expect(operationNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source operation child containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('foo')
      })
    ]);
    const evald = await setEvaluatedRoot(context, node);

    const operationNode = op([
      list([
        any('one'),
        ref({ key: 'item' }, { type: 'variable' })
      ]),
      '+',
      any('two')
    ]);
    const leftOperand = operationNode.left;
    const rightOperand = operationNode.right;
    const resolved = await operationNode.resolve(context);

    expect(resolved.render(context)).toBe('one, foo, two');
    expect(operationNode.toTrimmedString()).toBe('one, $item + two');
    expect(leftOperand.parent).toBe(operationNode);
    expect(rightOperand.parent).toBe(operationNode);
  });

  it('preserves slash-list operands instead of forcing math on outer operations', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    const evald = await setEvaluatedRoot(context, node);

    const renderedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    expect(renderedOperation.render(context)).toBe('10px / 2 * 2');

    const resolveContext = new Context();
    resolveContext.root = evald;
    resolveContext.rulesContext = evald;
    const resolvedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);
    const leftOperand = resolvedOperation.left;
    const rightOperand = resolvedOperation.right;

    const resolved = await resolvedOperation.resolve(resolveContext);
    expect(resolveContext.printState.writer).toBeUndefined();
    expect(resolved.type).toBe('Operation');
    expect(resolved.toTrimmedString()).toBe('10px / 2 * 2');
    expect(leftOperand.parent).toBe(resolvedOperation);
    expect(rightOperand.parent).toBe(resolvedOperation);
  });

  it('owns unchanged source operands when materializing preserved operations', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    const evald = await setEvaluatedRoot(context, node);
    const leftOperand = dimension([2, 'em']);
    const operationNode = op([
      leftOperand,
      '*',
      ref({ key: 'div-op' }, { type: 'variable' })
    ]);

    const resolved = await operationNode.resolve(context);

    expect(resolved).toBeInstanceOf(Operation);
    if (!(resolved instanceof Operation)) {
      throw new Error('Expected Operation result');
    }
    expect(resolved.toTrimmedString()).toBe('2em * 10px / 2');
    expect(resolved.left).not.toBe(leftOperand);
    expect(resolved.left?.toTrimmedString()).toBe('2em');
    expect(leftOperand.parent).toBe(operationNode);
    expect(operationNode.parent).toBeUndefined();
    expect(evald.parent).toBeUndefined();
  });

  it('owns unchanged source operands when materializing calc fallback operations', async () => {
    const leftOperand = dimension([10, 'px']);
    const rightOperand = dimension([0, 'px']);
    const operationNode = op([
      leftOperand,
      '/',
      rightOperand
    ]);
    const renderOperation = op([
      dimension([10, 'px']),
      '/',
      dimension([0, 'px'])
    ]);

    const fallbackContext = new Context();
    fallbackContext.opts.mathMode = 'always';
    expect(fallbackContext.opts.unitMode ?? 'preserve').toBe('preserve');

    const resolved = await operationNode.resolve(fallbackContext);

    expect(renderOperation.render(fallbackContext)).toBe('calc(10px / 0px)');
    expect(resolved.toTrimmedString()).toBe('calc(10px / 0px)');
    expect(resolved.render(fallbackContext)).toBe('calc(10px / 0px)');
    expect(resolved).toBeInstanceOf(Call);
    if (!(resolved instanceof Call)) {
      throw new Error('Expected calc fallback Call result');
    }
    expect(resolved.args).toBeInstanceOf(List);
    const calcArg = resolved.args!.value[0];
    expect(calcArg).toBeInstanceOf(Operation);
    if (!(calcArg instanceof Operation)) {
      throw new Error('Expected calc fallback Operation argument');
    }
    expect(calcArg).not.toBe(operationNode);
    expect(calcArg.left).not.toBe(leftOperand);
    expect(calcArg.right).not.toBe(rightOperand);
    // Source operands stay owned by the canonical operation, unchanged — the
    // calc fallback materializes copies. (`evaluated` flag assertions removed:
    // it is being deleted as a clone-era relic; see LIVE_BINDING §2.7.)
    expect(leftOperand.parent).toBe(operationNode);
    expect(rightOperand.parent).toBe(operationNode);
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
    await setEvaluatedRoot(context, node);

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
        selector: '.probe',
        rules: [
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
        ]
      })
    ]);

    const css = await renderNodeToString(root, context, { context });

    expect(css).toContain('.probe {');
    expect(css).toContain('margin: 20px;');
    expect(css).toContain('min-height: 15vh;');
    expect(css).toContain('root: calc(100% - 30px);');
    expect(css).toContain('height: calc(50% + (25vh - 20px));');
  });
});
