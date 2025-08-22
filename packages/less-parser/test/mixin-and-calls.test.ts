import { Parser } from '../src';

const lessParser = new Parser();
const parse = lessParser.parse;

describe('mixin definition and calls', () => {
  test('mixin definition', () => {
    const { errors } = parse('.m(@v) when (@v) {two: when true}', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  test('mixin call variants', () => {
    let { errors } = parse('.mixin-with-guard-inside(0px)', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.mixin;`, 'main'));
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.wrap-mixin(@ruleset: { color: red; })`, 'mixinOrQualifiedRule'));
    expect(errors.length).toBe(0);

    ({ errors } = parse('.mixin-takes-two(@a : d, e; @b : f)', 'mixinOrQualifiedRule'));
    expect(errors.length).toBe(0);

    ({ errors } = parse('.mixin-call({direct: works;}; @b: {named: works;});', 'stylesheet'));
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.mixout ('left') { }`, 'mixinOrQualifiedRule'));
    expect(errors.length).toBe(0);
  });
});
