import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('stylesheet', () => {
  it('should parse complete stylesheet', () => {
    const { errors } = parse('.test { color: red; }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse stylesheet with charset', () => {
    const { errors } = parse('@charset "UTF-8"; .test { color: red; }', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('main', () => {
  it('should parse main rule list', () => {
    const { errors } = parse('.test { color: red; } .other { margin: 10px; }', 'main');
    expect(errors.length).toBe(0);
  });

  it('should parse main with variable declarations', () => {
    const { errors } = parse('@var: 10px; .test { width: @var; }', 'main');
    expect(errors.length).toBe(0);
  });

  it('should parse main with at-rules', () => {
    const { errors } = parse('@import "file.css"; .test { color: red; }', 'main');
    expect(errors.length).toBe(0);
  });
});

