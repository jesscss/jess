import { describe, expect, test } from 'vitest';
import { Stylesheet, serializeTypes } from '@jesscss/core';
import { parseCssStylesheet } from '../src/index.js';

describe('CSS scanner-first Stylesheet AST', () => {
  test('parses a simple ruleset into string-backed core AST nodes', () => {
    const root = parseCssStylesheet('fixture.css', '.a { color: blue; }');

    expect(root).toBeInstanceOf(Stylesheet);
    expect(root.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(serializeTypes(root)).toBe([
      '(Stylesheet',
      '  rules:',
      '    [',
      '      (Ruleset',
      '        selector: \'.a\'',
      '        rules:',
      '          [',
      '            (Declaration',
      '              name: \'color\'',
      '              value: \'blue\'',
      '            )',
      '          ]',
      '      )',
      '    ]',
      ')'
    ].join('\n'));
  });

  test('keeps component-value blocks inside declaration strings', () => {
    const root = parseCssStylesheet(
      'fixture.css',
      '.a { --payload: { token: "}"; }; }'
    );

    expect(root.toTrimmedString()).toBe('.a {\n  --payload: { token: "}"; };\n}\n');
    expect(serializeTypes(root)).toContain('name: \'--payload\'');
    expect(serializeTypes(root)).toContain('value: \'{ token: "}"; }\'');
    expect(serializeTypes(root)).not.toContain('(Any');
  });

  test('keeps at-rule names and preludes split by the at-rule contract', () => {
    const root = parseCssStylesheet(
      'fixture.css',
      '@media2 screen { .a { color: blue; } } @foo_bar print { .b { color: red; } }'
    );
    const types = serializeTypes(root);

    expect(types).toContain('name: \'@media2\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).toContain('name: \'@foo_bar\'');
    expect(types).toContain('prelude: \'print\'');
    expect(root.toTrimmedString()).toContain('@media2 screen');
    expect(root.toTrimmedString()).toContain('@foo_bar print');
  });

  test('parses statement-form imports without materializing the prelude', () => {
    const root = parseCssStylesheet('fixture.css', '@import url("theme.css");');

    expect(root.toTrimmedString()).toBe('@import url("theme.css");');
    expect(serializeTypes(root)).toContain('(AtRuleStatement');
    expect(serializeTypes(root)).toContain('name: \'@import\'');
    expect(serializeTypes(root)).toContain('prelude: \'url("theme.css")\'');
    expect(serializeTypes(root)).not.toContain('(Call');
  });

  test('reports structural diagnostics instead of silently dropping error nodes', () => {
    expect(() => parseCssStylesheet('fixture.css', '.a { color: blue;')).toThrow(
      /Unclosed block/u
    );
  });
});
