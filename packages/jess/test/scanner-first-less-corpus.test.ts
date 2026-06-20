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

      const probe = probePlugin.lastScannerFirstPrototype;
      expect(probe, corpusLabel(corpusCase)).toBeDefined();
      if (!probe) {
        continue;
      }
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

    metrics.durationMs = nowMs() - startedAt;
    expect(metrics.cases).toBeGreaterThan(0);
    expect(metrics.structuralFed + metrics.canonicalFallback).toBe(metrics.cases);
    console.info(`[scanner-first-less-corpus] ${JSON.stringify(metrics)}`);
  }, 120_000);
});

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
