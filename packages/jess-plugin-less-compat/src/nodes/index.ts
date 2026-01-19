/**
 * Node transformer registry
 * Maps Jess node types to their Less transformation functions
 */

import { Node, Ruleset, Declaration, Mixin, Dimension, Num, Color, Operation, Expression, Quoted, Url, Comment, AtRule, StyleImport, Extend, Condition, Paren, Negative, List, VarDeclaration, Keyword, Combinator, AttributeSelector, Call, Selector, SelectorList, Reference } from '@jesscss/core';
import { transformRulesetToLess } from './ruleset.js';
import { transformDeclarationToLess } from './declaration.js';
import { transformMixinToLess } from './mixin.js';
import { transformDimensionToLess } from './dimension.js';
import { transformColorToLess } from './color.js';
import { transformOperationToLess } from './operation.js';
import { transformExpressionToLess } from './expression.js';
import { transformQuotedToLess } from './quoted.js';
import { transformUrlToLess } from './url.js';
import { transformCommentToLess } from './comment.js';
import { transformAtRuleToLess } from './at-rule.js';
import { transformImportToLess } from './import.js';
import { transformExtendToLess } from './extend.js';
import { transformConditionToLess } from './condition.js';
import { transformParenToLess } from './paren.js';
import { transformNegativeToLess } from './negative.js';
import { transformListToLess } from './list.js';
import { transformVarDeclarationToLess } from './var-declaration.js';
import { transformKeywordToLess } from './keyword.js';
import { transformCombinatorToLess } from './combinator.js';
import { transformAttributeSelectorToLess } from './attribute-selector.js';
import { transformCallToLess } from './call.js';
import { transformSelectorToLess } from './selector.js';
import { transformReferenceToLess } from './reference.js';
import type { LessNode } from '../types.js';

export type NodeTransformer = (
  jessNode: Node,
  cache?: WeakMap<any, any>
) => LessNode;

// Type guards for specific node types
export function isRuleset(node: Node): node is Ruleset {
  return node.type === 'Ruleset';
}

export function isDeclaration(node: Node): node is Declaration {
  return node.type === 'Declaration';
}

export function isMixin(node: Node): node is Mixin {
  return node.type === 'Mixin';
}

export function isDimension(node: Node): node is Dimension {
  return node.type === 'Dimension';
}

export function isNum(node: Node): node is Num {
  return node.type === 'Num';
}

export function isColor(node: Node): node is Color {
  return node.type === 'Color';
}

export function isOperation(node: Node): node is Operation {
  return node.type === 'Operation';
}

export function isExpression(node: Node): node is Expression {
  return node.type === 'Expression';
}

export function isQuoted(node: Node): node is Quoted {
  return node.type === 'Quoted';
}

export function isUrl(node: Node): node is Url {
  return node.type === 'Url';
}

export function isComment(node: Node): node is Comment {
  return node.type === 'Comment';
}

export function isAtRule(node: Node): node is AtRule {
  return node.type === 'AtRule';
}

export function isStyleImport(node: Node): node is StyleImport {
  return node.type === 'StyleImport';
}

export function isExtend(node: Node): node is Extend {
  return node.type === 'Extend';
}

export function isCondition(node: Node): node is Condition {
  return node.type === 'Condition';
}

export function isParen(node: Node): node is Paren {
  return node.type === 'Paren';
}

export function isNegative(node: Node): node is Negative {
  return node.type === 'Negative';
}

export function isList(node: Node): node is List {
  return node.type === 'List';
}

export function isVarDeclaration(node: Node): node is VarDeclaration {
  return node.type === 'VarDeclaration';
}

export function isKeyword(node: Node): node is Keyword {
  return node.type === 'Keyword';
}

export function isCombinator(node: Node): node is Combinator {
  return node.type === 'Combinator';
}

export function isAttributeSelector(node: Node): node is AttributeSelector {
  return node.type === 'AttributeSelector';
}

export function isCall(node: Node): node is Call {
  return node.type === 'Call';
}

export function isSelector(node: Node): node is Selector | SelectorList {
  return node.type === 'SelectorList' || node.type === 'ComplexSelector'
    || node.type === 'CompoundSelector' || node.type === 'BasicSelector';
}

export function isReference(node: Node): node is Reference {
  return node.type === 'Reference';
}

/**
 * Registry of node transformers
 */
const transformers: Map<string, NodeTransformer> = new Map();

// Register all transformers
transformers.set('Ruleset', (node, cache) => {
  if (isRuleset(node)) {
    return transformRulesetToLess(node, cache);
  }
  throw new Error(`Expected Ruleset node, got ${node.type}`);
});

transformers.set('Declaration', (node, cache) => {
  if (isDeclaration(node)) {
    return transformDeclarationToLess(node, cache);
  }
  throw new Error(`Expected Declaration node, got ${node.type}`);
});

transformers.set('Mixin', (node, cache) => {
  if (isMixin(node)) {
    return transformMixinToLess(node, cache);
  }
  throw new Error(`Expected Mixin node, got ${node.type}`);
});

transformers.set('Dimension', (node, cache) => {
  if (isDimension(node)) {
    return transformDimensionToLess(node, cache);
  }
  throw new Error(`Expected Dimension node, got ${node.type}`);
});

transformers.set('Num', (node, cache) => {
  if (isNum(node)) {
    return transformDimensionToLess(node, cache);
  }
  throw new Error(`Expected Num node, got ${node.type}`);
});

