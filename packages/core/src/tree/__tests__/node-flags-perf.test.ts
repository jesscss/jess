import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  Node,
  F_STATIC,
  F_NON_STATIC,
  F_MAY_ASYNC,
  any,
  dimension,
  num,
  list,
  paren,
  expr,
  seq,
  decl,
  ref
} from '../index.js';
import { Context } from '../../context.js';
import { pipe } from '@jesscss/awaitable-pipe';

function fmt(ms: number) {
  return `${ms.toFixed(3)}ms`;
}

function buildStaticTree(depth: number, breadth: number): Node {
  if (depth === 0) {
    return any(`leaf`);
  }
  const children: Node[] = [];
  for (let i = 0; i < breadth; i++) {
    children.push(buildStaticTree(depth - 1, breadth));
  }
  return list(children);
}

function buildDeclTree(count: number, staticRatio: number = 1.0): Node[] {
  const decls: Node[] = [];
  for (let i = 0; i < count; i++) {
    if (i / count < staticRatio) {
      decls.push(
        decl({
          name: any(`prop-${i}`, { role: 'property' }),
          value: expr(any(`value-${i}`))
        })
      );
    } else {
      decls.push(
        decl({
          name: any(`prop-${i}`, { role: 'property' }),
          value: expr(ref({ key: any(`var-${i}`) }))
        })
      );
    }
  }
  return decls;
}

function evalStaticWithRegistrationPrep(node: Node, context: Context): any {
  let preparedNode: Node;

  return pipe(
    () => {
      if (!node.preEvaluated) {
        return node.prepareRegistration(context);
      }
      return node;
    },
    (prepared: Node) => {
      preparedNode = prepared;
      preparedNode.preEvaluated = true;
      if (prepared !== node) {
        preparedNode.inherit(node);
      }
      if (!preparedNode.evaluated) {
        return preparedNode['evalNode'](context);
      }
      return preparedNode;
    },
    (evald: Node) => {
      evald.evaluated = true;
      if (preparedNode !== evald) {
        evald.inherit(preparedNode);
      }
      return evald;
    }
  );
}

class RegistrationCountingNode extends Node<Node> {
  registrationCalls = 0;

  constructor(value: Node) {
    super(value);
    this.addFlag(F_NON_STATIC);
  }

  override prepareRegistration(context: Context): Node {
    this.registrationCalls++;
    const prepared = super.prepareRegistration(context);
    if (prepared instanceof Node) {
      return prepared;
    }
    throw new TypeError('Expected sync registration prep in test node');
  }
}

describe('Node Flags Performance', () => {
  it('should verify static trees have correct flags', () => {
    const tree = buildStaticTree(3, 4);
    expect(tree.hasFlag(F_STATIC)).toBe(true);
    expect(tree.hasFlag(F_MAY_ASYNC)).toBe(false);
    expect(tree.hasFlag(F_NON_STATIC)).toBe(false);
  });

  it('sync fast-path: static tree eval should be sync', () => {
    const context = new Context();
    const tree = buildStaticTree(4, 5);
    const result = Node.evalStatic(tree, context);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('base eval does not run registration prep as hidden eval setup', () => {
    const context = new Context();
    const node = new RegistrationCountingNode(any('leaf'));

    const result = Node.evalStatic(node, context);

    expect(result).toBe(node);
    expect(node.registrationCalls).toBe(0);
    expect(node.preEvaluated).toBe(true);
    expect(node.evaluated).toBe(true);
  });

  it('benchmark: optimized vs registration-prep evalStatic for static declarations', () => {
    const iterations = 1000;

    // Optimized path
    {
      const context = new Context();
      const declSets = Array.from({ length: iterations }, () => buildDeclTree(10, 1.0));
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (const d of declSets[i]!) {
          void Node.evalStatic(d, context);
        }
      }
      const optimized = performance.now() - start;
      console.log(`  Optimized: ${fmt(optimized)} for ${iterations * 10} static decls`);
    }

    // Registration-prep path (always uses pipe)
    {
      const context = new Context();
      const declSets = Array.from({ length: iterations }, () => buildDeclTree(10, 1.0));
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (const d of declSets[i]!) {
          void evalStaticWithRegistrationPrep(d, context);
        }
      }
      const legacy = performance.now() - start;
      console.log(`  With prep: ${fmt(legacy)} for ${iterations * 10} static decls`);
    }
  });

  it('benchmark: optimized vs registration-prep evalStatic for static trees', () => {
    const iterations = 200;

    // Optimized path
    {
      const context = new Context();
      const trees = Array.from({ length: iterations }, () => buildStaticTree(3, 5));
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        void Node.evalStatic(trees[i]!, context);
      }
      const optimized = performance.now() - start;
      console.log(`  Optimized: ${fmt(optimized)} for ${iterations} static trees (depth=3, breadth=5)`);
    }

    // Registration-prep path
    {
      const context = new Context();
      const trees = Array.from({ length: iterations }, () => buildStaticTree(3, 5));
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        void evalStaticWithRegistrationPrep(trees[i]!, context);
      }
      const legacy = performance.now() - start;
      console.log(`  With prep: ${fmt(legacy)} for ${iterations} static trees (depth=3, breadth=5)`);
    }
  });

  it('benchmark: re-eval already-evaluated static nodes should be near-zero', () => {
    const context = new Context();
    const tree = buildStaticTree(4, 5);

    void Node.evalStatic(tree, context);

    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      void Node.evalStatic(tree, context);
    }
    const elapsed = performance.now() - start;

    console.log(`  Re-eval static tree: ${fmt(elapsed)} for ${iterations} calls (${fmt(elapsed / iterations)}/call)`);
    expect(elapsed).toBeLessThan(100);
  });

  it('flag propagation: count nodes with correct flags in a large tree', () => {
    const tree = buildStaticTree(4, 5);
    let staticCount = 0;
    let totalCount = 0;
    for (const node of tree.nodes()) {
      totalCount++;
      if (node.hasFlag(F_STATIC)) {
        staticCount++;
      }
    }
    console.log(`  Flag coverage: ${staticCount}/${totalCount} nodes are F_STATIC (${(staticCount / totalCount * 100).toFixed(1)}%)`);
    expect(staticCount).toBe(totalCount);
  });
});
