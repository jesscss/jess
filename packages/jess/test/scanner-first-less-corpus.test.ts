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
import lessPlugin from '../../jess-plugin-less/src/index.js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { parseLessStructure } from '../../less-parser/src/index.js';

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
  progressiveNodes: number;
  durationMs: number;
};

type CorpusFallbackDetail = {
  label: string;
  reason: string;
};

type BenchmarkMode = 'current' | 'structural-sidecar' | 'selected-materialization' | 'structural-fed';

type BenchmarkModeMetrics = {
  renders: number;
  durationMs: number;
  sampleDurationsMs: number[];
  probeRecords: number;
  prototypeRecords: number;
  structuralFed: number;
  canonicalFallback: number;
  requestedIslands: number;
  actualParses: number;
  promotedBytes: number;
  progressiveNodes: number;
  fallbackFullTreeMaterializations: number;
};

const benchmarkModes: BenchmarkMode[] = [
  'current',
  'structural-sidecar',
  'selected-materialization',
  'structural-fed'
];
const benchmarkWarmupRuns = 1;
const benchmarkSampleRuns = 3;
const structuralBenchmarkWarmupRuns = 5;
const structuralBenchmarkSampleRuns = 20;
const testData = resolveLessTestDataRoot();
const corpusCases = collectCorpusCases();
const lessBenchmarkPath = path.resolve(testData, '../less/benchmark/benchmark.less');
const less45BenchmarkReference = loadLess45BenchmarkReference('benchmark.less');
const less45BenchmarkLessMedianRenderMs = less45BenchmarkReference.renderMedianMs;
const structuralFedExpectedCssOverrides = new Set([
  'tests-unit/tailwind/tailwind.less'
]);