transformers.set('Color', (node, cache) => {
  if (isColor(node)) {
    return transformColorToLess(node, cache);
  }
  throw new Error(`Expected Color node, got ${node.type}`);
});

transformers.set('Operation', (node, cache) => {
  if (isOperation(node)) {
    return transformOperationToLess(node, cache);
  }
  throw new Error(`Expected Operation node, got ${node.type}`);
});

transformers.set('Expression', (node, cache) => {
  if (isExpression(node)) {
    return transformExpressionToLess(node, cache);
  }
  throw new Error(`Expected Expression node, got ${node.type}`);
});

transformers.set('Quoted', (node, cache) => {
  if (isQuoted(node)) {
    return transformQuotedToLess(node, cache);
  }
  throw new Error(`Expected Quoted node, got ${node.type}`);
});

transformers.set('Url', (node, cache) => {
  if (isUrl(node)) {
    return transformUrlToLess(node, cache);
  }
  throw new Error(`Expected Url node, got ${node.type}`);
});

transformers.set('Comment', (node, cache) => {
  if (isComment(node)) {
    return transformCommentToLess(node, cache);
  }
  throw new Error(`Expected Comment node, got ${node.type}`);
});

transformers.set('AtRule', (node, cache) => {
  if (isAtRule(node)) {
    return transformAtRuleToLess(node, cache);
  }
  throw new Error(`Expected AtRule node, got ${node.type}`);
});

transformers.set('StyleImport', (node, cache) => {
  if (isStyleImport(node)) {
    return transformImportToLess(node, cache);
  }
  throw new Error(`Expected StyleImport node, got ${node.type}`);
});

transformers.set('Extend', (node, cache) => {
  if (isExtend(node)) {
    return transformExtendToLess(node, cache);
  }
  throw new Error(`Expected Extend node, got ${node.type}`);
});

transformers.set('Condition', (node, cache) => {
  if (isCondition(node)) {
    return transformConditionToLess(node, cache);
  }
  throw new Error(`Expected Condition node, got ${node.type}`);
});

transformers.set('Paren', (node, cache) => {
  if (isParen(node)) {
    return transformParenToLess(node, cache);
  }
  throw new Error(`Expected Paren node, got ${node.type}`);
});

transformers.set('Negative', (node, cache) => {
  if (isNegative(node)) {
    return transformNegativeToLess(node, cache);
  }
  throw new Error(`Expected Negative node, got ${node.type}`);
});

transformers.set('List', (node, cache) => {
  if (isList(node)) {
    return transformListToLess(node, cache);
  }
  throw new Error(`Expected List node, got ${node.type}`);
});

transformers.set('VarDeclaration', (node, cache) => {
  if (isVarDeclaration(node)) {
    return transformVarDeclarationToLess(node, cache);
  }
  throw new Error(`Expected VarDeclaration node, got ${node.type}`);
});

transformers.set('Keyword', (node, cache) => {
  if (isKeyword(node)) {
    return transformKeywordToLess(node, cache);
  }
  throw new Error(`Expected Keyword node, got ${node.type}`);
});

transformers.set('Combinator', (node, cache) => {
  if (isCombinator(node)) {
    return transformCombinatorToLess(node, cache);
  }
  throw new Error(`Expected Combinator node, got ${node.type}`);
});

transformers.set('AttributeSelector', (node, cache) => {
  if (isAttributeSelector(node)) {
    return transformAttributeSelectorToLess(node, cache);
  }
  throw new Error(`Expected AttributeSelector node, got ${node.type}`);
});

transformers.set('Call', (node, cache) => {
  if (isCall(node)) {
    return transformCallToLess(node, cache);
  }
  throw new Error(`Expected Call node, got ${node.type}`);
});

// Selector types
transformers.set('SelectorList', (node, cache) => {
  if (isSelector(node)) {
    return transformSelectorToLess(node, cache);
  }
  throw new Error(`Expected Selector node, got ${node.type}`);
});

transformers.set('ComplexSelector', (node, cache) => {
  if (isSelector(node)) {
    return transformSelectorToLess(node, cache);
  }
  throw new Error(`Expected Selector node, got ${node.type}`);
});

transformers.set('CompoundSelector', (node, cache) => {
  if (isSelector(node)) {
    return transformSelectorToLess(node, cache);
  }
  throw new Error(`Expected Selector node, got ${node.type}`);
});

transformers.set('BasicSelector', (node, cache) => {
  if (isSelector(node)) {
    return transformSelectorToLess(node, cache);
  }
  throw new Error(`Expected Selector node, got ${node.type}`);
});

transformers.set('Reference', (node, cache) => {
  if (isReference(node)) {
    return transformReferenceToLess(node, cache);
  }
  throw new Error(`Expected Reference node, got ${node.type}`);
});

/**
 * Get the transformer for a Jess node type
 */
export function getTransformer(nodeType: string): NodeTransformer | undefined {
  return transformers.get(nodeType);
}

/**
 * Check if a transformer exists for a node type
 */
export function hasTransformer(nodeType: string): boolean {
  return transformers.has(nodeType);
}

/**
 * Register a new transformer
 */
export function registerTransformer(
  nodeType: string,
  transformer: NodeTransformer
): void {
  transformers.set(nodeType, transformer);
}
