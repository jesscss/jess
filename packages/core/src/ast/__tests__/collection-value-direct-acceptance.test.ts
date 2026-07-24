import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  classifyValueBlock, collection, decl, dimension, funcCall, interpolation, keyword,
  rule, stylesheet, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { makeBuiltinRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;

/**
 * A Collection reaching a value/arg position serializes as the canonical Jess
 * collection `{ a: 1; b: 2 }` — never as empty bytes, which silently dropped the
 * argument while the surrounding comma glue still printed (`foo(, b)`), and never
 * as the Sass paren-map INPUT syntax, which the parser lowers away.
 */
describe('Collection in a value/arg position', () => {
  const map = (): ReturnType<typeof collection> => collection([
    decl('a', dimension(1)),
    decl('b', dimension(2))
  ]);

  it('serializes a variable-bound collection as the first argument', () => {
    const document = stylesheet([
      variableDeclaration('m', map(), { mode: 'declare' }),
      rule('.x', [decl('y', funcCall('foo', [variableReference('m', 'scoped'), keyword('b')]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({ a: 1; b: 2 }, b);\n}\n');
  });

  it('serializes a collection in a NON-first argument position', () => {
    const document = stylesheet([
      variableDeclaration('m', map(), { mode: 'declare' }),
      rule('.x', [decl('y', funcCall('foo', [keyword('z'), variableReference('m', 'scoped')]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo(z, { a: 1; b: 2 });\n}\n');
  });

  it('serializes an inline collection literal with no variable binding', () => {
    const document = stylesheet([
      rule('.x', [decl('y', funcCall('foo', [map()]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({ a: 1; b: 2 });\n}\n');
  });

  it('serializes a nested collection through the same arm', () => {
    const document = stylesheet([
      rule('.x', [decl('y', funcCall('foo', [collection([
        decl('a', collection([decl('c', dimension(3))])),
        decl('b', dimension(2))
      ])]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({ a: { c: 3 }; b: 2 });\n}\n');
  });

  it('resolves an Interpolation entry name to bytes', () => {
    const document = stylesheet([
      variableDeclaration('k', keyword('a'), { mode: 'declare' }),
      rule('.x', [decl('y', funcCall('foo', [collection([
        decl(
          interpolation([{ ref: variableReference('k', 'live'), unquote: true }]),
          dimension(1)
        )
      ])]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({ a: 1 });\n}\n');
  });

  it('keeps the `@` sigil on a variable-declaration entry', () => {
    const map = classifyValueBlock([
      variableDeclaration('a', dimension(1), { mode: 'declare' }),
      variableDeclaration('b', dimension(2), { mode: 'declare' })
    ]);
    expect(map.type).toBe('Collection');

    const document = stylesheet([
      rule('.x', [decl('y', funcCall('foo', [map]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({ @a: 1; @b: 2 });\n}\n');
  });

  it('serializes an empty collection as `{}`', () => {
    const document = stylesheet([
      rule('.x', [decl('y', funcCall('foo', [collection([])]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({});\n}\n');
  });

  it('keeps `!important` on a collection entry', () => {
    const document = stylesheet([
      rule('.x', [decl('y', funcCall('foo', [collection([decl('a', dimension(1), null, true)])]))])
    ]);

    expect(render(document)).toBe('.x {\n  y: foo({ a: 1 !important });\n}\n');
  });

  /**
   * The SCSS nested-property carrier (`font: 20px { family: serif }`) is flattened
   * to hyphenated declarations structurally in `walkBody`, so it never reaches the
   * value arm. Guard that the flatten still owns it.
   */
  it('leaves the SCSS nested-property flatten path untouched', () => {
    const document = stylesheet([
      rule('.x', [decl('font', collection([decl('family', keyword('serif'))], dimension(20, 'px')))])
    ]);

    expect(render(document)).toBe('.x {\n  font: 20px;\n  font-family: serif;\n}\n');
  });
});