describe('scanner-first structural-fed Less corpus parity audit', () => {
  it('loads the Less 4.x benchmark reference used by scanner-first comparisons', () => {
    expect(less45BenchmarkReference.tag).toBe('v4.5.1');
    expect(less45BenchmarkReference.compilerVersion).toBe('4.5.0');
    expect(less45BenchmarkReference.file).toBe('benchmark.less');
    expect(less45BenchmarkReference.renderMedianMs).toBeGreaterThan(0);
    expect(less45BenchmarkReference.renderMedianMs).toBe(42.16);
  });

  it('keeps raw outer-structure parsing separate from full compiler sidecar timing', () => {
    const benchmarkSource = readFileSync(lessBenchmarkPath, 'utf8');
    const samples: number[] = [];
    let benchmarkDocument = parseLessStructure(lessBenchmarkPath, benchmarkSource);

    for (let run = 0; run < structuralBenchmarkWarmupRuns + structuralBenchmarkSampleRuns; run++) {
      const startedAt = nowMs();
      benchmarkDocument = parseLessStructure(lessBenchmarkPath, benchmarkSource);
      const durationMs = nowMs() - startedAt;
      if (run >= structuralBenchmarkWarmupRuns) {
        samples.push(durationMs);
      }
    }

    const corpusStartedAt = nowMs();
    let corpusSourceBytes = 0;
    let corpusStructuralRecords = 0;
    let corpusRawIslands = 0;
    let corpusDiagnostics = 0;
    for (const corpusCase of corpusCases) {
      const source = readFileSync(corpusCase.lessPath, 'utf8');
      const document = parseLessStructure(corpusCase.lessPath, source);
      const stats = document.stats();
      corpusSourceBytes += stats.sourceBytes;
      corpusStructuralRecords += stats.structuralRecords;
      corpusRawIslands += stats.rawIslands;
      corpusDiagnostics += stats.diagnostics;
    }

    const sortedSamples = [...samples].sort((a, b) => a - b);
    const benchmarkStats = benchmarkDocument.stats();
    const summary = {
      benchmarkFile: path.relative(path.resolve(testData, '..'), lessBenchmarkPath),
      benchmarkSourceBytes: benchmarkSource.length,
      warmupRuns: structuralBenchmarkWarmupRuns,
      sampleRuns: structuralBenchmarkSampleRuns,
      minMs: sortedSamples[0] ?? 0,
      medianMs: median(sortedSamples),
      maxMs: sortedSamples.at(-1) ?? 0,
      less45BenchmarkReference,
      structuralRecords: benchmarkStats.structuralRecords,
      rawIslands: benchmarkStats.rawIslands,
      triviaRanges: benchmarkStats.triviaRanges,
      diagnostics: benchmarkStats.diagnostics,
      corpusFiles: new Set(corpusCases.map(testCase => testCase.file)).size,
      corpusCases: corpusCases.length,
      corpusDurationMs: nowMs() - corpusStartedAt,
      corpusSourceBytes,
      corpusStructuralRecords,
      corpusRawIslands,
      corpusDiagnostics
    };

    expect(benchmarkStats.diagnostics).toBe(0);
    expect(benchmarkStats.structuralRecords).toBeGreaterThan(0);
    expect(benchmarkStats.rawIslands).toBeGreaterThan(0);
    expect(corpusStructuralRecords).toBeGreaterThan(0);
    expect(corpusRawIslands).toBeGreaterThan(0);
    console.info(`[scanner-first-less-raw-structure] ${JSON.stringify(summary)}`);
  });

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
      progressiveNodes: 0,
      durationMs: 0
    };
    const fallbackDetails: CorpusFallbackDetail[] = [];
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
      const structuralTargetCss = structuralFedExpectedCssOverrides.has(corpusCase.file)
        ? expectedCss
        : currentResult.css;
      expect(result.css, `${corpusLabel(corpusCase)} structural-fed parity`).toBe(structuralTargetCss);

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
          const reason = probe.fallbackReason ?? 'unknown';
          increment(metrics.fallbackReasons, reason);
          fallbackDetails.push({
            label: corpusLabel(corpusCase),
            reason
          });
        }
        metrics.actualParses += probe.actualParses;
        metrics.promotedBytes += probe.promotedBytes;
        metrics.requestedIslands += probe.requestedIslands;
        metrics.progressiveNodes += probe.progressiveNodes ?? 0;
      }
    }

    metrics.durationMs = nowMs() - startedAt;
    console.info(`[scanner-first-less-corpus] ${JSON.stringify(metrics)}`);
    if (process.env.JESS_SCANNER_FIRST_CORPUS_DETAILS === '1') {
      console.info(`[scanner-first-less-corpus-details] ${JSON.stringify(fallbackDetails)}`);
    }
    expect(metrics.cases).toBeGreaterThan(0);
    expect(metrics.structuralFed + metrics.canonicalFallback).toBeGreaterThanOrEqual(metrics.cases);
    expect(metrics.structuralFed).toBeGreaterThan(0);
    expect(metrics.requestedIslands).toBe(0);
    expect(metrics.actualParses).toBe(0);
    expect(metrics.promotedBytes).toBe(0);
  }, 120_000);

  it('records benchmark smoke metrics for current and scanner-first modes across the included upstream Less fixture corpus', async () => {
    const metrics = new Map<BenchmarkMode, BenchmarkModeMetrics>(
      benchmarkModes.map(mode => [mode, createBenchmarkModeMetrics()])
    );
    const startedAt = nowMs();

    for (let run = 0; run < benchmarkWarmupRuns + benchmarkSampleRuns; run++) {
      const recordRun = run >= benchmarkWarmupRuns;
      const runDurations = new Map<BenchmarkMode, number>(
        benchmarkModes.map(mode => [mode, 0])
      );

      for (const corpusCase of corpusCases) {
        const renderedModes = new Map<BenchmarkMode, Awaited<ReturnType<typeof renderBenchmarkMode>>>();

        for (const mode of benchmarkModes) {
          const rendered = await renderBenchmarkMode(corpusCase, mode);
          renderedModes.set(mode, rendered);
          runDurations.set(mode, runDurations.get(mode)! + rendered.durationMs);
        }

        const current = renderedModes.get('current')!;
        for (const mode of benchmarkModes) {
          const rendered = renderedModes.get(mode)!;
          if (mode !== 'current') {
            const targetCss = mode === 'structural-fed' && structuralFedExpectedCssOverrides.has(corpusCase.file)
              ? readFileSync(corpusCase.testCase.expectedFile, 'utf8')
              : current.css;
            expect(rendered.css, `${corpusLabel(corpusCase)} ${mode} benchmark parity`)
              .toBe(targetCss);
          }
          if (recordRun) {
            recordBenchmarkMode(metrics.get(mode)!, rendered);
          }
        }
      }

      if (recordRun) {
        for (const mode of benchmarkModes) {
          metrics.get(mode)!.sampleDurationsMs.push(runDurations.get(mode)!);
        }
      }
    }

    const summary = {
      files: new Set(corpusCases.map(testCase => testCase.file)).size,
      cases: corpusCases.length,
      warmupRuns: benchmarkWarmupRuns,
      sampleRuns: benchmarkSampleRuns,
      totalDurationMs: nowMs() - startedAt,
      modes: Object.fromEntries(
        [...metrics].map(([mode, modeMetrics]) => [mode, summarizeBenchmarkMode(modeMetrics)])
      )
    };
    for (const mode of benchmarkModes) {
      const modeMetrics = metrics.get(mode)!;
      const modeSummary = summarizeBenchmarkMode(modeMetrics);
      expect(modeMetrics.renders).toBe(corpusCases.length * benchmarkSampleRuns);
      expect(Number.isFinite(modeMetrics.durationMs)).toBe(true);
      expect(modeMetrics.sampleDurationsMs).toHaveLength(benchmarkSampleRuns);
      expect(modeSummary.less45MedianRenderRatio).toBeGreaterThan(0);
    }
    const structuralSidecarMetrics = metrics.get('structural-sidecar')!;
    const selectedMaterializationMetrics = metrics.get('selected-materialization')!;
    const structuralFedMetrics = metrics.get('structural-fed')!;

    expect(structuralSidecarMetrics.probeRecords).toBeGreaterThanOrEqual(corpusCases.length * benchmarkSampleRuns);
    expect(structuralSidecarMetrics.actualParses).toBe(0);
    expect(structuralSidecarMetrics.fallbackFullTreeMaterializations).toBe(0);
    expect(selectedMaterializationMetrics.probeRecords).toBeGreaterThanOrEqual(corpusCases.length * benchmarkSampleRuns);
    expect(selectedMaterializationMetrics.actualParses).toBeGreaterThan(0);
    expect(structuralFedMetrics.prototypeRecords).toBeGreaterThanOrEqual(corpusCases.length * benchmarkSampleRuns);
    expect(structuralFedMetrics.structuralFed + structuralFedMetrics.canonicalFallback)
      .toBe(structuralFedMetrics.prototypeRecords);
    expect(structuralFedMetrics.structuralFed).toBeGreaterThan(0);
    expect(structuralFedMetrics.requestedIslands).toBe(0);
    expect(structuralFedMetrics.actualParses).toBe(0);
    expect(structuralFedMetrics.promotedBytes).toBe(0);
    expectBenchmarkOverheadWithinSmokeLimit('structural-sidecar', metrics, 5);
    expectBenchmarkOverheadWithinSmokeLimit('selected-materialization', metrics, 10);
    expectBenchmarkOverheadWithinSmokeLimit('structural-fed', metrics, 5);
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
    case 'structural-sidecar':
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
    sampleDurationsMs: [],
    probeRecords: 0,
    prototypeRecords: 0,
    structuralFed: 0,
    canonicalFallback: 0,
    requestedIslands: 0,
    actualParses: 0,
    promotedBytes: 0,
    progressiveNodes: 0,
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
    metrics.progressiveNodes += prototype.progressiveNodes ?? 0;
    metrics.fallbackFullTreeMaterializations += prototype.fallbackFullTreeMaterializations;
    if (prototype.runtimeTreeSource === 'structural-fed') {
      metrics.structuralFed++;
    } else {
      metrics.canonicalFallback++;
    }
  }
}

