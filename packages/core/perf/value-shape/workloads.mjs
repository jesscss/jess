/**
 * The REAL-WORLD workloads used by the value-shape measurement. No synthetic
 * allocation loops: every entry is a stylesheet this repo already compiles.
 *
 * `bootstrap` and `less-corpus` live outside the repo (the `@less/test-data`
 * link and the less.js pnpm store); they are skipped with a loud message rather
 * than silently producing a smaller number when absent.
 */
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../../../..');

/*
 * Same candidate-path discovery the repo's bootstrap tests use: the corpus ships
 * via the less.js checkout's pnpm store, whose depth differs between a normal
 * clone and a worktree.
 */
const BOOTSTRAP_CANDIDATES = [
  resolve(REPO, 'node_modules/bootstrap-less-port/less'),
  resolve(REPO, '../../../../less.js/node_modules/.pnpm/bootstrap-less-port@0.3.0/node_modules/bootstrap-less-port/less'),
  resolve(REPO, '../less.js/node_modules/.pnpm/bootstrap-less-port@0.3.0/node_modules/bootstrap-less-port/less')
];
const BOOTSTRAP = BOOTSTRAP_CANDIDATES.find(p => existsSync(p)) ?? BOOTSTRAP_CANDIDATES[0];
const UNIT = resolve(REPO, 'node_modules/@less/test-data/tests-unit');

/** Workloads that need the Less plugin pair (everything authored as `.less` with imports). */
export const NEEDS_LESS_PLUGINS = new Set(['bootstrap', 'less-corpus']);

export function resolveWorkload(name) {
  switch (name) {
    case 'benchmark':
      return [join(REPO, 'packages/jess/benchmark/benchmark.less')];
    case 'chunk-jess':
      return [join(REPO, 'packages/jess/benchmark/chunk.jess')];
    case 'colorspellings':
      return [join(here, 'colorspellings.less')];
    case 'bootstrap':
      return existsSync(BOOTSTRAP) ? [join(BOOTSTRAP, 'bootstrap.less')] : missing('bootstrap', BOOTSTRAP);
    case 'less-corpus': {
      if (!existsSync(UNIT)) {
        return missing('less-corpus', UNIT);
      }
      const out = [];
      for (const d of readdirSync(UNIT)) {
        const f = join(UNIT, d, `${d}.less`);
        if (existsSync(f)) {
          out.push(f);
        }
      }
      return out;
    }
    case 'scss-corpus': {
      const dir = join(REPO, 'packages/scss-parser/.cache/sass-spec/inputs');
      if (!existsSync(dir)) {
        return missing('scss-corpus', dir);
      }
      return readdirSync(dir).filter(f => f.endsWith('.scss')).map(f => join(dir, f));
    }
    default:
      throw new Error(`unknown workload: ${name}`);
  }
}

function missing(name, path) {
  console.error(`SKIP ${name}: corpus not found at ${path}`);
  return [];
}
