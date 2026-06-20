import { describe, expect, test } from 'vitest';
import { Context } from '../../context.js';
import {
  N,
  ProgressiveAtRule,
  ProgressiveDeclaration,
  ProgressiveRuleset,
  progressiveatrule,
  progressivedecl,
  progressiveruleset
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { serializeTypes } from '../util/serialize-types.js';

describe('progressive scanner-first proof nodes', () => {
  test('render and serialize string-backed declaration values', () => {
    const declaration = progressivedecl({
      name: 'color',
      value: ['blue']
    });

    expect(declaration).toBeInstanceOf(ProgressiveDeclaration);
    expect(declaration.toTrimmedString()).toBe('color: blue');
    expect(serializeTypes(declaration)).toBeString(`
      (ProgressiveDeclaration
        name: 'color'
        valueSegments:
          ['blue']
      )
    `);
  });

  test('preserves exact progressive declaration value segments', () => {
    const declaration = progressivedecl({
      name: 'width',
      value: ['calc(', '100%', ' - ', '1px', ')']
    });

    expect(declaration.toTrimmedString()).toBe('width: calc(100% - 1px)');
  });

  test('renders progressive string-backed rulesets', () => {
    const progressive = progressiveruleset({
      selector: '.a',
      rules: [
        progressivedecl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(progressive).toBeInstanceOf(ProgressiveRuleset);
    expect(progressive.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(progressive.toTrimmedString({ compress: true })).toBe('.a { color: blue; }');
    expect(isNode(progressive, N.Ruleset)).toBe(false);
    expect(serializeTypes(progressive)).toBeString(`
      (ProgressiveRuleset
        selector: '.a'
        rules:
          [
            (ProgressiveDeclaration
              name: 'color'
              valueSegments:
                ['blue']
            )
          ]
      )
    `);
  });

  test('renders progressive string-backed at-rules', () => {
    const progressive = progressiveatrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        progressiveruleset({
          selector: '.a',
          rules: [
            progressivedecl({
              name: 'color',
              value: ['blue']
            })
          ]
        })
      ]
    });

    expect(progressive).toBeInstanceOf(ProgressiveAtRule);
    expect(progressive.toTrimmedString()).toBe('@media screen {\n  .a {\n    color: blue;\n  }\n}\n');
    expect(progressive.toTrimmedString({ compress: true })).toBe('@media screen { .a { color: blue; } }');
    expect(serializeTypes(progressive)).toBeString(`
      (ProgressiveAtRule
        name: '@media'
        prelude: 'screen'
        rules:
          [
            (ProgressiveRuleset
              selector: '.a'
              rules:
                [
                  (ProgressiveDeclaration
                    name: 'color'
                    valueSegments:
                      ['blue']
                  )
                ]
            )
          ]
      )
    `);
  });

  test('keeps raw rule strings and nested rules from gaining declaration semicolons', () => {
    const progressive = progressiveruleset({
      selector: '.a',
      rules: [
        'display: block;',
        progressiveruleset({
          selector: '.b',
          rules: [
            progressivedecl({
              name: 'color',
              value: ['blue']
            })
          ]
        })
      ]
    });

    expect(progressive.toTrimmedString()).toBe('.a {\n  display: block;\n  .b {\n    color: blue;\n  }\n}\n');
  });

  test('writes progressive render output without value child nodes', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = progressiveruleset({
      selector: '.a',
      rules: [
        progressivedecl({ name: 'color', value: ['blue'] })
      ]
    });

    expect(node.render(context, buffer)).toBe('.a {\n  color: blue;\n}\n');
    expect(buffer.segments).toEqual(['.a {\n  color: blue;\n}\n']);
  });

  test('writes progressive at-rule render output without prelude child nodes', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = progressiveatrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        progressiveruleset({
          selector: '.a',
          rules: [
            progressivedecl({ name: 'color', value: ['blue'] })
          ]
        })
      ]
    });

    expect(node.render(context, buffer)).toBe('@media screen {\n  .a {\n    color: blue;\n  }\n}\n');
    expect(buffer.segments).toEqual(['@media screen {\n  .a {\n    color: blue;\n  }\n}\n']);
  });
});
