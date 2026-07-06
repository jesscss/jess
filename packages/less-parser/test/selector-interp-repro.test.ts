import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

const parser = new Parser();

describe('selector interpolation parse gap', () => {
  it('leading @{var} as whole selector', () => {
    const { errors, tree } = parser.parse('@{parent} { color: red }');
    expect(errors).toEqual([]);
    expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
  });

  it('interpolation after type selector: div@{n}', () => {
    const { errors, tree } = parser.parse('div@{n} { color: red }');
    expect(errors).toEqual([]);
    expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
  });

  it('interpolation after type selector: a@{parent}', () => {
    const { errors, tree } = parser.parse('a@{parent} { color: red }');
    expect(errors).toEqual([]);
    expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
  });

  it('class-prefix interpolation still parses: .a-@{n}', () => {
    const { errors, tree } = parser.parse('.a-@{n} { color: red }');
    expect(errors).toEqual([]);
    expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
  });

  it('class-prefix interpolation still parses: .@{n}', () => {
    const { errors, tree } = parser.parse('.@{n} { color: red }');
    expect(errors).toEqual([]);
    expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
  });

  it('plain class still parses: .x', () => {
    const { errors } = parser.parse('.x { color: red }');
    expect(errors).toEqual([]);
  });
});
