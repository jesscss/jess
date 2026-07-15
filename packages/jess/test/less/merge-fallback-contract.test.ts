import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const MERGE_PROFILE_COUNTERS_KEY = '__JESS_MERGE_PROFILE_COUNTERS__';

describe('live legacy merge fallback contract', () => {
  let counters: Record<string, number>;

  beforeEach(() => {
    counters = {};
    Object.defineProperty(globalThis, MERGE_PROFILE_COUNTERS_KEY, {
      configurable: true,
      value: counters
    });
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[MERGE_PROFILE_COUNTERS_KEY];
  });

  it('renders the important merge-alongside-mixin fallback through the legacy coalescer', async () => {
    const [
      { Compiler },
      { spineRenderCounter },
      { default: lessPlugin },
      { lessCompatPlugin }
    ] = await Promise.all([
      import('../../src/index.js'),
      import('../../../core/src/index.js'),
      import('../../../jess-plugin-less/src/index.js'),
      import('../../../jess-plugin-less-compat/src/index.js')
    ]);
    const fixture = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      'fixtures/merge-fallback-important.less'
    );
    const expected = readFileSync(fixture.replace(/\.less$/, '.css'), 'utf8');
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
    });

    const spineBefore = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(fixture, {});

    expect(result.css).toBe(expected);
    expect(spineRenderCounter.rootRenders).toBe(spineBefore);
    expect(counters.admissionCalls).toBeGreaterThan(0);
    expect(counters.admittedCalls).toBeGreaterThan(0);
    expect(counters.calls).toBeGreaterThan(0);
    expect(counters.featureBearingContainers).toBeGreaterThan(0);
  });
});
