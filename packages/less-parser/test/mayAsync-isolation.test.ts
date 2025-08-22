import { Parser } from '../src';
import { type Rules, type Ruleset } from '@jesscss/core';

const parser = new Parser();
const parse = parser.parse;

describe('Less mayAsync isolation (siblings do not bleed)', () => {
  test('sibling rulesets', () => {
    const { tree } = parse('.a { x: @v } .b { x: 1 }', 'stylesheet');
    const r1 = tree.at(0)!;
    const r2 = tree.at(1)!;
    expect(r1.mayAsync).toBe(true);
    expect(r2.mayAsync).toBe(false);
  });

  test('sibling at-rules', () => {
    const { tree } = parse('@media (min-width: 10px) { a { x: @v } } @media (min-width: 10px) { a { x: 1 } }', 'stylesheet');
    const a1 = tree.at(0)!;
    const a2 = tree.at(1)!;
    expect(a1.mayAsync).toBe(true);
    expect(a2.mayAsync).toBe(false);
  });

  test('sibling declarations: Paren', () => {
    const { tree } = parse('.a { p1: (@v); p2: (1) }', 'stylesheet');
    const rs = tree.at(0)! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = inner.at(0)!;
    const d2 = inner.at(1)!;
    expect(d1.mayAsync).toBe(true);
    expect(d2.mayAsync).toBe(false);
  });

  test('sibling declarations: Block', () => {
    const { tree } = parse('.a { b1: [@v]; b2: [1] }', 'stylesheet');
    const rs = tree.at(0)! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = inner.at(0)!;
    const d2 = inner.at(1)!;
    expect(d1.mayAsync).toBe(true);
    expect(d2.mayAsync).toBe(false);
  });

  test('sibling declarations: Operation', () => {
    const { tree } = parse('.a { o1: 1 + @v; o2: 1 + 2 }', 'stylesheet');
    const rs = tree.at(0)! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = inner.at(0)!;
    const d2 = inner.at(1)!;
    expect(d1.mayAsync).toBe(true);
    expect(d2.mayAsync).toBe(false);
  });

  test('sibling declarations: Negative', () => {
    const { tree } = parse('.a { n1: -@v; n2: -1 }', 'stylesheet');
    const rs = tree.at(0)! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = inner.at(0)!;
    const d2 = inner.at(1)!;
    expect(d1.mayAsync).toBe(true);
    expect(d2.mayAsync).toBe(false);
  });

  test('sibling declarations: Call', () => {
    const { tree } = parse('.a { c1: rgb(@v,1,1); c2: rgb(1,1,1) }', 'stylesheet');
    const rs = tree.at(0)! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = inner.at(0)!;
    const d2 = inner.at(1)!;
    expect(d1.mayAsync).toBe(true);
    expect(d2.mayAsync).toBe(false);
  });
});