function summarizeBenchmarkMode(metrics: BenchmarkModeMetrics): BenchmarkModeMetrics & {
  minSampleDurationMs: number;
  medianSampleDurationMs: number;
  maxSampleDurationMs: number;
  less45MedianRenderRatio: number;
} {
  const sortedSamples = [...metrics.sampleDurationsMs].sort((a, b) => a - b);
  const medianSampleDurationMs = median(sortedSamples);
  return {
    ...metrics,
    minSampleDurationMs: sortedSamples[0] ?? 0,
    medianSampleDurationMs,
    maxSampleDurationMs: sortedSamples.at(-1) ?? 0,
    less45MedianRenderRatio: medianSampleDurationMs / less45BenchmarkLessMedianRenderMs
  };
}

function expectBenchmarkOverheadWithinSmokeLimit(
  mode: Exclude<BenchmarkMode, 'current'>,
  metrics: Map<BenchmarkMode, BenchmarkModeMetrics>,
  maxRatio: number
): void {
  const currentMedian = median(metrics.get('current')!.sampleDurationsMs);
  const modeMedian = median(metrics.get(mode)!.sampleDurationsMs);
  expect(
    modeMedian,
    `${mode} median corpus render time should stay within ${maxRatio}x current parser smoke threshold`
  ).toBeLessThanOrEqual(currentMedian * maxRatio);
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1]! + values[middle]!) / 2
    : values[middle]!;
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

function loadLess45BenchmarkReference(file: string): {
  source: string;
  tag: string;
  compilerVersion: string;
  file: string;
  renderMedianMs: number;
} {
  const source = path.resolve(testData, '../less/benchmark/results/latest/macbook-pro_arm64.json');
  const data = readJsonRecord(source);
  const versions = readArray(data, 'versions', source);
  for (const entry of versions) {
    if (!isRecord(entry)) {
      continue;
    }
    const tag = typeof entry.tag === 'string' ? entry.tag : '';
    const version = typeof entry.version === 'string' ? entry.version : '';
    if (tag !== 'v4.5.1' && !version.startsWith('4.5')) {
      continue;
    }
    const benchmarks = readRecord(entry, 'benchmarks', source);
    const benchmark = readRecord(benchmarks, file, source);
    const render = readRecord(benchmark, 'render', source);
    return {
      source,
      tag,
      compilerVersion: readString(benchmark, 'version', source),
      file: readString(benchmark, 'file', source),
      renderMedianMs: readNumber(render, 'median', source)
    };
  }
  throw new Error(`Less 4.5 benchmark reference not found in ${source}`);
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed;
}

function readRecord(owner: Record<string, unknown>, key: string, source: string): Record<string, unknown> {
  const value = owner[key];
  if (!isRecord(value)) {
    throw new Error(`Expected object at ${key} in ${source}`);
  }
  return value;
}

function readArray(owner: Record<string, unknown>, key: string, source: string): readonly unknown[] {
  const value = owner[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected array at ${key} in ${source}`);
  }
  return value;
}

function readString(owner: Record<string, unknown>, key: string, source: string): string {
  const value = owner[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string at ${key} in ${source}`);
  }
  return value;
}

function readNumber(owner: Record<string, unknown>, key: string, source: string): number {
  const value = owner[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number at ${key} in ${source}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}
