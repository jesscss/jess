import type { IParseResult } from 'css-parser/lib/cssParser';
import { Parser, type LessRules } from '../src';
import { F_MAY_ASYNC, F_STATIC, F_NON_STATIC, type Node, type Rules } from '@jesscss/core';

const parser = new Parser();

// Core parsing helper
export function parse(input: string): IParseResult<Rules>;
export function parse(input: string, rule: 'stylesheet'): IParseResult<Rules>;
export function parse(input: string, rule?: LessRules): IParseResult<Node>;
export function parse(input: string, rule?: LessRules) {
  if (!rule || rule === 'stylesheet') {
    return parser.parse(input);
  }
  return parser.parse(input, rule);
};

// Flag assertion helpers
export const expectFlags = (
  node: Node,
  isStatic: boolean,
  mayAsync: boolean,
  description = ''
) => {
  const prefix = description ? `${description}: ` : '';
  expect(node.getState(F_STATIC)).toBe(isStatic);
  expect(node.getState(F_MAY_ASYNC)).toBe(mayAsync);
};

export const expectStatic = (node: Node, description = '') => {
  expectFlags(node, true, false, description);
};

export const expectNonStatic = (node: Node, description = '') => {
  expectFlags(node, false, false, description);
};

export const expectMayAsync = (node: Node, description = '') => {
  expectFlags(node, false, true, description);
};

export const expectBothFlags = (node: Node, description = '') => {
  expectFlags(node, false, true, description);
};

// Test case helpers
export const testCase = <const T extends LessRules = LessRules>(
  description: string,
  input: string,
  expectedIsStatic: boolean,
  expectedMayAsync: boolean,
  rule: T = 'stylesheet' as T
) => {
  test(description, () => {
    const { tree } = parse(input, rule);

    // For selector interpolation tests, check the first ruleset instead of the root Rules node
    if (description.includes('selector interpolation')) {
      const ruleset = (tree as any).value[0];
      expectFlags(ruleset, expectedIsStatic, expectedMayAsync);
    } else {
      expectFlags(tree, expectedIsStatic, expectedMayAsync);
    }
  });
};

export const testStatic = (description: string, input: string, rule: LessRules = 'stylesheet') => {
  testCase(description, input, true, false, rule);
};

export const testNonStatic = (description: string, input: string, rule: LessRules = 'stylesheet') => {
  testCase(description, input, false, false, rule);
};

export const testMayAsync = (description: string, input: string, rule: LessRules = 'stylesheet') => {
  testCase(description, input, false, true, rule);
};

export const testBothFlags = (description: string, input: string, rule: LessRules = 'stylesheet') => {
  testCase(description, input, false, true, rule);
};

// Common test patterns
export const testPatterns = {
  // Static content patterns
  staticRuleset: (selector = '.a') => `${selector} { color: red; width: 10px }`,
  staticDeclaration: (property = 'color', value = 'red') => `.a { ${property}: ${value} }`,

  // Variable patterns
  variableReference: (property = 'color', variable = '@var') => `.a { ${property}: ${variable} }`,
  variableInOperation: (operation = '1 + @var') => `.a { width: ${operation} }`,
  variableInCall: (functionName = 'rgb', args = '@var, 0, 0') => `.a { color: ${functionName}(${args}) }`,
  variableInNegative: (variable = '@var') => `.a { width: -${variable} }`,
  variableInParen: (variable = '@var') => `.a { color: (${variable}) }`,
  variableInList: (items = '@var, 2px') => `.a { shadow: ${items} }`,
  variableInSequence: (items = '@var solid red') => `.a { border: ${items} }`,
  variableInSquareBlock: (items = '@var, 2') => `.a { prop: [ ${items} ] }`,

  // Operation patterns
  staticOperation: (operation = '1 + 2') => `.a { width: ${operation} }`,
  staticCall: (functionName = 'rgb', args = '255, 0, 0') => `.a { color: ${functionName}(${args}) }`,
  staticNegative: (value = '10px') => `.a { width: -${value} }`,
  staticParen: (value = 'red') => `.a { color: (${value}) }`,
  staticList: (items = '1px, 2px') => `.a { shadow: ${items} }`,
  staticSequence: (items = '1px solid red') => `.a { border: ${items} }`,
  staticSquareBlock: (items = '1, 2') => `.a { prop: [ ${items} ] }`,

  // Complex patterns
  nestedRulesets: (innerContent: string) => `
    .container {
      .nested {
        .deep {
          .inner {
            ${innerContent}
          }
        }
      }
    }
  `,

  multipleRules: (rules: string[]) => rules.join('\n'),

  // Selector patterns
  selectorInterpolation: (variable = '@var') => `.@{var} { color: red }`,
  compoundSelectorInterpolation: (variable = '@var') => `.foo.@{var} { color: red }`,
  complexSelectorInterpolation: (variable = '@var') => `.foo .@{var} { color: red }`,
  selectorListInterpolation: (variable = '@var') => `.static, .@{var} { color: red }`,

  // Import and mixin patterns
  styleImport: (path = 'x.less') => `@import '${path}';`,
  mixinDefinition: (body: string) => `.mixin() { ${body} }`,
  mixinCall: (name = 'x') => `.a { .${name}(); }`,

  // Guard patterns
  guardWithStatic: (condition = '1 = 1') => `.a when (${condition}) { color: red }`,
  guardWithVariable: (condition = '@var = 1') => `.a when (${condition}) { color: red }`,

  // At-rule patterns
  atRuleStatic: (content = '.a { color: red }') => `@media screen { ${content} }`,
  atRuleVariable: (content = '.a { color: @var }') => `@media screen { ${content} }`
};

// Deep node access helpers
export const getNestedNode = (tree: Node, path: number[]): Node => {
  let current = tree;
  for (const index of path) {
    // Handle different node types
    if (current && typeof current === 'object' && 'value' in current) {
      const value = (current as any).value;
      if (Array.isArray(value)) {
        current = value[index]!;
      } else if (value && typeof value === 'object' && 'rules' in value) {
        // For ruleset nodes, access the rules
        current = value.rules.value[index]!;
      } else {
        current = value[index]!;
      }
    } else {
      throw new Error(`Cannot access index ${index} on node: ${current}`);
    }
  }
  return current;
};

// Comprehensive test helpers
export const testDeepBubbling = (
  description: string,
  input: string,
  nodePath: number[],
  expectedIsStatic: boolean,
  expectedMayAsync: boolean
) => {
  test(description, () => {
    const { tree } = parse(input);
    const node = getNestedNode(tree, nodePath);
    expectFlags(node, expectedIsStatic, expectedMayAsync);
  });
};

export const testIsolation = (
  description: string,
  input: string,
  expectedIsStatic: boolean,
  expectedMayAsync: boolean
) => {
  test(description, () => {
    const { tree } = parse(input);
    expectFlags(tree, expectedIsStatic, expectedMayAsync);
  });
};
