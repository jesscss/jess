import { Parser } from '../src';

const lessParser = new Parser();
const parse = lessParser.parse;

/** @todo - add more individual rule parsing tests */
describe('can parse any rule', () => {
  test('qualified rule with interpolation', () => {
    const { errors } = parse('qw@{ident} { foo: bar }', 'main');
    expect(errors.length).toBe(0);
  });

  test('anonymous mixins', () => {
    const { errors } = parse('.(@v;@i) {}', 'anonymousMixinDefinition');
    expect(errors.length).toBe(0);
  });

  test('comparison', () => {
    const { errors } = parse('@a = white', 'comparison');
    expect(errors.length).toBe(0);
  });

  test('assignment', () => {
    const { errors } = parse('@a: 1px;', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  test('assignment to mixin', () => {
    const { errors } = parse(`@ruleset: { color: black; background: white; }`, 'stylesheet');
    expect(errors.length).toBe(0);
  });

  test('when guard', () => {
    const { errors } = parse('when(@a = white)', 'guard');
    expect(errors.length).toBe(0);
  });

  test('declaration', () => {
    const { errors } = parse('color: green', 'declaration');
    expect(errors.length).toBe(0);
  });

  test('accessors', () => {
    const { errors } = parse('color: @p[accessor]', 'declaration');
    expect(errors.length).toBe(0);
  });

  test('qualified rule', () => {
    const { errors } = parse(`.light when (lightness(@a) > 50%) { color: green; }`, 'qualifiedRule');
    expect(errors.length).toBe(0);
  });

  test('parses mixin args', () => {
    const { errors } = parse('(@v)', 'mixinArgs', { isDefinition: true });
    expect(errors.length).toBe(0);
  });
});
