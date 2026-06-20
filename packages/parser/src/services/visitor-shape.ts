import type { IslandKind } from '../profiles/index.js';
import type { StructuralNode } from '../structure/index.js';
import type { IslandTargetShape, VisitorMaterializationRule, VisitorShape } from './types.js';

/** Visitor method table derived without walking or materializing AST nodes. */
export type VisitorMethodTable = {
  readonly methodNames: readonly string[];
  readonly nodeKinds: readonly StructuralNode['kind'][];
  readonly islandKinds: readonly IslandKind[];
  readonly materializationRules: readonly VisitorMaterializationRule[];
  readonly targetShape: IslandTargetShape;
};

/** Cache stats for visitor method-table planning. */
export type VisitorMethodTableCacheStats = {
  readonly hits: number;
  readonly misses: number;
};

/**
 * Caches visitor method analysis by visitor object identity.
 *
 * Parser services only need to know which structural nodes/islands a visitor
 * can observe. Adapter layers still own the eventual visitor object and node
 * shape, so this cache does not freeze Less or Jess plugin visitor APIs.
 */
export class VisitorMethodTableCache {
  #cache = new WeakMap<object, Map<IslandTargetShape, VisitorMethodTable>>();
  #hits = 0;
  #misses = 0;

  /** Returns a cached method table, deriving it once for each visitor object. */
  get(visitor: object, targetShape: IslandTargetShape = 'visitor'): VisitorMethodTable {
    const cachedByTarget = this.#cache.get(visitor);
    const cached = cachedByTarget?.get(targetShape);
    if (cached) {
      this.#hits++;
      return cached;
    }

    this.#misses++;
    const table = deriveVisitorMethodTable(visitor, targetShape);
    if (cachedByTarget) {
      cachedByTarget.set(targetShape, table);
    } else {
      this.#cache.set(visitor, new Map([[targetShape, table]]));
    }
    return table;
  }

  /** Reports cache behavior without exposing the WeakMap. */
  stats(): VisitorMethodTableCacheStats {
    return { hits: this.#hits, misses: this.#misses };
  }
}

const defaultVisitorMethodTableCache = new VisitorMethodTableCache();

/** Derives a structural visitor shape from registered visitor methods. */
export function visitorShapeFromMethods(
  visitor: object,
  targetShape: IslandTargetShape = 'visitor'
): VisitorShape {
  const table = defaultVisitorMethodTableCache.get(visitor, targetShape);
  return {
    nodeKinds: table.nodeKinds,
    islandKinds: table.islandKinds,
    materializationRules: table.materializationRules,
    targetShape: table.targetShape
  };
}

/**
 * Builds a reusable method table behind `visitorShapeFromMethods`.
 *
 * Generic `visit(node)` means the visitor may observe any reached adapter
 * surface, but traversal still requests islands only as matching structural
 * nodes are reached.
 */
export function deriveVisitorMethodTable(
  visitor: object,
  targetShape: IslandTargetShape = 'visitor'
): VisitorMethodTable {
  const methodNames = visitorMethodNames(visitor);
  const nodeKinds = new Set<StructuralNode['kind']>();
  const islandKinds = new Set<IslandKind>();
  const materializationRuleKeys = new Set<string>();
  const materializationRules: VisitorMaterializationRule[] = [];

  for (const methodName of methodNames) {
    const rule = VISITOR_METHOD_RULES[methodName];
    if (!rule) {
      continue;
    }
    addMethodRule(rule, nodeKinds, islandKinds, materializationRules, materializationRuleKeys, targetShape);
  }

  if (methodNames.includes('visit')) {
    addMethodRule(
      {
        nodeKinds: BROAD_VISITOR_NODE_KINDS,
        islandKinds: BROAD_VISITOR_ISLAND_KINDS
      },
      nodeKinds,
      islandKinds,
      materializationRules,
      materializationRuleKeys,
      targetShape
    );
  }

  return {
    methodNames,
    nodeKinds: [...nodeKinds],
    islandKinds: [...islandKinds],
    materializationRules,
    targetShape
  };
}

function visitorMethodNames(visitor: object): readonly string[] {
  const names = new Set<string>();
  let cursor: object | null = visitor;
  const callable = visitor as Record<string, unknown>;

  while (cursor && cursor !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(cursor)) {
      if (key !== 'constructor' && typeof callable[key] === 'function') {
        names.add(key);
      }
    }
    cursor = Object.getPrototypeOf(cursor);
  }

  return [...names].sort();
}

type MethodRule = {
  nodeKinds: readonly StructuralNode['kind'][];
  islandKinds: readonly IslandKind[];
};

function addMethodRule(
  rule: MethodRule,
  nodeKinds: Set<StructuralNode['kind']>,
  islandKinds: Set<IslandKind>,
  materializationRules: VisitorMaterializationRule[],
  materializationRuleKeys: Set<string>,
  targetShape: IslandTargetShape
): void {
  for (const nodeKind of rule.nodeKinds) {
    nodeKinds.add(nodeKind);
    const key = `${nodeKind}|${rule.islandKinds.join(',')}|${targetShape}`;
    if (!materializationRuleKeys.has(key)) {
      materializationRuleKeys.add(key);
      materializationRules.push({
        nodeKind,
        islandKinds: rule.islandKinds,
        targetShape
      });
    }
  }
  for (const islandKind of rule.islandKinds) {
    islandKinds.add(islandKind);
  }
}

