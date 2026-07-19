import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  condition, decl, detachedCall, detachedRuleset, dimension, funcCall, keyword,
  root, rule, varDecl, varRef, type Root
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { makeBuiltinRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root): string | undefined => serialize(document, { evaluator }).css;

describe('detached-ruleset canonical AST emission', () => {
  it('splices a direct detached ruleset through its definition scope and caller fallback', () => {
    const document = root([
      varDecl('base', keyword('red')),
      varDecl('theme', detachedRuleset([
        varDecl('local', varRef('base')),
        decl('color', varRef('local')),
        decl('width', varRef('caller-width'))
      ])),
      rule('.card', [
        varDecl('base', keyword('blue')),
        varDecl('caller-width', dimension(24, 'px')),
        detachedCall('theme')
      ])
    ]);

    expect(render(document)).toBe('.card {\n  color: red;\n  width: 24px;\n}\n');
  });

  it('selects a conditional detached-ruleset branch without materializing it as a value', () => {
    const document = root([
      varDecl('enabled', keyword('true')),
      varDecl('content', funcCall('if', [
        condition({ g: 'truth', value: varRef('enabled') }, '@enabled'),
        detachedRuleset([decl('display', keyword('grid'))]),
        detachedRuleset([decl('display', keyword('none'))])
      ])),
      rule('.panel', [detachedCall('content')])
    ]);

    expect(render(document)).toBe('.panel {\n  display: grid;\n}\n');
  });
});
