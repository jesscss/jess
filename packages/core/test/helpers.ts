import {
  F_MAY_ASYNC, F_STATIC, F_NON_STATIC,
  type Node, type Rules, Any, Node as NodeClass, Rules as RulesNode,
  // Simplified API
  decl, any, sel, el, sellist, rules, ruleset, spaced, ref, call, op, list, paren, negative, atrule, mixin, condition, QueryCondition, interpolated, interpolatedSelector, num,
  // Additional types for test helpers
  StyleImport, Quoted
} from '../src/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readNodeAt(value: unknown, index: number): Node | undefined {
  if (Array.isArray(value)) {
    const node = value[index];
    return node instanceof NodeClass ? node : undefined;
  }
  if (value instanceof RulesNode) {
    return value.rules[index];
  }
  if (isRecord(value) && 'rules' in value) {
    return readNodeAt(value.rules, index);
  }
  return undefined;
}

// Default node instances
const DEFAULT_COLOR = any('red');
const DEFAULT_WIDTH = any('10px');
const DEFAULT_SELECTOR = el('.a');
export const DEFAULT_VARIABLE = ref('var', { type: 'variable' });
const DEFAULT_OPERATION = op([num(1), '+', num(2)]);
const DEFAULT_CALL = call({ name: 'rgb', args: list([any('255'), any('0'), any('0')]) });
const DEFAULT_NEGATIVE = negative(any('10px'));
const DEFAULT_PAREN = paren(any('red'));
const DEFAULT_LIST = list([any('1px'), any('2px')]);
const DEFAULT_SEQUENCE = spaced([any('1px'), any('solid'), any('red')]);

// Simplified API helpers
export function createStaticRuleset(selector = DEFAULT_SELECTOR, declarations: Node[] = []) {
  if (declarations.length === 0) {
    declarations = [
      decl({ name: 'color', value: DEFAULT_COLOR }),
      decl({ name: 'width', value: DEFAULT_WIDTH })
    ];
  }

  return rules([
    ruleset({
      selector: sellist([sel([selector])]),
      rules: declarations
    })
  ]);
}

export function createVariableReference(property = 'color', variable = DEFAULT_VARIABLE) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: property, value: variable })
      ]
    })
  ]);
}

export function createOperation(operation = DEFAULT_OPERATION) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'width', value: operation })
      ]
    })
  ]);
}

export function createVariableInOperation(operation = op([num(1), '+', DEFAULT_VARIABLE])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'width', value: operation })
      ]
    })
  ]);
}

export function createCall(functionCall = DEFAULT_CALL) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'color', value: functionCall })
      ]
    })
  ]);
}

export function createVariableInCall(functionCall = call({ name: 'rgb', args: list([DEFAULT_VARIABLE, any('0'), any('0')]) })) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'color', value: functionCall })
      ]
    })
  ]);
}

export function createNegative(negValue = DEFAULT_NEGATIVE) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'width', value: negValue })
      ]
    })
  ]);
}

export function createVariableInNegative(negValue = negative(DEFAULT_VARIABLE)) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'width', value: negValue })
      ]
    })
  ]);
}

export function createParen(parenValue = DEFAULT_PAREN) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'color', value: parenValue })
      ]
    })
  ]);
}

export function createVariableInParen(parenValue = paren(DEFAULT_VARIABLE)) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'color', value: parenValue })
      ]
    })
  ]);
}

export function createList(listValue = DEFAULT_LIST) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'shadow', value: listValue })
      ]
    })
  ]);
}

export function createVariableInList(listValue = list([DEFAULT_VARIABLE, any('2px')])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'shadow', value: listValue })
      ]
    })
  ]);
}

export function createSequence(sequenceValue = DEFAULT_SEQUENCE) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'border', value: sequenceValue })
      ]
    })
  ]);
}

export function createVariableInSequence(sequenceValue = spaced([DEFAULT_VARIABLE, any('solid'), any('red')])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'border', value: sequenceValue })
      ]
    })
  ]);
}

export function createSquareBlock(squareValue = list([any('1'), any('2')])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'prop', value: squareValue })
      ]
    })
  ]);
}

export function createVariableInSquareBlock(squareValue = list([DEFAULT_VARIABLE, any('2')])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'prop', value: squareValue })
      ]
    })
  ]);
}

export function createStyleImport(importPath = any('x.less')) {
  return rules([
    new StyleImport({
      path: new Quoted(importPath.valueOf(), { quote: '\'' })
    }, {
      type: 'import'
    })
  ]);
}

