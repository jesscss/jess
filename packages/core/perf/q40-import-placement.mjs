import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  Context,
  Node,
  StyleImport,
  getImportPlacementChildSegments
} from '../lib/index.js';
import { Compiler } from '../../jess/lib/index.js';
import lessPlugin from '../../jess-plugin-less/lib/index.js';
import { lessCompatPlugin } from '../../jess-plugin-less-compat/lib/index.js';

const scaleValues = [1, 2, 4, 8];
const rules = 500;
const samples = Number(process.env.Q40_SAMPLES ?? 8);
const warmup = Number(process.env.Q40_WARMUP ?? 3);
const mode = process.env.Q40_MODE ?? 'candidate';
const root = path.join('/private/tmp', `jess-q40-import-placement-${process.pid}`);

function makeTarget() {
  const out = [];
  for (let index = 0; index < rules; index++) {
    out.push(`.r${index}{a:${index}px;b:${index + 1}px;c:${index + 2}px;d:${index + 3}px}`);
  }
  return out.join('');
}

async function prepareFixture() {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'imp.less'), makeTarget());
  for (const scale of scaleValues) {
    await fs.writeFile(
      path.join(root, `main-${scale}x.less`),
      `${Array.from({ length: scale }, () => '@import (multiple) "imp.less";').join('\n')}\n`
    );
  }
}

function makeOptions() {
  return {
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  };
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p25Ms: percentile(sorted, 0.25),
    p75Ms: percentile(sorted, 0.75),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1]
  };
}

async function render(file) {
  const compiler = new Compiler(makeOptions());
  const start = performance.now();
  const css = await compiler.render(file);
  return { css, elapsedMs: performance.now() - start };
}

async function placementCounts(file) {
  const context = new Context({ output: { collapseNesting: true } }, [lessPlugin(), lessCompatPlugin()]);
  const parsed = await context.getTree(file);
  if (!parsed.node) {
    throw new Error(`Parse failed for ${file}`);
  }
  context.root = parsed.node;
  context.treeContext = parsed.node._treeContext;
  const imports = parsed.node.rules.filter(node => node instanceof StyleImport);
  let retainedStates = 0;
  let retainedSegments = 0;
  for (const importNode of imports) {
    const result = await importNode.resolveForSpine(context);
    if (result.kind !== 'fold') {
      throw new Error(`Expected folded import for ${file}`);
    }
    const segments = getImportPlacementChildSegments(result.body);
    if (segments) {
      retainedStates++;
      retainedSegments += segments.length;
    }
  }
  return {
    activations: imports.length,
    retainedStates,
    retainedArrays: retainedStates * 2,
    retainedSegmentRecords: retainedSegments
  };
}

await prepareFixture();
const cloneCounts = new Map();
const originalCloneForPlacement = Node.prototype.cloneForPlacement;
Node.prototype.cloneForPlacement = function countClone(...args) {
  const type = this.type ?? this.constructor?.name ?? 'unknown';
  cloneCounts.set(type, (cloneCounts.get(type) ?? 0) + 1);
  return originalCloneForPlacement.apply(this, args);
};

try {
  const results = [];
  for (const scale of scaleValues) {
    const file = path.join(root, `main-${scale}x.less`);
    const source = await fs.readFile(file, 'utf8');
    const expected = (await (await import('less')).default.render(source, { filename: file })).css;
    const first = await render(file);
    if (first.css !== expected) {
      throw new Error(`Less byte mismatch for ${scale}x`);
    }
    const placement = await placementCounts(file);
    for (let index = 0; index < warmup; index++) {
      await render(file);
    }
    const times = [];
    cloneCounts.clear();
    for (let index = 0; index < samples; index++) {
      const result = await render(file);
      if (result.css !== expected) {
        throw new Error(`Output changed during ${mode} ${scale}x run`);
      }
      times.push(result.elapsedMs);
    }
    results.push({
      scale,
      mode,
      exact: true,
      outputBytes: Buffer.byteLength(expected),
      placement,
      cloneForPlacement: Object.fromEntries(cloneCounts),
      timing: summarize(times)
    });
  }
  console.log(JSON.stringify({ mode, rules, samples, warmup, results }, null, 2));
} finally {
  Node.prototype.cloneForPlacement = originalCloneForPlacement;
  await fs.rm(root, { recursive: true, force: true });
}
