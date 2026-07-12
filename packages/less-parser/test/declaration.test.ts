import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('declaration', () => {
  it('should parse simple declaration', () => {
    const { errors } = parse('color: green', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse declaration with variable reference', () => {
    const { errors } = parse('color: @var', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse declaration with accessor', () => {
    const { errors } = parse('color: @p[accessor]', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse custom property declaration', () => {
    const { errors } = parse('--custom: value', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse custom property declaration with generic function value', () => {
    const { errors } = parse('--custom: rgba(0, 30, 0, 238)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('declarationList', () => {
  it('should parse list of declarations', () => {
    const { errors } = parse('color: red; margin: 10px;', 'declarationList');
    expect(errors.length).toBe(0);
  });

  it('should parse declaration list with mixins', () => {
    const { errors } = parse('.mixin(); color: red;', 'declarationList');
    expect(errors.length).toBe(0);
  });
});
