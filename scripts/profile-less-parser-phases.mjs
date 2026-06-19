#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { Context, TreeContext } from '../packages/core/lib/index.js';
import { Parser } from '../packages/less-parser/lib/index.js';
import { Compiler } from '../packages/jess/lib/index.js';
import lessPlugin from '../packages/jess-plugin-less/lib/index.js';
import { lessCompatPlugin } from '../packages/jess-plugin-less-compat/lib/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    lessRepoRoot: path.resolve('../less.js'),
    iterations: 20,
    mode: 'parser',
    warmup: 5
  };
  options.testDataRoot = path.join(options.lessRepoRoot, 'packages/test-data');
  options.fixture = path.join(options.lessRepoRoot, 'packages/less/benchmark/benchmark.less');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--fixture':
        options.fixture = resolveFixture(argv[++i], options);
        break;
      case '--iterations':
        options.iterations = Number(argv[++i]);
        break;
      case '--less-repo-root':
        options.lessRepoRoot = path.resolve(argv[++i]);
        options.testDataRoot = path.join(options.lessRepoRoot, 'packages/test-data');
        if (!fs.existsSync(options.fixture)) {
          options.fixture = path.join(options.lessRepoRoot, 'packages/less/benchmark/benchmark.less');
        }
        break;
      case '--mode':
        options.mode = argv[++i];
        break;
      case '--warmup':
        options.warmup = Number(argv[++i]);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new TypeError('--iterations must be a positive integer');
  }
  if (!Number.isInteger(options.warmup) || options.warmup < 0) {
    throw new TypeError('--warmup must be a non-negative integer');
  }
  if (options.mode !== 'parser' && options.mode !== 'compiler') {
    throw new TypeError('--mode must be parser or compiler');
  }
  return options;
}

function resolveFixture(value, options) {
  if (path.isAbsolute(value)) {
    return value;
  }
  const testDataPath = path.join(options.testDataRoot, value);
  if (fs.existsSync(testDataPath)) {
    return testDataPath;
  }
  const lessBenchmarkPath = path.join(options.lessRepoRoot, 'packages/less/benchmark', value);
  if (fs.existsSync(lessBenchmarkPath)) {
    return lessBenchmarkPath;
  }
  return path.resolve(repoRoot, value);
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    samples: sorted.length,
    min: round(sorted[0]),
    median: round(percentile(sorted, 0.5)),
    mean: round(total / sorted.length),
    p75: round(percentile(sorted, 0.75)),
    p90: round(percentile(sorted, 0.9)),
    max: round(sorted[sorted.length - 1])
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function round(value) {
  return Number(value.toFixed(3));
}

function createContext(file) {
  const treeContext = new TreeContext({
    collapseNesting: true,
    file: {
      name: path.basename(file),
      path: path.dirname(file),
      fullPath: file
    }
  });
  const context = new Context({
    collapseNesting: true,
    file: treeContext.file
  });
  context.treeContext = treeContext;
  return context;
}

function timeParserParse(parser, source, file) {
  const phases = {
    totalMs: 0,
    tokenizeMs: 0,
    inputMs: 0
  };
  const originalTokenize = parser.lexer.tokenize;
  parser.lexer.tokenize = function tokenizeWithTiming(...args) {
    const start = performance.now();
    try {
      return originalTokenize.apply(this, args);
    } finally {
      phases.tokenizeMs += performance.now() - start;
    }
  };

  const recursiveParser = parser.parser;
  const descriptor = findPropertyDescriptor(recursiveParser, 'input');
  if (!descriptor?.set || !descriptor.configurable) {
    throw new Error('Could not instrument parser.input setter');
  }
  Object.defineProperty(recursiveParser, 'input', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get?.bind(recursiveParser),
    set(value) {
      const start = performance.now();
      try {
        descriptor.set.call(recursiveParser, value);
      } finally {
        phases.inputMs += performance.now() - start;
      }
    }
  });

  try {
    const context = createContext(file);
    const start = performance.now();
    const parsed = parser.parse(source, 'stylesheet', { context: context.treeContext });
    phases.totalMs = performance.now() - start;
    if (parsed.errors.length > 0) {
      throw new Error(`Parse failed: ${parsed.errors.map(error => String(error)).join('; ')}`);
    }
    return {
      ...phases,
      ruleMs: phases.totalMs - phases.tokenizeMs - phases.inputMs,
      tokenCount: parsed.lexerResult.tokens.length
    };
  } finally {
    parser.lexer.tokenize = originalTokenize;
    delete recursiveParser.input;
  }
}

