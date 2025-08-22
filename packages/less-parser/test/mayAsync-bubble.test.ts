import { Parser } from '../src';

const parser = new Parser();
const parse = parser.parse;

describe('Less mayAsync roll-up (bubble)', () => {
  test('pure sync tree has mayAsync=false', () => {
    const { tree } = parse('.a { color: red; width: 10px }', 'stylesheet');
    expect(tree.mayAsync).toBe(false);
  });

  test('variable reference bubbles to root', () => {
    const { tree } = parse('.a { color: @var }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Sequence in declaration bubbles', () => {
    const { tree } = parse('.a { border: @v solid red }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('List bubbles', () => {
    const { tree } = parse('.a { shadow: @v, 2px }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Paren bubbles', () => {
    const { tree } = parse('.a { color: (@v) }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Square Block bubbles', () => {
    const { tree } = parse('.a { prop: [ @v ] }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Operation bubbles', () => {
    const { tree } = parse('.a { width: 1 + @v }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Ruleset bubbles', () => {
    const { tree } = parse('.a { color: @v }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('StyleImport bubbles', () => {
    const { tree } = parse('@import \'x.less\';', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Mixin body bubbles', () => {
    const { tree } = parse('.x() { a: @v } .a { .x(); }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Negative bubbles', () => {
    const { tree } = parse('.a { width: -@v }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Call args bubble', () => {
    const { tree } = parse('.a { color: rgb(@v,10,10) }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('Guard bubbles', () => {
    const { tree } = parse('.a when (@v = 1) { color: red }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });

  test('AtRule inner bubbles', () => {
    const { tree } = parse('@media (min-width: 10px) { a { color: @v } }', 'stylesheet');
    expect(tree.mayAsync).toBe(true);
  });
});