export function createMixinDefinition(bodyDecl = decl({ name: 'color', value: DEFAULT_COLOR })) {
  return rules([
    mixin({
      name: any('mixin'),
      rules: [bodyDecl]
    })
  ]);
}

export function createGuardWithStatic(guardCondition = condition([num(1), '=', num(1)])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'color', value: DEFAULT_COLOR })
      ],
      guard: guardCondition
    })
  ]);
}

export function createGuardWithVariable(guardCondition = condition([DEFAULT_VARIABLE, '=', num(1)])) {
  return rules([
    ruleset({
      selector: sellist([sel([DEFAULT_SELECTOR])]),
      rules: [
        decl({ name: 'color', value: DEFAULT_COLOR })
      ],
      guard: guardCondition
    })
  ]);
}

export function createAtRuleStatic(atRuleContent = createStaticRuleset(el('.a'), [decl({ name: 'color', value: DEFAULT_COLOR })])) {
  return rules([
    atrule({
      name: new Any('media', { role: 'atkeyword' }),
      prelude: any('screen'),
      rules: atRuleContent.rules
    })
  ]);
}

export function createAtRuleVariable(atRuleContent = createVariableReference('color', DEFAULT_VARIABLE)) {
  return rules([
    atrule({
      name: new Any('media', { role: 'atkeyword' }),
      prelude: any('screen'),
      rules: atRuleContent.rules
    })
  ]);
}

export function createSelectorInterpolation(interpolatedNode = interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })) {
  return rules([
    ruleset({
      selector: sellist([sel([interpolatedSelector(interpolatedNode)])]),
      rules: [
        decl({ name: 'color', value: DEFAULT_COLOR })
      ]
    })
  ]);
}

export function createMultipleRules(ruleNodes: Node[] = []) {
  if (ruleNodes.length === 0) {
    ruleNodes = [
      createVariableReference(),
      createOperation(),
      createStaticRuleset()
    ];
  }

  return rules(ruleNodes.flatMap((rule) => {
    if (rule instanceof RulesNode) {
      return rule.rules;
    }
    return [];
  }));
}