function findPropertyDescriptor(object, property) {
  let cursor = object;
  while (cursor) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, property);
    if (descriptor) {
      return descriptor;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return undefined;
}

function installParseCounter() {
  const stats = {
    calls: 0,
    totalMs: 0,
    tokenizeMs: 0,
    byRule: new Map()
  };
  const originalParse = Parser.prototype.parse;
  Parser.prototype.parse = function parseWithTiming(...args) {
    const rule = args[1] ?? 'stylesheet';
    const originalTokenize = this.lexer.tokenize;
    let tokenizeMs = 0;
    this.lexer.tokenize = function tokenizeWithTiming(...tokenizeArgs) {
      const start = performance.now();
      try {
        return originalTokenize.apply(this, tokenizeArgs);
      } finally {
        tokenizeMs += performance.now() - start;
      }
    };
    const start = performance.now();
    try {
      return originalParse.apply(this, args);
    } finally {
      const totalMs = performance.now() - start;
      this.lexer.tokenize = originalTokenize;
      stats.calls++;
      stats.totalMs += totalMs;
      stats.tokenizeMs += tokenizeMs;
      stats.byRule.set(rule, (stats.byRule.get(rule) ?? 0) + 1);
    }
  };
  return {
    stats,
    restore() {
      Parser.prototype.parse = originalParse;
    }
  };
}

async function runParserMode(options, source) {
  const constructorSamples = [];
  const first = performance.now();
  const parser = new Parser();
  constructorSamples.push(performance.now() - first);

  for (let i = 0; i < options.warmup; i++) {
    timeParserParse(parser, source, options.fixture);
  }

  const rows = [];
  for (let i = 0; i < options.iterations; i++) {
    rows.push(timeParserParse(parser, source, options.fixture));
  }

  for (let i = 0; i < Math.min(5, options.iterations); i++) {
    const start = performance.now();
    new Parser();
    constructorSamples.push(performance.now() - start);
  }

  return {
    mode: 'parser',
    constructorMs: summarize(constructorSamples),
    totalMs: summarize(rows.map(row => row.totalMs)),
    tokenizeMs: summarize(rows.map(row => row.tokenizeMs)),
    inputMs: summarize(rows.map(row => row.inputMs)),
    ruleMs: summarize(rows.map(row => row.ruleMs)),
    tokenCount: rows[0]?.tokenCount ?? 0
  };
}

async function runCompilerMode(options) {
  const counter = installParseCounter();
  try {
    const compiler = new Compiler({
      output: {
        collapseNesting: true
      },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin()
        ]
      }
    });

    for (let i = 0; i < options.warmup; i++) {
      await compiler.render(options.fixture);
    }

    const renderRows = [];
    for (let i = 0; i < options.iterations; i++) {
      const start = performance.now();
      await compiler.render(options.fixture);
      renderRows.push(performance.now() - start);
    }

    return {
      mode: 'compiler',
      renderMs: summarize(renderRows),
      parseCalls: counter.stats.calls,
      parseTotalMs: round(counter.stats.totalMs),
      tokenizeTotalMs: round(counter.stats.tokenizeMs),
      parseByRule: Object.fromEntries(counter.stats.byRule)
    };
  } finally {
    counter.restore();
  }
}

const options = parseArgs(process.argv.slice(2));
const source = fs.readFileSync(options.fixture, 'utf8');
const result = options.mode === 'parser'
  ? await runParserMode(options, source)
  : await runCompilerMode(options);

console.log(JSON.stringify({
  fixture: options.fixture,
  bytes: source.length,
  iterations: options.iterations,
  warmup: options.warmup,
  ...result
}, null, 2));
