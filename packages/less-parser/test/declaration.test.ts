import { Parser } from '../src/index.js';
import { Context, isNode, N, type Declaration, type Node } from '@jesscss/core';

const parser = new Parser();
const parse = parser.parse;

function asDeclaration(n: Node | undefined): Declaration {
  if (!isNode(n, N.Declaration)) {
    throw new Error('Expected a declaration');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return n as unknown as Declaration;
}

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
    const { errors, tree } = parse('--custom: rgba(0, 30, 0, 238)', 'declaration');
    expect(errors.length).toBe(0);
    const value: any = asDeclaration(tree).value;
    expect(value.type).toBe('Sequence');
    expect(value.value?.[0]?.type).toBe('Call');
  });

  it('should parse custom property declaration with if() as a structured call value', () => {
    const { errors, tree } = parse('--custom: if(not(true), 5)', 'declaration');
    expect(errors.length).toBe(0);
    const value: any = asDeclaration(tree).value;
    expect(value.type).toBe('Sequence');
    expect(value.value?.[0]?.type).toBe('Call');
  });

  it('should parse custom property declaration with an interpolated name', () => {
    const { errors, tree } = parse('--@{key}: @value', 'declaration');
    expect(errors.length).toBe(0);
    const name: any = asDeclaration(tree).name;
    expect(name.type).toBe('Interpolated');
  });

  it('opportunistically structures a curly-brace custom-property value as a declaration body', async () => {
    const { errors, tree } = parse('@a: red; a { --foo: { color: @a; } }', 'stylesheet');
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('--foo:{color: red}');
  });

  it('tolerantly falls back to opaque text for a non-CSS-shaped curly custom-property value', () => {
    const { errors, tree } = parse('a { --foo: { 1, 2, 3 }; }', 'stylesheet');
    expect(errors.length).toBe(0);
    expect(String(tree)).toContain('{ 1, 2, 3 }');
  });

  it('should parse each() with an interpolated custom-property declaration in its body', () => {
    const { errors } = parse(`:root {
      each(@vars, {
        --@{key}: @value;
      });
    }`, 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('preserves same-line block comments ahead of evaluated declarations during stylesheet serialization', async () => {
    const { errors, tree } = parse('@tone: "content"; #x { /* lost comment */ content: @tone; }', 'stylesheet');
    expect(errors.length).toBe(0);
    expect(tree).toBeDefined();

    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain(`/* lost comment */\n  content: "content";`);
  });

  it('preserves block comments attached to invisible evaluated variables during stylesheet serialization', async () => {
    const { errors, tree } = parse('/* keep me */ @tone: red; .x { color: blue; }', 'stylesheet');
    expect(errors.length).toBe(0);
    expect(tree).toBeDefined();

    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain(`/* keep me */\n.x {\n  color: blue;\n}`);
  });

  it('should parse legacy IE filter declarations as structured interpolated values', () => {
    const { errors, tree } = parse('filter: progid:DXImageTransform.Microsoft.Alpha(opacity=@fat)', 'declaration');
    expect(errors.length).toBe(0);
    const value: any = asDeclaration(tree).value;
    expect(value.type).toBe('Interpolated');
  });

  it('normalizes Less property merge "+:" to the list-merge assign form', () => {
    const { errors, tree } = parse('src+: url(foo)', 'declaration');
    expect(errors.length).toBe(0);
    const decl: any = asDeclaration(tree);
    expect(decl.options.assign).toBe('+,:');
  });

  it('normalizes Less property merge "+_:" to the sequence-merge assign form', () => {
    const { errors, tree } = parse('src+_: format("woff")', 'declaration');
    expect(errors.length).toBe(0);
    const decl: any = asDeclaration(tree);
    expect(decl.options.assign).toBe('+_:');
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
