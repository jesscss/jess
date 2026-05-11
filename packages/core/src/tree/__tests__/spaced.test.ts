import { num, spaced } from '../index.js';
import { Context } from '../../context.js';

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

  it('resolves spaced expressions without touching render state', async () => {
    const rule = spaced([num(10), num(20), num(30)]);

    const resolved = await rule.resolve(context);

    expect(resolved.toTrimmedString()).toBe('10 20 30');
    expect(context.printState.writer).toBeUndefined();
  });
});
