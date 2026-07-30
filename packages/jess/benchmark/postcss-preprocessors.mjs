/*
 * End-to-end comparison against postcss/benchmark's preprocessor workload.
 *
 * This intentionally loads the competitor versions and Bootstrap fixture from
 * an upstream postcss/benchmark checkout. That keeps the comparison tied to its
 * lockfile instead of silently substituting whatever versions Jess happens to
 * use for development.
 *
 *   git clone https://github.com/postcss/benchmark.git /tmp/postcss-benchmark
 *   pnpm --dir /tmp/postcss-benchmark install --ignore-scripts
 *   pnpm --filter jess benchmark:postcss-preprocessors -- \
 *     --upstream=/tmp/postcss-benchmark
 *
 * WARMUP=5 N=15 can be overridden for a longer or shorter run. Inputs are built
 * once, every engine is warmed first, and measured samples are interleaved with
 * a rotating start position to reduce ordering and machine-drift bias.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Compiler } from '../lib/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const prefix = `--${name}=`;
  const hit = argv.find(value => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const upstreamRoot = resolve(
  arg('upstream')
  ?? process.env.POSTCSS_BENCHMARK_DIR
  ?? join(repoRoot, '..', 'postcss-benchmark')
);
const upstreamRequire = createRequire(join(upstreamRoot, 'package.json'));

let less;
let sass;
let postcss;
let postcssMixins;
let postcssNested;
let postcssSimpleVars;
try {
  less = upstreamRequire('less');
  sass = upstreamRequire('sass');
  postcss = upstreamRequire('postcss');
  postcssMixins = upstreamRequire('postcss-mixins');
  postcssNested = upstreamRequire('postcss-nested');
  postcssSimpleVars = upstreamRequire('postcss-simple-vars');
} catch (error) {
  console.error(
    `Could not load postcss/benchmark dependencies from ${upstreamRoot}.\n`
    + 'Clone that repository, run pnpm install --ignore-scripts there, and pass '
    + '--upstream=/absolute/path.'
  );
  throw error;
}

/** Read metadata beside a resolved entry: modern packages often block `pkg/package.json`. */
const dependency = (name) => {
  const resolved = upstreamRequire.resolve(name);
  for (let directory = dirname(resolved); ; directory = dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name === name) {
        return { version: pkg.version, resolved };
      }
    }
    if (directory === dirname(directory)) {
      throw new Error(`Could not locate package metadata for ${name} from ${resolved}.`);
    }
  }
};

const postcssDependency = dependency('postcss');
const postcssMixinsDependency = dependency('postcss-mixins');
const postcssNestedDependency = dependency('postcss-nested');
const postcssSimpleVarsDependency = dependency('postcss-simple-vars');
const lessDependency = dependency('less');

const bootstrapFile = join(upstreamRoot, 'cache', 'bootstrap.css');
let origin;
try {
  origin = readFileSync(bootstrapFile, 'utf8');
} catch (error) {
  console.error(
    `Could not read ${bootstrapFile}.\n`
    + 'Run pnpm --dir /absolute/path/to/postcss-benchmark gulp bootstrap first.'
  );
  throw error;
}

const css = origin
  .replace(/\s+filter:[^;}]+;?/g, '')
  .replace('/*# sourceMappingURL=bootstrap.css.map */', '');

const postcssProcessor = postcss([
  postcssNested,
  postcssSimpleVars,
  postcssMixins
]);

let postcssSource = `${css}\n`;
postcssSource += '$size: 100px;\n';
postcssSource += '@define-mixin icon { width: 16px; height: 16px; }\n';

let scssSource = `${css}\n`;
scssSource += '$size: 100px;\n';
scssSource += '@mixin icon { width: 16px; height: 16px; }\n';

let lessSource = css.replace(/--[-\w]+:\s*;/g, '');
const lessBaseBytes = Buffer.byteLength(lessSource);
lessSource += '\n@size: 100px;\n';
lessSource += '.icon() { width: 16px; height: 16px; }\n';

for (let i = 0; i < 100; i++) {
  postcssSource += '\nbody { h1 { a { color: black; } } }\n';
  postcssSource += 'h2 { width: $size; }\n';
  postcssSource += '.search { fill: black; @mixin icon; }\n';

  scssSource += '\nbody { h1 { a { color: black; } } }\n';
  scssSource += 'h2 { width: $size; }\n';
  scssSource += '.search { fill: black; @include icon; }\n';

  lessSource += '\nbody { h1 { a { color: black; } } }\n';
  lessSource += 'h2 { width: @size; }\n';
  lessSource += '.search { fill: black; .icon(); }\n';
}

const jessLess = new Compiler({
  suppressWarnings: true,
  output: { collapseNesting: true }
});
const jessScss = new Compiler({
  suppressWarnings: true,
  output: { collapseNesting: true }
});
const sassLogger = { warn() {}, debug() {} };

const renderSass = () => new Promise((resolvePromise, reject) => {
  sass.render({ data: scssSource, logger: sassLogger }, (error, result) => {
    if (error) {
      reject(error);
    } else {
      resolvePromise(result.css);
    }
  });
});

const renderLess = () => new Promise((resolvePromise, reject) => {
  less.render(lessSource, { math: 'strict' }, (error, result) => {
    if (error) {
      reject(error);
    } else {
      resolvePromise(result.css);
    }
  });
});

