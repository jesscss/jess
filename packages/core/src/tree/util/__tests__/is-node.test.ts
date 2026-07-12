import { isNode } from '../is-node';
import { el } from '../../.';

describe('is-node', () => {
  test('is a basic selector', () => {
    let node = el('.foo');
    expect(isNode(node, 'BasicSelector')).toBe(true);
    /** Test the prototype chain */
    expect(isNode(node, 'SimpleSelector')).toBe(true);
    // @ts-expect-error - Not a valid type
    expect(isNode(node, 'Foo')).toBe(false);
  });
});