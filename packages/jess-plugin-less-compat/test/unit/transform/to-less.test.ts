/**
 * Unit tests for Jess → Less transformation
 */

import { describe, it, expect } from 'vitest';
import { toLessNode, toLessTree } from '../../../src/transform/index.js';
import { Any, BasicSelector, Declaration, Nil, Reference, Rules, Ruleset, SelectorList } from '@jesscss/core';

describe('toLessNode', () => {
  it('should convert a simple Ruleset', () => {
    const jessRuleset = new Ruleset({
      selector: new BasicSelector('div'),
      rules: new Rules([])
    });
    const lessRuleset = toLessNode(jessRuleset);
    expect(lessRuleset.type).toBe('Ruleset');
    expect(lessRuleset.selectors).toHaveLength(1);
  });

  it('should convert Nil selector to empty array', () => {
    const jessRuleset = new Ruleset({
      selector: new Nil(),
      rules: new Rules([])
    });
    const lessRuleset = toLessNode(jessRuleset);
    expect(lessRuleset.selectors).toEqual([]);
  });

  it('should convert SelectorList to array of selectors', () => {
    const jessRuleset = new Ruleset({
      selector: new SelectorList([new BasicSelector('.a'), new BasicSelector('.b')]),
      rules: new Rules([])
    });
    const lessRuleset = toLessNode(jessRuleset);
    expect(lessRuleset.selectors).toHaveLength(2);
  });

  it('should convert Reference to Variable', () => {
    const lessRef = toLessNode(new Reference({ key: 'color' }, { type: 'variable' }));
    expect(lessRef.type).toBe('Variable');
    expect(lessRef.name).toBe('@color');
  });

  it('should convert Reference to Property', () => {
    const lessRef = toLessNode(new Reference({ key: 'color' }, { type: 'property' }));
    expect(lessRef.type).toBe('Property');
    expect(lessRef.name).toBe('color');
  });

  it('should convert Reference to VariableCall', () => {
    const lessRef = toLessNode(new Reference({ key: 'theme' }, { type: 'function' }));
    expect(lessRef.type).toBe('VariableCall');
    expect(lessRef.name).toBe('theme');
  });
});

describe('toLessTree', () => {
  it('should convert entire Rules tree', () => {
    const rules = new Rules([
      new Declaration({
        name: new Any('color', { role: 'property' }),
        value: new Any('red')
      })
    ]);
    const lessTree = toLessTree(rules);
    expect(lessTree.type).toBe('Rules');
  });

  it('should preserve node relationships', () => {
    const decl = new Declaration({
      name: new Any('color', { role: 'property' }),
      value: new Any('red')
    });
    const ruleset = new Ruleset({
      selector: new BasicSelector('.demo'),
      rules: new Rules([decl])
    });
    const lessTree = toLessTree(ruleset);
    expect(lessTree.rules[0].__jessNode).toBe(decl);
  });

  it('should handle nested structures', () => {
    const child = new Ruleset({
      selector: new BasicSelector('.child'),
      rules: new Rules([])
    });
    const parent = new Ruleset({
      selector: new BasicSelector('.parent'),
      rules: new Rules([child])
    });
    const lessTree = toLessTree(parent);
    expect(lessTree.rules[0].type).toBe('Ruleset');
  });
});
