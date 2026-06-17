import { describe, expect, it } from 'vitest';
import {
  BasicSelector,
  Declaration,
  Rules,
  Ruleset,
  Any,
  SelectorList,
  Reference
} from '@jesscss/core';
import { LessAdapterBase, createLessAdapter, toLessNode, toLessTree } from '../../../src/transform/index.js';
import type { LessAdapterNode, LessElement, LessRuleset, LessVariable, LessProperty, LessVariableCall, LessDeclaration } from '../../../src/types.js';

function isLessElement(value: unknown): value is LessElement {
  return value instanceof LessAdapterBase
    && 'type' in value
    && value.type === 'Element'
    && 'isVariable' in value;
}

function isLessRuleset(value: unknown): value is LessRuleset {
  return value instanceof LessAdapterBase
    && 'type' in value
    && value.type === 'Ruleset'
    && 'selectors' in value
    && 'rules' in value;
}

function isLessAdapterNode<TJess extends BasicSelector>(value: unknown): value is LessAdapterNode<TJess> {
  return value instanceof LessAdapterBase && '__jessNode' in value;
}

function isLessVariable(value: unknown): value is LessVariable {
  return value instanceof LessAdapterBase && 'type' in value && value.type === 'Variable';
}

function isLessProperty(value: unknown): value is LessProperty {
  return value instanceof LessAdapterBase && 'type' in value && value.type === 'Property';
}

function isLessVariableCall(value: unknown): value is LessVariableCall {
  return value instanceof LessAdapterBase && 'type' in value && value.type === 'VariableCall';
}

function isLessDeclaration(value: unknown): value is LessDeclaration {
  return value instanceof LessAdapterBase && 'type' in value && value.type === 'Declaration';
}

describe('createLessAdapter', () => {
  it('exposes declared fields through adapter instances', () => {
    const selector = new BasicSelector('.demo');
    const adapter = createLessAdapter(selector, {
      lessType: 'Element',
      fields: {
        value: node => node.value,
        isVariable: () => false
      }
    });

    expect(adapter).toBeInstanceOf(LessAdapterBase);
    expect(isLessElement(adapter)).toBe(true);
    if (!isLessElement(adapter)) {
      throw new Error('Expected Less element adapter');
    }
    const lessElement = adapter;
    expect(lessElement.type).toBe('Element');
    expect(lessElement.value).toBe('.demo');
    expect(lessElement.isVariable).toBe(false);
  });

  it('reuses cached adapters for the same Jess node', () => {
    const cache = new WeakMap();
    const selector = new BasicSelector('.demo');
    const a = createLessAdapter(selector, { fields: {} }, cache);
    const b = createLessAdapter(selector, { fields: {} }, cache);
    expect(a).toBe(b);
  });

  it('keeps a typed back-reference to the Jess node', () => {
    const selector = new BasicSelector('.demo');
    const adapter = createLessAdapter(selector, { fields: {} });
    expect(isLessAdapterNode<BasicSelector>(adapter)).toBe(true);
    if (!isLessAdapterNode<BasicSelector>(adapter)) {
      throw new Error('Expected Less adapter node');
    }
    expect(adapter.jessNode).toBe(selector);
    expect(adapter.__jessNode).toBe(selector);
  });

  it('routes deprecated Less declaration value mutation through the Jess direct field', () => {
    const declaration = new Declaration({
      name: new Any('color', { role: 'property' }),
      value: new Any('red')
    });
    const adapter = toLessNode(declaration);

    expect(isLessDeclaration(adapter)).toBe(true);
    if (!isLessDeclaration(adapter)) {
      throw new Error('Expected Less declaration adapter');
    }

    const nextValue = new Any('blue');
    adapter.value = nextValue;

    expect(declaration.valueNode).toBe(nextValue);
    expect(declaration.value.value).not.toBe(nextValue);
    expect(declaration.toTrimmedString()).toBe('color: blue');
  });
});

describe('toLessNode', () => {
  it('converts a simple ruleset into a typed adapter', () => {
    const ruleset = new Ruleset({
      selector: new BasicSelector('.demo'),
      rules: new Rules([])
    });

    const lessRuleset = toLessNode(ruleset);

    expect(isLessRuleset(lessRuleset)).toBe(true);
    if (!isLessRuleset(lessRuleset)) {
      throw new Error('Expected Less ruleset');
    }
    expect(lessRuleset).toBeInstanceOf(LessAdapterBase);
    expect(lessRuleset.type).toBe('Ruleset');
    expect(lessRuleset.selectors).toHaveLength(1);
    expect(lessRuleset.selectors[0]).toBeInstanceOf(LessAdapterBase);
  });

  it('converts selector lists into selector arrays', () => {
    const ruleset = new Ruleset({
      selector: new SelectorList([new BasicSelector('.a'), new BasicSelector('.b')]),
      rules: new Rules([])
    });

    const lessRuleset = toLessNode(ruleset);

    expect(isLessRuleset(lessRuleset)).toBe(true);
    if (!isLessRuleset(lessRuleset)) {
      throw new Error('Expected Less ruleset');
    }
    expect(lessRuleset.selectors).toHaveLength(2);
    expect(lessRuleset.selectors.map(selector => selector.type)).toEqual(['Element', 'Element']);
  });

  it('maps references to the expected Less node kinds', () => {
    const variable = toLessNode(new Reference({ key: 'foo' }, { type: 'variable' }));
    const property = toLessNode(new Reference({ key: 'foo' }, { type: 'property' }));
    const variableCall = toLessNode(new Reference({ key: 'foo' }, { type: 'function' }));

    expect(isLessVariable(variable)).toBe(true);
    expect(isLessProperty(property)).toBe(true);
    expect(isLessVariableCall(variableCall)).toBe(true);
    if (!isLessVariable(variable) || !isLessProperty(property) || !isLessVariableCall(variableCall)) {
      throw new Error('Expected Less reference adapters');
    }
    expect(variable.type).toBe('Variable');
    expect(variable.name).toBe('@foo');
    expect(property.type).toBe('Property');
    expect(property.name).toBe('foo');
    expect(variableCall.type).toBe('VariableCall');
    expect(variableCall.name).toBe('foo');
  });
});

describe('toLessTree', () => {
  it('preserves adapter identity for nested reused nodes via cache', () => {
    const decl = new Declaration({
      name: new Any('color', { role: 'property' }),
      value: new Any('red')
    });
    const rules = new Rules([decl]);
    const ruleset = new Ruleset({
      selector: new BasicSelector('.demo'),
      rules
    });

    const lessTree = toLessTree(ruleset);

    expect(isLessRuleset(lessTree)).toBe(true);
    if (!isLessRuleset(lessTree)) {
      throw new Error('Expected Less ruleset');
    }
    expect(lessTree).toBeInstanceOf(LessAdapterBase);
    expect(lessTree.rules[0]).toBeInstanceOf(LessAdapterBase);
    const firstRule = lessTree.rules[0];
    expect(firstRule).toBeDefined();
    if (!firstRule) {
      throw new Error('Expected first Less rule');
    }
    expect(firstRule.__jessNode).toBe(decl);
  });
});
