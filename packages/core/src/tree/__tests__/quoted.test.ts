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
});
