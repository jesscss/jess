import { describe, it, expect, beforeEach } from 'vitest';
import { quoted, ref, rules, vardecl, any, Rules as RulesClass } from '../index.js';
import { Context } from '../../context.js';

describe('quoted', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders quoted syntax through toTrimmedString()', () => {
    expect(quoted('hello').toTrimmedString()).toBe('"hello"');
  });

  it('does not allocate options when rendering quoted syntax with defaults', () => {
    const rule = quoted('hello');

    expect(rule.toTrimmedString()).toBe('"hello"');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('does not allocate options when comparing default quoted values', () => {
    const left = quoted('hello');
    const right = quoted('hello');

    expect(left.compare(right)).toBe(0);
    expect(Object.getOwnPropertyDescriptor(left, '_options')?.value).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(right, '_options')?.value).toBeUndefined();
  });

  it('renders a resolved quoted value through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('message'),
        value: any('hello')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = quoted(ref({ key: 'message' }, { type: 'variable' })).render(context);

    expect(rendered).toBe('"hello"');
  });

  it('resolves quoted values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('message'),
        value: any('hello')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await quoted(ref({ key: 'message' }, { type: 'variable' })).resolve(context);

    expect(`${resolved}`).toBe('"hello"');
    expect(context.printState.writer).toBeUndefined();
  });
});