function addVisitorMethodAliases(
  aliases: readonly string[],
  rule: MethodRule
): void {
  for (const alias of aliases) {
    VISITOR_METHOD_RULES[alias] = rule;
  }
}

const VISITOR_METHOD_RULES: Record<string, MethodRule> = {
  atRule: { nodeKinds: ['at-rule', 'import'], islandKinds: ['at-rule-prelude'] },
  atRuleExit: { nodeKinds: ['at-rule', 'import'], islandKinds: ['at-rule-prelude'] },
  condition: { nodeKinds: ['rule', 'at-rule'], islandKinds: ['control-condition'] },
  conditionExit: { nodeKinds: ['rule', 'at-rule'], islandKinds: ['control-condition'] },
  declaration: { nodeKinds: ['declaration'], islandKinds: ['declaration-value'] },
  declarationExit: { nodeKinds: ['declaration'], islandKinds: ['declaration-value'] },
  customDeclaration: { nodeKinds: ['declaration'], islandKinds: ['declaration-value'] },
  customDeclarationExit: { nodeKinds: ['declaration'], islandKinds: ['declaration-value'] },
  extend: { nodeKinds: ['rule'], islandKinds: ['extend-candidate'] },
  extendExit: { nodeKinds: ['rule'], islandKinds: ['extend-candidate'] },
  mixin: { nodeKinds: ['mixin-definition', 'mixin-call'], islandKinds: ['mixin-definition', 'mixin-call'] },
  mixinExit: { nodeKinds: ['mixin-definition', 'mixin-call'], islandKinds: ['mixin-definition', 'mixin-call'] },
  reference: { nodeKinds: ['declaration', 'variable-declaration'], islandKinds: ['variable-reference'] },
  referenceExit: { nodeKinds: ['declaration', 'variable-declaration'], islandKinds: ['variable-reference'] },
  rules: { nodeKinds: ['document', 'rule', 'at-rule', 'mixin-definition'], islandKinds: [] },
  rulesExit: { nodeKinds: ['document', 'rule', 'at-rule', 'mixin-definition'], islandKinds: [] },
  ruleset: { nodeKinds: ['rule'], islandKinds: ['selector'] },
  rulesetExit: { nodeKinds: ['rule'], islandKinds: ['selector'] },
  selectorList: { nodeKinds: ['rule'], islandKinds: ['selector'] },
  selectorListExit: { nodeKinds: ['rule'], islandKinds: ['selector'] },
  styleImport: { nodeKinds: ['import'], islandKinds: ['at-rule-prelude'] },
  styleImportExit: { nodeKinds: ['import'], islandKinds: ['at-rule-prelude'] },
  varDeclaration: { nodeKinds: ['variable-declaration'], islandKinds: ['declaration-value'] },
  varDeclarationExit: { nodeKinds: ['variable-declaration'], islandKinds: ['declaration-value'] }
};

const atRuleMethodRule = VISITOR_METHOD_RULES.atRule!;
const declarationMethodRule = VISITOR_METHOD_RULES.declaration!;
const mixinMethodRule = VISITOR_METHOD_RULES.mixin!;
const referenceMethodRule = VISITOR_METHOD_RULES.reference!;
const rulesetMethodRule = VISITOR_METHOD_RULES.ruleset!;

addVisitorMethodAliases(
  ['visitAtRule', 'visitAtRuleOut', 'visitDirective', 'visitDirectiveOut'],
  atRuleMethodRule
);
addVisitorMethodAliases(
  ['visitDeclaration', 'visitDeclarationOut', 'visitRule', 'visitRuleOut'],
  declarationMethodRule
);
addVisitorMethodAliases(
  ['visitElement', 'visitElementOut', 'visitRuleset', 'visitRulesetOut', 'visitSelector', 'visitSelectorOut'],
  rulesetMethodRule
);
addVisitorMethodAliases(
  ['visitMixinDefinition', 'visitMixinDefinitionOut', 'visitMixinCall', 'visitMixinCallOut'],
  mixinMethodRule
);
addVisitorMethodAliases(
  ['visitReference', 'visitReferenceOut', 'visitVariable', 'visitVariableOut'],
  referenceMethodRule
);

const VALUE_METHODS = [
  'any',
  'anonymous',
  'call',
  'collection',
  'color',
  'dimension',
  'expression',
  'func',
  'interpolated',
  'list',
  'negative',
  'operation',
  'paren',
  'quoted',
  'sequence'
];

for (const method of VALUE_METHODS) {
  const rule: MethodRule = {
    nodeKinds: ['declaration', 'variable-declaration'],
    islandKinds: ['declaration-value', 'variable-reference', 'interpolation']
  };
  VISITOR_METHOD_RULES[method] = rule;
  VISITOR_METHOD_RULES[`${method}Exit`] = rule;
  VISITOR_METHOD_RULES[`visit${method[0]!.toUpperCase()}${method.slice(1)}`] = rule;
  VISITOR_METHOD_RULES[`visit${method[0]!.toUpperCase()}${method.slice(1)}Out`] = rule;
}

const BROAD_VISITOR_NODE_KINDS: readonly StructuralNode['kind'][] = [
  'at-rule',
  'declaration',
  'document',
  'import',
  'mixin-call',
  'mixin-definition',
  'rule',
  'variable-declaration'
];

const BROAD_VISITOR_ISLAND_KINDS: readonly IslandKind[] = [
  'at-rule-prelude',
  'control-condition',
  'declaration-value',
  'extend-candidate',
  'interpolation',
  'mixin-call',
  'mixin-definition',
  'selector',
  'variable-reference'
];
