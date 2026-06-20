import { describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../src/index.js';
import {
  getTestCases,
  lessHarnessFunctionsPlugin,
  lessTestDataAdditionalSkips,
  lessTestDataForcedIncludes,
  resolveLessTestDataRoot,
  type TestCase
} from './test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

type CorpusCase = {
  file: string;
  lessPath: string;
  testCase: TestCase;
  index: number;
  total: number;
};

type CorpusMetrics = {
  files: number;
  cases: number;
  structuralFed: number;
  canonicalFallback: number;
  currentExpectedFailures: number;
  structuralExpectedFailures: number;
  fallbackReasons: Record<string, number>;
  actualParses: number;
  promotedBytes: number;
  requestedIslands: number;
  durationMs: number;
};

type BenchmarkMode = 'current' | 'structural-only' | 'selected-materialization' | 'structural-fed';

type BenchmarkModeMetrics = {
  renders: number;
  durationMs: number;
  probeRecords: number;
  prototypeRecords: number;
  structuralFed: number;
  canonicalFallback: number;
  requestedIslands: number;
  actualParses: number;
  promotedBytes: number;
  fallbackFullTreeMaterializations: number;
};

const benchmarkModes: BenchmarkMode[] = [
  'current',
  'structural-only',
  'selected-materialization',
  'structural-fed'
];
const testData = resolveLessTestDataRoot();
const corpusCases = collectCorpusCases();

describe('scanner-first structural-fed Less corpus parity audit', () => {
  it('matches current compiler output across the included upstream Less fixture corpus', async () => {
    const metrics: CorpusMetrics = {
      files: new Set(corpusCases.map(testCase => testCase.file)).size,
      cases: corpusCases.length,
      structuralFed: 0,
      canonicalFallback: 0,
      currentExpectedFailures: 0,
      structuralExpectedFailures: 0,
      fallbackReasons: {},
      actualParses: 0,
      promotedBytes: 0,
      requestedIslands: 0,
      durationMs: 0
    };
    const startedAt = nowMs();

    for (const corpusCase of corpusCases) {
      const probePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const currentCompiler = createCorpusCompiler(lessPlugin(), corpusCase.testCase);
      const testCompiler = createCorpusCompiler(probePlugin, corpusCase.testCase);
      const expectedCss = readFileSync(corpusCase.testCase.expectedFile, 'utf8');
      const currentResult = await currentCompiler.renderToResult(corpusCase.lessPath, {
        outputFile: corpusCase.testCase.expectedFile
      });
      const result = await testCompiler.renderToResult(corpusCase.lessPath, {
        outputFile: corpusCase.testCase.expectedFile
      });

      if (currentResult.css !== expectedCss) {
        metrics.currentExpectedFailures++;
      }
      if (result.css !== expectedCss) {
        metrics.structuralExpectedFailures++;
      }
      expect(result.css, `${corpusLabel(corpusCase)} structural-fed parity`).toBe(currentResult.css);

      const prototypes = probePlugin.scannerFirstPrototypeResults;
      expect(prototypes.length, corpusLabel(corpusCase)).toBeGreaterThan(0);
      if (prototypes.length === 0) {
        continue;
      }
      for (const probe of prototypes) {
        if (probe.runtimeTreeSource === 'structural-fed') {
          metrics.structuralFed++;
        } else {
          metrics.canonicalFallback++;
          increment(metrics.fallbackReasons, probe.fallbackReason ?? 'unknown');
        }
        metrics.actualParses += probe.actualParses;
        metrics.promotedBytes += probe.promotedBytes;
        metrics.requestedIslands += probe.requestedIslands;
      }
    }

    metrics.durationMs = nowMs() - startedAt;
    expect(metrics.cases).toBeGreaterThan(0);
    expect(metrics.structuralFed + metrics.canonicalFallback).toBeGreaterThanOrEqual(metrics.cases);
    console.info(`[scanner-first-less-corpus] ${JSON.stringify(metrics)}`);
  }, 120_000);

  it('records benchmark smoke metrics for current and scanner-first modes across the included upstream Less fixture corpus', async () => {
    const metrics = new Map<BenchmarkMode, BenchmarkModeMetrics>(
      benchmarkModes.map(mode => [mode, createBenchmarkModeMetrics()])
    );
    const startedAt = nowMs();

    for (const corpusCase of corpusCases) {
      const renderedModes = new Map<BenchmarkMode, Awaited<ReturnType<typeof renderBenchmarkMode>>>();

      for (const mode of benchmarkModes) {
        renderedModes.set(mode, await renderBenchmarkMode(corpusCase, mode));
      }

      const current = renderedModes.get('current')!;
      for (const mode of benchmarkModes) {
        const rendered = renderedModes.get(mode)!;
        if (mode !== 'current') {
          expect(rendered.css, `${corpusLabel(corpusCase)} ${mode} benchmark parity`)
            .toBe(current.css);
        }
        recordBenchmarkMode(metrics.get(mode)!, rendered);
      }
    }

    const summary = {
      files: new Set(corpusCases.map(testCase => testCase.file)).size,
      cases: corpusCases.length,
      totalDurationMs: nowMs() - startedAt,
      modes: Object.fromEntries(metrics)
    };
    for (const mode of benchmarkModes) {
      const modeMetrics = metrics.get(mode)!;
      expect(modeMetrics.renders).toBe(corpusCases.length);
      expect(Number.isFinite(modeMetrics.durationMs)).toBe(true);
    }
    const structuralOnlyMetrics = metrics.get('structural-only')!;
    const selectedMaterializationMetrics = metrics.get('selected-materialization')!;
    const structuralFedMetrics = metrics.get('structural-fed')!;

    expect(structuralOnlyMetrics.probeRecords).toBeGreaterThanOrEqual(corpusCases.length);
    expect(structuralOnlyMetrics.actualParses).toBe(0);
    expect(structuralOnlyMetrics.fallbackFullTreeMaterializations).toBe(0);
    expect(selectedMaterializationMetrics.probeRecords).toBeGreaterThanOrEqual(corpusCases.length);
    expect(selectedMaterializationMetrics.actualParses).toBeGreaterThan(0);
    expect(structuralFedMetrics.prototypeRecords).toBeGreaterThanOrEqual(corpusCases.length);
    expect(structuralFedMetrics.structuralFed + structuralFedMetrics.canonicalFallback)
      .toBe(structuralFedMetrics.prototypeRecords);
    console.info(`[scanner-first-less-corpus-benchmark-smoke] ${JSON.stringify(summary)}`);
  }, 180_000);
});

async function renderBenchmarkMode(
  corpusCase: CorpusCase,
  mode: BenchmarkMode
): Promise<{
  css: string;
  durationMs: number;
  plugin: ReturnType<typeof lessPlugin>;
}> {
  const plugin = createBenchmarkPlugin(mode);
  const compiler = createCorpusCompiler(plugin, corpusCase.testCase);
  const startedAt = nowMs();
  const result = await compiler.renderToResult(corpusCase.lessPath, {
    outputFile: corpusCase.testCase.expectedFile
  });

  return {
    css: result.css,
    durationMs: nowMs() - startedAt,
    plugin
  };
}

function createBenchmarkPlugin(mode: BenchmarkMode): ReturnType<typeof lessPlugin> {
  switch (mode) {
    case 'structural-only':
      return lessPlugin({ scannerFirstProbe: true });
    case 'selected-materialization':
      return lessPlugin({
        scannerFirstProbe: {
          materializeIslandKinds: ['declaration-value', 'variable-reference', 'mixin-call', 'extend-candidate']
        }
      });
    case 'structural-fed':
      return lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
    case 'current':
      return lessPlugin();
  }
}

function createBenchmarkModeMetrics(): BenchmarkModeMetrics {
  return {
    renders: 0,
    durationMs: 0,
    probeRecords: 0,
    prototypeRecords: 0,
    structuralFed: 0,
    canonicalFallback: 0,
    requestedIslands: 0,
    actualParses: 0,
    promotedBytes: 0,
    fallbackFullTreeMaterializations: 0
  };
}

function recordBenchmarkMode(
  metrics: BenchmarkModeMetrics,
  rendered: {
    durationMs: number;
    plugin: ReturnType<typeof lessPlugin>;
  }
): void {
  metrics.renders++;
  metrics.durationMs += rendered.durationMs;

  for (const probe of rendered.plugin.scannerFirstProbes) {
    metrics.probeRecords++;
    metrics.requestedIslands += probe.requestedIslands;
    metrics.actualParses += probe.actualParses;
    metrics.promotedBytes += probe.promotedBytes;
    metrics.fallbackFullTreeMaterializations += probe.fallbackFullTreeMaterializations;
  }

  for (const prototype of rendered.plugin.scannerFirstPrototypeResults) {
    metrics.prototypeRecords++;
    metrics.requestedIslands += prototype.requestedIslands;
    metrics.actualParses += prototype.actualParses;
    metrics.promotedBytes += prototype.promotedBytes;
    metrics.fallbackFullTreeMaterializations += prototype.fallbackFullTreeMaterializations;
    if (prototype.runtimeTreeSource === 'structural-fed') {
      metrics.structuralFed++;
    } else {
      metrics.canonicalFallback++;
    }
  }
}

function collectCorpusCases(): CorpusCase[] {
  const unitFiles = glob.sync(path.join(testData, 'tests-unit/*/*.less'));
  const allFiles = [...unitFiles]
    .map(value => path.relative(testData, value))
    .filter(value => lessTestDataForcedIncludes.has(value) || !invalidLess.includes(value))
    .filter(value => !lessTestDataAdditionalSkips.includes(value))
    .filter(value => !value.startsWith('tests-unit/plugin-'))
    .sort();
  const cases: CorpusCase[] = [];

  for (const file of allFiles) {
    const lessPath = path.join(testData, file);
    const testCases = getTestCases(lessPath);
    testCases.forEach((testCase, index) => {
      cases.push({
        file,
        lessPath,
        testCase,
        index,
        total: testCases.length
      });
    });
  }
  return cases;
}

function createCorpusCompiler(
  probePlugin: ReturnType<typeof lessPlugin>,
  testCase: TestCase
): Compiler {
  const testCompileConfig = testCase.config.compile || {};
  const {
    plugins: testCasePlugins = [],
    ...restCompileConfig
  } = testCompileConfig;

  return new Compiler({
    ...testCase.config,
    compile: {
      ...restCompileConfig,
      plugins: [
        probePlugin,
        lessCompatPlugin({
          plugins: [lessHarnessFunctionsPlugin]
        }),
        ...testCasePlugins
      ]
    },
    output: {
      collapseNesting: true,
      ...(testCase.config.output || {})
    }
  });
}

function corpusLabel(corpusCase: CorpusCase): string {
  const suffix = corpusCase.total > 1
    ? ` [${corpusCase.index + 1}/${corpusCase.total}] (${path.basename(corpusCase.testCase.expectedFile)})`
    : '';
  return `${corpusCase.file}${suffix}`;
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}
