/*
 * Matched CSS parsing and processing comparison for Jess and Stylis.
 *
 * Stylis supports nesting, selector namespacing, minified serialization, and
 * optional vendor prefixing. This workload stays on the common core: native CSS
 * custom properties, grouped selectors, `&` nesting, declarations, and emit.
 * The prefixed Stylis case is reported separately because Jess has no equivalent
 * prefixing plugin in this benchmark.
 *
 *   pnpm --filter jess benchmark:css-processors
 *   COMPONENTS=900 WARMUP=15 N=31 pnpm --filter jess benchmark:css-processors
 */

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { parse } from '@jesscss/css-parser';
import { serialize as serializeJess } from '@jesscss/core';
import {
  compile,
  middleware,
  prefixer,
  serialize as serializeStylis,
  stringify
} from 'stylis';

const require = createRequire(import.meta.url);
const stylisVersion = require('stylis/package.json').version;
const components = Number(process.env.COMPONENTS ?? 600);
const warmup = Number(process.env.WARMUP ?? 10);
const sampleCount = Number(process.env.N ?? 21);

for (const [name, value, minimum] of [
  ['COMPONENTS', components, 1],
  ['WARMUP', warmup, 0],
  ['N', sampleCount, 1]
]) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be an integer >= ${minimum}.`);
  }
}

function generateSource(count) {
  const chunks = [
    ':root {',
    '  --surface: #fff;',
    '  --text: #172033;',
    '  --accent: #3b82f6;',
    '}'
  ];

  for (let i = 0; i < count; i++) {
    chunks.push(
      `.component-${i}, .component-${i}-alt {`,
      '  display: flex;',
      '  user-select: none;',
      '  color: var(--text);',
      '  background: var(--surface);',
      '  &:hover {',
      '    color: var(--accent);',
      '  }',
      '  & > .item {',
      `    order: ${i % 12};`,
      '    appearance: none;',
      '  }',
      '  &[data-active="true"]::before {',
      `    content: "item-${i}";`,
      '  }',
      '}'
    );
  }

  return `${chunks.join('\n')}\n`;
}

const source = generateSource(components);
let sink = 0;
const lastComponent = `.component-${components - 1}`;
const stylisPreflight = serializeStylis(compile(source), stringify);
const jessPreflight = serializeJess(parse(source), {
  collapseNesting: true
}).css ?? '';

for (const [name, css] of [
  ['Stylis', stylisPreflight],
  ['Jess CSS', jessPreflight]
]) {
  if (!css.includes(lastComponent) || css.includes('&')) {
    throw new Error(
      `${name} did not fully emit the matched nested-CSS workload.`
    );
  }
}

const cases = [
  {
    name: 'Stylis compile',
    version: stylisVersion,
    resultUnit: 'root nodes',
    run() {
      const ast = compile(source);
      sink += ast.length;
      return ast.length;
    }
  },
  {
    name: 'Jess CSS parse',
    version: require('@jesscss/css-parser/package.json').version,
    resultUnit: 'root rules',
    run() {
      const document = parse(source);
      sink += document.rules.length;
      return document.rules.length;
    }
  },
  {
    name: 'Stylis compile+emit',
    version: stylisVersion,
    resultUnit: 'CSS bytes',
    run() {
      const css = serializeStylis(compile(source), stringify);
      sink += css.length;
      return css.length;
    }
  },
  {
    name: 'Stylis compile+prefix+emit',
    version: stylisVersion,
    unmatchedFeature: 'vendor prefixing',
    resultUnit: 'CSS bytes',
    run() {
      const css = serializeStylis(
        compile(source),
        middleware([prefixer, stringify])
      );
      sink += css.length;
      return css.length;
    }
  },
  {
    name: 'Jess CSS parse+emit',
    version: require('@jesscss/css-parser/package.json').version,
    resultUnit: 'CSS bytes',
    run() {
      const css = serializeJess(parse(source), {
        collapseNesting: true
      }).css ?? '';
      sink += css.length;
      return css.length;
    }
  }
];

const resultSizes = {};
for (const testCase of cases) {
  for (let i = 0; i < warmup; i++) {
    resultSizes[testCase.name] = testCase.run();
  }
}

const samples = Object.fromEntries(cases.map(testCase => [testCase.name, []]));
for (let round = 0; round < sampleCount; round++) {
  for (let offset = 0; offset < cases.length; offset++) {
    const testCase = cases[(round + offset) % cases.length];
    const start = performance.now();
    resultSizes[testCase.name] = testCase.run();
    samples[testCase.name].push(performance.now() - start);
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

const stylisFullMedian = median(samples['Stylis compile+emit']);
const results = cases
  .map((testCase) => {
    const values = samples[testCase.name];
    const ms = median(values);
    return {
      name: testCase.name,
      version: testCase.version,
      ...(testCase.unmatchedFeature
        ? { unmatchedFeature: testCase.unmatchedFeature }
        : {}),
      medianMs: Number(ms.toFixed(3)),
      minMs: Number(Math.min(...values).toFixed(3)),
      maxMs: Number(Math.max(...values).toFixed(3)),
      vsStylisFull: Number((ms / stylisFullMedian).toFixed(2)),
      resultSize: resultSizes[testCase.name],
      resultUnit: testCase.resultUnit
    };
  })
  .sort((a, b) => a.medianMs - b.medianMs);

console.log(JSON.stringify({
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  dependencies: {
    stylis: {
      version: stylisVersion,
      resolved: require.resolve('stylis')
    },
    cssParser: {
      version: require('@jesscss/css-parser/package.json').version,
      resolved: require.resolve('@jesscss/css-parser')
    },
    core: {
      version: require('@jesscss/core/package.json').version,
      resolved: require.resolve('@jesscss/core')
    }
  },
  workload: {
    features: [
      'native custom properties',
      'grouped selectors',
      'ampersand nesting',
      'child combinators',
      'attribute selectors',
      'pseudo-elements'
    ],
    components,
    inputBytes: Buffer.byteLength(source)
  },
  warmup,
  samples: sampleCount,
  baseline: 'Stylis compile+emit',
  results,
  sink
}, null, 2));
