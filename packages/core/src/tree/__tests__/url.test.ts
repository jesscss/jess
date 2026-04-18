import { describe, it, expect, beforeEach } from 'vitest';
import { url, quoted, ref, rules, vardecl, any, Rules as RulesClass } from '../index.js';
import { Context } from '../../context.js';

describe('url', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders url syntax through render()', () => {
    expect(url(quoted('image.png')).render()).toBe('url("image.png")');
  });

  it('renders a resolved url value through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = url(quoted(ref({ key: 'asset' }, { type: 'variable' }))).render(context);

    expect(rendered).toBe('url("image.png")');
  });
});
