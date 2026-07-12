import { any, ref, rules, vardecl, num, spaced } from '../index.js';
import { Context } from '../../context.js';
import { Sequence } from '../sequence.js';

let context: Context;

describe('Spaced', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should serialize a spaced expression', () => {
    let rule = spaced([num(10), num(20), num(30)]);
    expect(rule.toTrimmedString()).toBe('10 20 30');
  });

  it('renders spaced expressions through render(context)', () => {
    const rule = spaced([num(10), num(20), num(30)]);

    expect(rule.render(context)).toBe('10 20 30');
  });

  it('renders dynamic spaced expressions without materializing a replacement sequence', async () => {
    const root = await rules([
      vardecl({ name: 'size', value: any('20px') })
    ]).eval(context);
    context.root = root;
    context.rulesContext = root;
    const descriptor = Object.getOwnPropertyDescriptor(Sequence.prototype, 'withValue');
    if (!descriptor) {
      throw new Error('Expected Sequence.withValue for render materialization proof');
    }
    const rule = spaced([any('10px'), ref({ key: 'size' }, { type: 'variable' })]);

    Object.defineProperty(Sequence.prototype, 'withValue', {
      ...descriptor,
      value: () => {
        throw new Error('Sequence render should stream resolved values without a replacement sequence');
      }
    });
    try {
      expect(rule.render(context)).toBe('10px 20px');
    } finally {
      Object.defineProperty(Sequence.prototype, 'withValue', descriptor);
    }
  });

  it('resolves spaced expressions without touching render state', async () => {
    const rule = spaced([num(10), num(20), num(30)]);

    const resolved = await rule.resolve(context);

    expect(resolved.toTrimmedString()).toBe('10 20 30');
    expect(context.printState.writer).toBeUndefined();
  });
});