const allCases = [
  {
    name: 'PostCSS sync',
    version: postcssDependency.version,
    run: () => postcssProcessor.process(postcssSource, {
      from: bootstrapFile,
      map: false
    }).css
  },
  {
    name: 'PostCSS',
    version: postcssDependency.version,
    run: async () => (await postcssProcessor.process(postcssSource, {
      from: bootstrapFile,
      map: false
    })).css
  },
  {
    name: 'Less',
    version: lessDependency.version,
    run: renderLess
  },
  {
    name: 'Dart Sass sync',
    version: String(sass.info).split(/\s+/)[1] ?? String(sass.info),
    run: () => sass.renderSync({
      data: scssSource,
      logger: sassLogger
    }).css
  },
  {
    name: 'Dart Sass',
    version: String(sass.info).split(/\s+/)[1] ?? String(sass.info),
    run: renderSass
  },
  {
    name: 'Jess Less',
    version: JSON.parse(readFileSync(join(repoRoot, 'packages/jess/package.json'), 'utf8')).version,
    run: () => jessLess.renderString(lessSource, {
      filePath: 'postcss-preprocessors.less',
      extension: '.less',
      config: { suppressWarnings: true }
    })
  },
  {
    name: 'Jess SCSS',
    version: JSON.parse(readFileSync(join(repoRoot, 'packages/jess/package.json'), 'utf8')).version,
    run: () => jessScss.renderString(scssSource, {
      filePath: 'postcss-preprocessors.scss',
      extension: '.scss',
      config: { suppressWarnings: true }
    })
  }
];
const requestedCases = process.env.ENGINES
  ?.split(',')
  .map(name => name.trim())
  .filter(Boolean);
const cases = requestedCases
  ? allCases.filter(testCase => requestedCases.includes(testCase.name))
  : allCases;

if (cases.length === 0 || requestedCases?.some(
  name => !allCases.some(testCase => testCase.name === name)
)) {
  throw new TypeError(
    `ENGINES must contain names from: ${allCases.map(({ name }) => name).join(', ')}`
  );
}

const warmup = Number(process.env.WARMUP ?? 5);
const sampleCount = Number(process.env.N ?? 15);
if (!Number.isInteger(warmup) || warmup < 0) {
  throw new TypeError('WARMUP must be a non-negative integer.');
}
if (!Number.isInteger(sampleCount) || sampleCount < 1) {
  throw new TypeError('N must be a positive integer.');
}

const outputBytes = {};
for (const testCase of cases) {
  const output = String(await testCase.run());
  if (
    !output.includes('width: 100px')
    || !output.includes('.search')
    || !output.includes('body h1 a')
  ) {
    throw new Error(
      `${testCase.name} did not fully evaluate and emit the preprocessor workload.`
    );
  }
  outputBytes[testCase.name] = Buffer.byteLength(output);
}

for (const testCase of cases) {
  for (let i = 0; i < warmup; i++) {
    const output = await testCase.run();
    outputBytes[testCase.name] = Buffer.byteLength(output);
  }
}

const samples = Object.fromEntries(cases.map(testCase => [testCase.name, []]));
for (let round = 0; round < sampleCount; round++) {
  for (let offset = 0; offset < cases.length; offset++) {
    const testCase = cases[(round + offset) % cases.length];
    const start = performance.now();
    const output = await testCase.run();
    samples[testCase.name].push(performance.now() - start);
    outputBytes[testCase.name] = Buffer.byteLength(output);
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};
const baselineName = cases.some(({ name }) => name === 'PostCSS')
  ? 'PostCSS'
  : cases[0].name;
const baselineMedian = median(samples[baselineName]);
const results = cases
  .map((testCase) => {
    const values = samples[testCase.name];
    const ms = median(values);
    return {
      name: testCase.name,
      version: testCase.version,
      medianMs: Number(ms.toFixed(2)),
      minMs: Number(Math.min(...values).toFixed(2)),
      maxMs: Number(Math.max(...values).toFixed(2)),
      vsBaseline: Number((ms / baselineMedian).toFixed(2)),
      outputBytes: outputBytes[testCase.name]
    };
  })
  .sort((a, b) => a.medianMs - b.medianMs);

console.log(JSON.stringify({
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  upstreamRoot,
  upstreamCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: upstreamRoot,
    encoding: 'utf8'
  }).trim(),
  dependencies: {
    postcss: {
      ...postcssDependency
    },
    postcssMixins: {
      ...postcssMixinsDependency
    },
    postcssNested: {
      ...postcssNestedDependency
    },
    postcssSimpleVars: {
      ...postcssSimpleVarsDependency
    },
    less: {
      ...lessDependency
    },
    sass: {
      version: String(sass.info).split(/\s+/)[1] ?? String(sass.info),
      resolved: upstreamRequire.resolve('sass')
    },
    jess: {
      version: upstreamRequire(join(repoRoot, 'packages/jess/package.json')).version,
      resolved: fileURLToPath(new URL('../lib/index.js', import.meta.url))
    }
  },
  bootstrap: {
    bytes: Buffer.byteLength(origin),
    sha256: createHash('sha256').update(origin).digest('hex')
  },
  inputBytes: {
    postcss: Buffer.byteLength(postcssSource),
    less: Buffer.byteLength(lessSource),
    scss: Buffer.byteLength(scssSource)
  },
  workloadComposition: {
    classification: 'CSS-heavy preprocessor throughput',
    note: 'The Less input starts with compiled Bootstrap CSS, then appends a small synthetic Less feature tail.',
    lessBaseCssBytes: lessBaseBytes,
    lessFeatureBytes: Buffer.byteLength(lessSource) - lessBaseBytes,
    lessBaseCssShare: Number((lessBaseBytes / Buffer.byteLength(lessSource)).toFixed(4))
  },
  warmup,
  samples: sampleCount,
  selectedCases: cases.map(({ name }) => name),
  baseline: baselineName,
  results
}, null, 2));
