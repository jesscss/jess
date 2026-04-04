import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { Compiler } from '../../jess/lib/index.js';
import lessPlugin from '../../jess-plugin-less/lib/index.js';
import { lessCompatPlugin } from '../../jess-plugin-less-compat/lib/index.js';
import { Node, Rules } from '../lib/index.js';

const require = createRequire(import.meta.url);
const testDataRoot = path.dirname(require.resolve('@less/test-data'));

type Mode = 'edge-state' | 'clone-surrogate';

type OperationCounts = {
  clone: number;
  placementWrappers: number;
  shallowWrappers: number;
  registerNode: number;
  connectSharedChildren: number;
};

type ScenarioResult = {
  css: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
  counts: OperationCounts;
};

function makeCompiler(): Compiler {
  return new Compiler({
    output: { collapseNesting: true },
    compile: {
      plugins: [
        lessPlugin(),
        lessCompatPlugin()
      ]
    }
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function totalMaterialization(counts: OperationCounts): number {
  return counts.clone
    + counts.placementWrappers
    + counts.shallowWrappers
    + counts.registerNode
    + counts.connectSharedChildren;
}

async function withOperationCounters<T>(
  fn: () => Promise<T>
): Promise<{ result: T; counts: OperationCounts }> {
  const counts: OperationCounts = {
    clone: 0,
    placementWrappers: 0,
    shallowWrappers: 0,
    registerNode: 0,
    connectSharedChildren: 0
  };

  const nodeProto = Node.prototype as Node & {
    clone: (...args: unknown[]) => unknown;
  };
  const rulesProto = Rules.prototype as Rules & {
    createPlacementWrapperWithChildren: (...args: unknown[]) => unknown;
    createShallowBodyWrapper: (...args: unknown[]) => unknown;
    registerNode: (...args: unknown[]) => unknown;
    _connectSharedChildren: (...args: unknown[]) => unknown;
  };

  const originalClone = nodeProto.clone;
  const originalCreatePlacementWrapperWithChildren = rulesProto.createPlacementWrapperWithChildren;
  const originalCreateShallowBodyWrapper = rulesProto.createShallowBodyWrapper;
  const originalRegisterNode = rulesProto.registerNode;
  const originalConnectSharedChildren = rulesProto._connectSharedChildren;

  nodeProto.clone = function(this: Node, ...args: unknown[]) {
    counts.clone++;
    return originalClone.apply(this, args);
  };
  rulesProto.createPlacementWrapperWithChildren = function(this: Rules, ...args: unknown[]) {
    counts.placementWrappers++;
    return originalCreatePlacementWrapperWithChildren.apply(this, args);
  };
  rulesProto.createShallowBodyWrapper = function(this: Rules, ...args: unknown[]) {
    counts.shallowWrappers++;
    return originalCreateShallowBodyWrapper.apply(this, args);
  };
  rulesProto.registerNode = function(this: Rules, ...args: unknown[]) {
    counts.registerNode++;
    return originalRegisterNode.apply(this, args);
  };
  rulesProto._connectSharedChildren = function(this: Rules, ...args: unknown[]) {
    counts.connectSharedChildren++;
    return originalConnectSharedChildren.apply(this, args);
  };

  try {
    const result = await fn();
    return { result, counts };
  } finally {
    nodeProto.clone = originalClone;
    rulesProto.createPlacementWrapperWithChildren = originalCreatePlacementWrapperWithChildren;
    rulesProto.createShallowBodyWrapper = originalCreateShallowBodyWrapper;
    rulesProto.registerNode = originalRegisterNode;
    rulesProto._connectSharedChildren = originalConnectSharedChildren;
  }
}

async function compileScenario(
  compiler: Compiler,
  filePath: string,
  mode: Mode
): Promise<string> {
  const internalCompiler = compiler as Compiler & {
    prepareRender: (filePath: string, options?: unknown) => Promise<{ context: any; profile: unknown }>;
    evaluateInput: (context: any, input: { filePath: string }, profile?: unknown) => Promise<any>;
    renderTree: (tree: any, context: any, profile?: unknown) => string;
  };
  const { context, profile } = await internalCompiler.prepareRender(filePath);

  if (mode === 'clone-surrogate') {
    const originalGetTree = context.getTree.bind(context);
    context.getTree = async (importPath: string, importOptions?: unknown) => {
      const loaded = await originalGetTree(importPath, importOptions);
      const clonedNode = loaded.node.clone(true, undefined, context);
      return {
        ...loaded,
        node: clonedNode
      };
    };
  }

  const tree = await internalCompiler.evaluateInput(context, { filePath }, profile);
  return internalCompiler.renderTree(tree, context, profile);
}

async function characterizeFixture(
  fixtureRelativePath: string,
  iterations: number = 5
): Promise<{
  edgeState: ScenarioResult;
  cloneSurrogate: ScenarioResult;
}> {
  const filePath = path.join(testDataRoot, fixtureRelativePath);

  const runMode = async (mode: Mode): Promise<ScenarioResult> => {
    const compiler = makeCompiler();
    const warmCss = await compileScenario(compiler, filePath, mode);

    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await compileScenario(compiler, filePath, mode);
      times.push(performance.now() - start);
    }

    const { result: css, counts } = await withOperationCounters(
      () => compileScenario(compiler, filePath, mode)
    );

    expect(css).toBe(warmCss);

    return {
      css,
      medianMs: median(times),
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
      counts
    };
  };

  const edgeState = await runMode('edge-state');
  const cloneSurrogate = await runMode('clone-surrogate');
  return { edgeState, cloneSurrogate };
}

describe('Eval Model Characterization', () => {
  it('shows clone-surrogate creates more materialization on guarded-mixin-heavy input', async () => {
    if (!process.env.HEAVY_PERF) {
      console.log('skipped eval-model characterization (set HEAVY_PERF=1 to run)');
      return;
    }

    const fixture = 'tests-unit/mixins-guards/mixins-guards.less';
    const { edgeState, cloneSurrogate } = await characterizeFixture(fixture);

    expect(cloneSurrogate.css).toBe(edgeState.css);
    expect(cloneSurrogate.counts.clone).toBeGreaterThan(edgeState.counts.clone);
    expect(totalMaterialization(cloneSurrogate.counts)).toBeGreaterThan(totalMaterialization(edgeState.counts));

    console.log(`\nEval model characterization: ${fixture}`);
    console.log(`  edge-state:      median=${edgeState.medianMs.toFixed(2)}ms min=${edgeState.minMs.toFixed(2)}ms max=${edgeState.maxMs.toFixed(2)}ms`);
    console.log(`  clone-surrogate: median=${cloneSurrogate.medianMs.toFixed(2)}ms min=${cloneSurrogate.minMs.toFixed(2)}ms max=${cloneSurrogate.maxMs.toFixed(2)}ms`);
    console.log(`  speed ratio:     x${(cloneSurrogate.medianMs / edgeState.medianMs).toFixed(2)} slower`);
    console.log(`  edge-state ops:  ${JSON.stringify(edgeState.counts)}`);
    console.log(`  clone ops:       ${JSON.stringify(cloneSurrogate.counts)}`);
  }, 120_000);

  it('shows clone-before-eval is not semantically faithful on graph-sensitive import/reference input', async () => {
    if (!process.env.HEAVY_PERF) {
      console.log('skipped eval-model characterization (set HEAVY_PERF=1 to run)');
      return;
    }

    const fixture = 'tests-unit/import/import-reference.less';
    const { edgeState, cloneSurrogate } = await characterizeFixture(fixture);

    expect(cloneSurrogate.counts.clone).toBeGreaterThan(edgeState.counts.clone);
    expect(totalMaterialization(cloneSurrogate.counts)).toBeGreaterThan(totalMaterialization(edgeState.counts));
    expect(cloneSurrogate.css).not.toBe(edgeState.css);

    console.log(`\nEval model characterization: ${fixture}`);
    console.log('  semantic parity: broken under clone-surrogate');
    console.log(`  edge-state:      median=${edgeState.medianMs.toFixed(2)}ms min=${edgeState.minMs.toFixed(2)}ms max=${edgeState.maxMs.toFixed(2)}ms`);
    console.log(`  clone-surrogate: median=${cloneSurrogate.medianMs.toFixed(2)}ms min=${cloneSurrogate.minMs.toFixed(2)}ms max=${cloneSurrogate.maxMs.toFixed(2)}ms`);
    console.log(`  edge-state ops:  ${JSON.stringify(edgeState.counts)}`);
    console.log(`  clone ops:       ${JSON.stringify(cloneSurrogate.counts)}`);
  }, 120_000);
});
