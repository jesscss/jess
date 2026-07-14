import { Context, Dimension, N, TreeContext, isNode } from '@jesscss/core';
import { Parser } from '../src/jess.js';

const parser = new Parser();

function declarationFrom(source: string, context?: TreeContext) {
  const parsed = parser.parse(source, 'declaration', context ? { context } : undefined);
  expect(parsed.errors).toHaveLength(0);
  if (!isNode(parsed.tree, N.Declaration)) {
    throw new Error('Expected a Declaration');
  }
  return parsed.tree;
}

describe('deferred scalar declaration values', () => {
  it('keeps one authored unsigned numeric scalar as a string with no value subtree', async () => {
    const source = '.a { width: 001px; opacity: 25%; }';
    const parsed = parser.parse(source);
    expect(parsed.errors).toHaveLength(0);
    const ruleset = parsed.tree.rules[0];
    if (!isNode(ruleset, N.Ruleset)) {
      throw new Error('Expected a Ruleset');
    }
    const [width, opacity] = ruleset.rules;
    if (!isNode(width, N.Declaration) || !isNode(opacity, N.Declaration)) {
      throw new Error('Expected declarations');
    }
    expect(width.value).toBe('001px');
    expect(opacity.value).toBe('25%');

    const context = new Context({ output: { collapseNesting: true } });
    expect(await parsed.tree.render(context, { context, collapseNesting: true }))
      .toContain('width: 001px;');
  });

  it('coerces only when an existing node-only property lookup consumes the value', async () => {
    const source = '.a { width: 001px; height: $width + 2px; }';
    const parsed = parser.parse(source);
    expect(parsed.errors).toHaveLength(0);
    const ruleset = parsed.tree.rules[0];
    if (!isNode(ruleset, N.Ruleset) || !isNode(ruleset.rules[0], N.Declaration)) {
      throw new Error('Expected a source declaration');
    }
    const width = ruleset.rules[0];
    expect(width.value).toBe('001px');
    expect(width.valueNode()).toBeInstanceOf(Dimension);

    const context = new Context({ output: { collapseNesting: true } });
    const rendered = await parsed.tree.render(context, { context, collapseNesting: true });
    expect(rendered).toContain('width: 001px;');
    expect(rendered).toContain('height: 3px;');
  });

  it('keeps the pre-POC numeric node shape when parsing with source maps enabled', () => {
    const declaration = declarationFrom(
      'width: 001px;',
      new TreeContext({ sourceMap: true })
    );
    expect(declaration.value).toBeInstanceOf(Dimension);
  });

  it.each([
    ['important', 'width: 10px !important;'],
    ['comment', 'width: 10px /* authored */;'],
    ['line comment', 'width: 10px // authored\n;'],
    ['merge', 'width+: 10px;'],
    ['custom property', '--width: 10px;'],
    ['decimal spelling', 'width: 1.0px;'],
    ['reference', 'width: @value;'],
    ['operator', 'width: 10px + 2px;'],
    ['function', 'width: calc(10px);'],
    ['bracket', 'width: [10px];'],
    ['quoted value', 'width: "10px";']
  ])('keeps %s on the structured parser path', (_label, source) => {
    const declaration = declarationFrom(source);
    expect(typeof declaration.value).not.toBe('string');
  });

  it('keeps VarDeclaration values on the existing structured path', () => {
    const parsed = parser.parse('@width: 10px;');
    expect(parsed.errors).toHaveLength(0);
    const declaration = parsed.tree.rules[0];
    if (!isNode(declaration, N.VarDeclaration)) {
      throw new Error('Expected a VarDeclaration');
    }
    expect(declaration.value).toBeInstanceOf(Dimension);
  });
});
