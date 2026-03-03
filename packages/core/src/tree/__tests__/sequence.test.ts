import { num, seq } from '../index.js';

/**
 * @todo - sequences need to make sure that the result could be re-parsed
 *         as distinct tokens. We should get rid of `spaced` and properly
 *         check that the result is spaced correctly.
 */
describe('Sequence', () => {
  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)]);
    expect(`${rule}`).toBe('10 20 30');
  });

  it('should respect explicit zero-space boundary markers', () => {
    const first = num(10);
    const second = num(20);
    const third = num(30);
    second.pre = 0;
    const rule = seq([first, second, third]);
    expect(`${rule}`).toBe('1020 30');
  });
});