import { isNode } from '../is-node.js';
import { N } from '../../node-type.js';
import { el, sel, compound, co, sellist, pseudo } from '../../index.js';

describe('is-node', () => {
  test('is a basic selector (bitmask)', () => {
    let node = el('.foo');
    expect(isNode(node, N.BasicSelector)).toBe(true);
    /** Test the abstract parent mask */
    expect(isNode(node, N.SimpleSelector)).toBe(true);
    expect(isNode(node, N.Selector)).toBe(true);
    /** Negative checks */
    expect(isNode(node, N.PseudoSelector)).toBe(false);
    expect(isNode(node, N.CompoundSelector)).toBe(false);
    expect(isNode(node, N.Combinator)).toBe(false);
  });

  test('compound selector', () => {
    let node = compound([el('.foo'), el('.bar')]);
    expect(isNode(node, N.CompoundSelector)).toBe(true);
    expect(isNode(node, N.Selector)).toBe(true);
    expect(isNode(node, N.BasicSelector)).toBe(false);
    expect(isNode(node, N.SimpleSelector)).toBe(false);
  });

  test('complex selector', () => {
    let node = sel([el('.foo'), co('>'), el('.bar')]);
    expect(isNode(node, N.ComplexSelector)).toBe(true);
    expect(isNode(node, N.Selector)).toBe(true);
    expect(isNode(node, N.CompoundSelector)).toBe(false);
  });

  test('combinator', () => {
    let node = co('>');
    expect(isNode(node, N.Combinator)).toBe(true);
    expect(isNode(node, N.Selector)).toBe(true);
    expect(isNode(node, N.BasicSelector)).toBe(false);
  });

  test('selector list', () => {
    let node = sellist([el('.a'), el('.b')]);
    expect(isNode(node, N.SelectorList)).toBe(true);
    expect(isNode(node, N.Selector)).toBe(true);
    expect(isNode(node, N.ComplexSelector)).toBe(false);
  });

  test('bitwise OR mask matches any included type', () => {
    let basic = el('.foo');
    let combinator = co('>');
    let mask = N.BasicSelector | N.Combinator;
    expect(isNode(basic, mask)).toBe(true);
    expect(isNode(combinator, mask)).toBe(true);
    expect(isNode(compound([el('.a'), el('.b')]), mask)).toBe(false);
  });

  test('isNode with no type arg is a type guard for Node', () => {
    expect(isNode(el('.foo'))).toBe(true);
    expect(isNode(null)).toBe(false);
    expect(isNode(undefined)).toBe(false);
    expect(isNode('string')).toBe(false);
    expect(isNode(42)).toBe(false);
  });
});