// Flag assertion helpers
export const expectFlags = (
  node: Node,
  isStatic: boolean,
  mayAsync: boolean,
  description = ''
) => {
  const prefix = description ? `${description}: ` : '';
  expect(node.hasFlag(F_STATIC)).toBe(isStatic);
  expect(node.hasFlag(F_MAY_ASYNC)).toBe(mayAsync);
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
export const testCase = (
  description: string,
  createTree: () => Node,
  expectedIsStatic: boolean,
  expectedMayAsync: boolean
) => {
  test(description, () => {
    const node = createTree();
    expectFlags(node, expectedIsStatic, expectedMayAsync);
  });
};

export const testStatic = (description: string, createTree: () => Node) => {
  testCase(description, createTree, true, false);
};

export const testNonStatic = (description: string, createTree: () => Node) => {
  testCase(description, createTree, false, false);
};

export const testMayAsync = (description: string, createTree: () => Node) => {
  testCase(description, createTree, false, true);
};

export const testBothFlags = (description: string, createTree: () => Node) => {
  testCase(description, createTree, false, true);
};

// Common test patterns
export const testPatterns = {
  // Static content patterns
  staticRuleset: (selector = DEFAULT_SELECTOR) => () => createStaticRuleset(selector),
  staticDeclaration: (property = 'color', value = DEFAULT_COLOR) => () => createStaticRuleset(DEFAULT_SELECTOR, [decl({ name: property, value })]),

  // Variable patterns
  variableReference: (property = 'color', variable = DEFAULT_VARIABLE) => () => createVariableReference(property, variable),
  variableInOperation: (operation = op([num(1), '+', DEFAULT_VARIABLE])) => () => createVariableInOperation(operation),
  variableInCall: (functionCall = call({ name: 'rgb', args: list([DEFAULT_VARIABLE, any('0'), any('0')]) })) => () => createVariableInCall(functionCall),
  variableInNegative: (negValue = negative(DEFAULT_VARIABLE)) => () => createVariableInNegative(negValue),
  variableInParen: (parenValue = paren(DEFAULT_VARIABLE)) => () => createVariableInParen(parenValue),
  variableInList: (listValue = list([DEFAULT_VARIABLE, any('2px')])) => () => createVariableInList(listValue),
  variableInSequence: (sequenceValue = spaced([DEFAULT_VARIABLE, any('solid'), any('red')])) => () => createVariableInSequence(sequenceValue),
  variableInSquareBlock: (squareValue = list([DEFAULT_VARIABLE, any('2')])) => () => createVariableInSquareBlock(squareValue),

  // Operation patterns
  staticOperation: (operation = DEFAULT_OPERATION) => () => createOperation(operation),
  staticCall: (functionCall = DEFAULT_CALL) => () => createCall(functionCall),
  staticNegative: (negValue = DEFAULT_NEGATIVE) => () => createNegative(negValue),
  staticParen: (parenValue = DEFAULT_PAREN) => () => createParen(parenValue),
  staticList: (listValue = DEFAULT_LIST) => () => createList(listValue),
  staticSequence: (sequenceValue = DEFAULT_SEQUENCE) => () => createSequence(sequenceValue),
  staticSquareBlock: (squareValue = list([any('1'), any('2')])) => () => createSquareBlock(squareValue),

  // Complex patterns
  nestedRulesets: (innerContent: Node = decl({ name: 'color', value: DEFAULT_COLOR })) => () => {
    // Simplified nested ruleset creation
    return rules([
      ruleset({
        selector: sellist([sel([el('.container')])]),
        rules: [
          ruleset({
            selector: sellist([sel([el('.nested')])]),
            rules: [
              ruleset({
                selector: sellist([sel([el('.deep')])]),
                rules: [
                  ruleset({
                    selector: sellist([sel([el('.inner')])]),
                    rules: [innerContent]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]);
  },

  multipleRules: (ruleNodes: Rules[] = []) => () => createMultipleRules(ruleNodes),

  // Selector patterns
  selectorInterpolation: (interpolatedSelector = interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })) => () => createSelectorInterpolation(interpolatedSelector),
  compoundSelectorInterpolation: (interpolatedSelector = interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })) => () => createSelectorInterpolation(interpolatedSelector),
  complexSelectorInterpolation: (interpolatedSelector = interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })) => () => createSelectorInterpolation(interpolatedSelector),
  selectorListInterpolation: (interpolatedSelector = interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })) => () => createSelectorInterpolation(interpolatedSelector),

  // Import and mixin patterns
  styleImport: (importPath = any('x.less')) => () => createStyleImport(importPath),
  mixinDefinition: (bodyDecl = decl({ name: 'color', value: DEFAULT_COLOR })) => () => createMixinDefinition(bodyDecl),
  mixinCall: (name = 'x') => () => createStaticRuleset(DEFAULT_SELECTOR, [decl({ name: 'color', value: DEFAULT_COLOR })]),

  // Guard patterns
  guardWithStatic: (guardCondition = condition([num(1), '=', num(1)])) => () => createGuardWithStatic(guardCondition),
  guardWithVariable: (guardCondition = condition([DEFAULT_VARIABLE, '=', num(1)])) => () => createGuardWithVariable(guardCondition),

  // At-rule patterns
  atRuleStatic: (atRuleContent = createStaticRuleset(el('.a'), [decl({ name: 'color', value: DEFAULT_COLOR })])) => () => createAtRuleStatic(atRuleContent),
  atRuleVariable: (atRuleContent = createVariableReference('color', DEFAULT_VARIABLE)) => () => createAtRuleVariable(atRuleContent)
};

// Deep node access helpers
export const getNestedNode = (tree: Node, path: number[]): Node => {
  let current = tree;
  for (const index of path) {
    const next = readNodeAt(current instanceof RulesNode ? current : Reflect.get(current, 'value'), index);
    if (!next) {
      throw new Error(`Cannot access index ${index} on node: ${current}`);
    }
    current = next;
  }
  return current;
};

// Comprehensive test helpers
export const testDeepBubbling = (
  description: string,
  createTree: () => Rules,
  nodePath: number[],
  expectedIsStatic: boolean,
  expectedMayAsync: boolean
) => {
  test(description, () => {
    const tree = createTree();
    const node = getNestedNode(tree, nodePath);
    expectFlags(node, expectedIsStatic, expectedMayAsync);
  });
};

export const testIsolation = (
  description: string,
  createTree: () => Rules,
  expectedIsStatic: boolean,
  expectedMayAsync: boolean
) => {
  test(description, () => {
    const tree = createTree();
    expectFlags(tree, expectedIsStatic, expectedMayAsync);
  });
};
