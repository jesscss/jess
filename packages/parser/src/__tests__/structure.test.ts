import { describe, expect, test } from 'vitest';
import {
  SourceText,
  parseStructure
} from '../index.js';
import { fixtureLessProfile, fixtureProfile, fixtureScssProfile } from './fixtures.js';

describe('parseStructure', () => {
  test('builds a structural tree with spans, trivia, symbols, and folding ranges', () => {
    const source = new SourceText('.foo {\n  color: red;\n  --raw: { token: \";}\"; };\n}', {
      version: 1
    });
    const document = parseStructure(source, fixtureProfile);

    expect(document.root.children).toHaveLength(1);
    const rule = document.root.children[0]!;
    expect(rule.kind).toBe('rule');
    expect(rule.start).toBe(0);
    expect(rule.end).toBe(source.length);

    if (!('children' in rule)) {
      throw new Error('Expected rule to be a container.');
    }

    expect(rule.children.map(child => child.kind)).toEqual([
      'declaration',
      'declaration'
    ]);
    expect(document.trivia.map(run => run.kind)).toContain('newline');
    expect(document.foldingRanges()).toEqual([{ start: 0, end: source.length }]);
    expect(document.symbols()).toEqual([
      { name: '.foo', kind: 'rule', start: 0, end: source.length },
      { name: 'color', kind: 'declaration', start: 9, end: 19 },
      { name: '--raw', kind: 'declaration', start: 23, end: 46 }
    ]);
  });

  test('keeps braces in custom property values inside the declaration boundary', () => {
    const source = new SourceText('.foo { --raw: { token: \"}\"; }; color: red; }');
    const document = parseStructure(source, fixtureProfile);
    const rule = document.root.children[0]!;

    if (!('children' in rule)) {
      throw new Error('Expected rule to be a container.');
    }

    expect(rule.children.map(child => child.kind)).toEqual([
      'declaration',
      'declaration'
    ]);
    expect(document.diagnostics).toEqual([]);
    expect(document.symbols().map(symbol => symbol.name)).toEqual([
      '.foo',
      '--raw',
      'color'
    ]);
  });

  test('exposes node lookup, scope lookup, and raw declaration islands', () => {
    const source = new SourceText('.foo { color: @brand; }');
    const document = parseStructure(source, fixtureLessProfile);
    const offset = source.text.indexOf('@brand');

    expect(document.findNodeAt(offset)?.kind).toBe('declaration');
    expect(document.scopeAt(offset).map(node => node.kind)).toEqual([
      'document',
      'rule'
    ]);
    expect(document.islands('declaration-value')).toEqual([
      expect.objectContaining({
        kind: 'raw-island',
        islandKind: 'declaration-value',
        start: offset,
        end: offset + 6
      })
    ]);
    expect(document.islands('variable-reference')).toEqual([
      expect.objectContaining({
        islandKind: 'variable-reference',
        start: offset,
        end: offset + 6
      })
    ]);
  });

  test('classifies at-rule prelude islands without the at-keyword', () => {
    const source = new SourceText('@media screen { .foo { color: red; } }');
    const document = parseStructure(source, fixtureLessProfile);
    const preludeStart = source.text.indexOf('screen');

    expect(document.islands('at-rule-prelude')).toEqual([
      expect.objectContaining({
        islandKind: 'at-rule-prelude',
        start: preludeStart,
        end: preludeStart + 'screen'.length
      })
    ]);
    expect(document.islands('variable-reference')).toEqual([]);
  });

  test('classifies adjacent at-rule preludes from the name boundary', () => {
    const source = new SourceText('@supports(display: grid) { .foo { color: red; } }');
    const document = parseStructure(source, fixtureLessProfile);
    const preludeStart = source.text.indexOf('(display');

    expect(document.islands('at-rule-prelude')).toEqual([
      expect.objectContaining({
        islandKind: 'at-rule-prelude',
        start: preludeStart,
        end: preludeStart + '(display: grid)'.length
      })
    ]);
  });

  test('classifies Less references inside at-rule preludes without including the at-keyword', () => {
    const source = new SourceText('@media @breakpoint { .foo { color: red; } }');
    const document = parseStructure(source, fixtureLessProfile);
    const preludeStart = source.text.indexOf('@breakpoint');

    expect(document.islands('at-rule-prelude')).toEqual([
      expect.objectContaining({
        islandKind: 'at-rule-prelude',
        start: preludeStart,
        end: preludeStart + '@breakpoint'.length
      })
    ]);
    expect(document.islands('variable-reference')).toEqual([
      expect.objectContaining({
        islandKind: 'variable-reference',
        start: preludeStart,
        end: preludeStart + '@breakpoint'.length
      })
    ]);
  });

  test('classifies import and SCSS mixin-call statements structurally', () => {
    const document = parseStructure('@import "a.css"; .foo { @include reset; }', fixtureScssProfile);

    expect(document.root.children[0]).toMatchObject({
      kind: 'import',
      start: 0,
      end: 15
    });

    const rule = document.root.children[1]!;
    if (!('children' in rule)) {
      throw new Error('Expected rule to be a container.');
    }
    expect(rule.children[0]).toMatchObject({ kind: 'mixin-call' });
  });

  test('recovers malformed blocks into diagnostics without throwing', () => {
    const document = parseStructure('.foo { color: red;', fixtureProfile);

    expect(document.diagnostics).toEqual([
      expect.objectContaining({
        code: 'unclosed-block',
        expected: '}',
        actual: 'end of file'
      })
    ]);
    expect(document.root.children[0]).toMatchObject({
      kind: 'rule',
      end: document.source.length
    });
  });

  test('recovers unexpected root block closes with forward progress', () => {
    const document = parseStructure('body { color: red; }\n}', fixtureLessProfile);

    expect(document.diagnostics).toEqual([
      expect.objectContaining({ code: 'unexpected-block-close' })
    ]);
    expect(document.root.children.at(-1)).toMatchObject({
      kind: 'error',
      start: document.source.length - 1,
      end: document.source.length
    });
  });

  test('reports changed ranges between source versions', () => {
    const before = parseStructure(new SourceText('.foo { color: red; }', { version: 1 }), fixtureProfile);
    const after = parseStructure(new SourceText('.foo { color: blue; }', { version: 2 }), fixtureProfile);

    expect(after.changedRanges(before)).toEqual([
      {
        start: 14,
        oldEnd: 17,
        newEnd: 18
      }
    ]);
    expect(after.changedRanges(after)).toEqual([]);
  });

  test('reports structural performance guard stats without materializing islands', () => {
    const before = parseStructure(new SourceText('.foo { color: red; }', { version: 1 }), fixtureLessProfile);
    const after = parseStructure(new SourceText('.foo { color: @brand; }', { version: 2 }), fixtureLessProfile);
    const stats = after.stats(before);

    expect(after.source.hasLineMap).toBe(false);
    expect(stats).toMatchObject({
      sourceBytes: new TextEncoder().encode(after.source.text).byteLength,
      structuralRecords: 6,
      maxBlockDepth: 2,
      diagnostics: 0,
      rawIslands: 3,
      changedRanges: 1
    });
    expect(stats.recordsPerInputByte).toBeGreaterThan(0);
  });
});
