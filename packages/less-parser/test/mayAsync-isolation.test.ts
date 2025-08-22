import { parse, expectMayAsync, expectStatic, getNestedNode } from './helpers';
import { type Rules, type Ruleset } from '@jesscss/core';

describe('Less mayAsync isolation (siblings do not bleed)', () => {
  test('sibling rulesets', () => {
    const { tree } = parse('.a { x: @v } .b { x: 1 }');
    const r1 = (tree as any).value[0]!;
    const r2 = (tree as any).value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling at-rules', () => {
    const { tree } = parse('@media (min-width: 10px) { a { x: @v } } @media (min-width: 10px) { a { x: 1 } }');
    const a1 = (tree as any).value[0]!;
    const a2 = (tree as any).value[1]!;
    expectMayAsync(a1);
    expectStatic(a2);
  });

  test('sibling declarations: Paren', () => {
    const { tree } = parse('.a { p1: (@v); p2: (1) }');
    const rs = (tree as any).value[0]! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = (inner as any).value[0]!;
    const d2 = (inner as any).value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling declarations: Block', () => {
    const { tree } = parse('.a { b1: [@v]; b2: [1] }');
    const rs = (tree as any).value[0]! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = (inner as any).value[0]!;
    const d2 = (inner as any).value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling declarations: Operation', () => {
    const { tree } = parse('.a { o1: 1 + @v; o2: 1 + 2 }');
    const rs = (tree as any).value[0]! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = (inner as any).value[0]!;
    const d2 = (inner as any).value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling declarations: Negative', () => {
    const { tree } = parse('.a { n1: -@v; n2: -1 }');
    const rs = (tree as any).value[0]! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = (inner as any).value[0]!;
    const d2 = (inner as any).value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling declarations: Call', () => {
    const { tree } = parse('.a { c1: rgb(@v,1,1); c2: rgb(1,1,1) }');
    const rs = (tree as any).value[0]! as Ruleset;
    const inner = rs.value.rules as Rules;
    const d1 = (inner as any).value[0]!;
    const d2 = (inner as any).value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling rulesets: pseudo selector with selector-child', () => {
    const { tree } = parse('.a:has(.@{x}) { y: 1 } .b:has(.c) { y: 1 }');
    const r1 = (tree as any).value[0]!;
    const r2 = (tree as any).value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling rulesets: compound selector', () => {
    const { tree } = parse('.foo.@{c} { y: 1 } .bar.baz { y: 1 }');
    const r1 = (tree as any).value[0]!;
    const r2 = (tree as any).value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling rulesets: complex selector', () => {
    const { tree } = parse('.x .@{c} .y { z: 1 } .x .c .y { z: 1 }');
    const r1 = (tree as any).value[0]!;
    const r2 = (tree as any).value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling rulesets: selector list', () => {
    const { tree } = parse('.a, .@{c} { y: 1 } .a, .c { y: 1 }');
    const r1 = (tree as any).value[0]!;
    const r2 = (tree as any).value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });
});
