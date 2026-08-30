import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  collection, collectionEntry, decl, dimension, keyword, rule, stylesheet, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { makeLessRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet, collapseNesting: boolean): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;
const entry = (name: string, value: Parameters<typeof collectionEntry>[1]): ReturnType<typeof collectionEntry> =>
  collectionEntry(keyword(name), value);

/** The declaration lines of a rendered block, ignoring header/brace/indent bytes. */
const declarations = (css: string | undefined): string[] =>
  (css ?? '').split('\n').map(line => line.trim()).filter(line => line.endsWith(';'));

/**
 * A `Collection` at a PROPERTY ROOT is STRUCTURE: it expands to hyphenated
 * declarations. Both emitters — flattened (`collapseNesting: true`) and nested
 * (`collapseNesting: false`, the scss-plugin default and Jess's first-class
 * output) — route through one shared flatten, so they must agree.
 */
describe('SCSS nested-property flatten', () => {
  const bothModes = (document: Stylesheet): { flat: string[]; nested: string[] } => ({
    flat: declarations(render(document, true)),
    nested: declarations(render(document, false))
  });

  it('expands a flat nested property in BOTH emitters', () => {
    const document = stylesheet([
      rule('.x', [decl('font', collection([
        entry('family', keyword('serif')),
        entry('size', dimension(12, 'px'))
      ]))])
    ]);

    const { flat, nested } = bothModes(document);
    expect(flat).toEqual(['font-family: serif;', 'font-size: 12px;']);
    expect(nested).toEqual(flat);
  });

  it('emits the carrier value first, then the leaves, in BOTH emitters', () => {
    const document = stylesheet([
      rule('.x', [decl('font', collection([entry('family', keyword('serif'))], dimension(20, 'px')))])
    ]);

    const { flat, nested } = bothModes(document);
    expect(flat).toEqual(['font: 20px;', 'font-family: serif;']);
    expect(nested).toEqual(flat);
  });

  it('renders the whole nested block byte-for-byte in the nested emitter', () => {
    const document = stylesheet([
      rule('.x', [decl('font', collection([entry('family', keyword('serif'))], dimension(20, 'px')))])
    ]);

    expect(render(document, false)).toBe('.x {\n  font: 20px;\n  font-family: serif;\n}\n');
  });

  it('recurses through a deeper carrier in BOTH emitters', () => {
    const document = stylesheet([
      rule('.x', [decl('border', collection([
        entry('left', collection([
          entry('width', dimension(1, 'px')),
          entry('style', keyword('solid'))
        ], keyword('none'))),
        entry('color', keyword('red'))
      ], dimension(0)))])
    ]);

    const { flat, nested } = bothModes(document);
    expect(flat).toEqual([
      'border: 0;',
      'border-left: none;',
      'border-left-width: 1px;',
      'border-left-style: solid;',
      'border-color: red;'
    ]);
    expect(nested).toEqual(flat);
  });

  it('keeps a nested property flattened alongside ordinary siblings in BOTH emitters', () => {
    const document = stylesheet([
      rule('.x', [
        decl('color', keyword('red')),
        decl('font', collection([entry('family', keyword('serif'))])),
        decl('display', keyword('block'))
      ])
    ]);

    const { flat, nested } = bothModes(document);
    expect(flat).toEqual(['color: red;', 'font-family: serif;', 'display: block;']);
    expect(nested).toEqual(flat);
  });

  /**
   * A custom property takes the DATA role: `--foo: { a: 1 }` is already valid CSS
   * (its value is an arbitrary token stream), and `--foo-a` bears no CSS-defined
   * relationship to `--foo`, so flattening would mint names into an open namespace
   * we do not control (silently colliding with an author's own `--foo-a`).
   */
  it('does NOT flatten a custom property carrying a block, in BOTH emitters', () => {
    const document = stylesheet([
      rule('.x', [decl('--foo', collection([
        entry('a', dimension(1)),
        entry('b', dimension(2))
      ]))])
    ]);

    const { flat, nested } = bothModes(document);
    expect(flat).toEqual(['--foo: { a: 1; b: 2 };']);
    expect(nested).toEqual(flat);
  });
});
