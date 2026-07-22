import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_COUNTERS_KEY = '__JESS_SCOPE_FRAME_PROFILE_COUNTERS__';

describe('scope-frame profiling', () => {
  let counters: Record<string, number>;

  beforeEach(() => {
    counters = {};
    Object.defineProperty(globalThis, PROFILE_COUNTERS_KEY, {
      configurable: true,
      value: counters
    });
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[PROFILE_COUNTERS_KEY];
  });

  it('separates cached frame reads from placement frame creation by depth', async () => {
    const { rules } = await import('../index.js');
    const root = rules([]);
    const rootFrame = root.getScopeFrame();

    for (const key of Object.keys(counters)) {
      delete counters[key];
    }

    root.getScopeFrame();
    const placement = root.derive();
    placement.getScopeFrame(rootFrame);
    placement.getScopeFrame();

    expect(counters['getScopeFrame.cacheHit']).toBe(2);
    expect(counters['getScopeFrame.cacheHit.canonical']).toBe(1);
    expect(counters['getScopeFrame.cacheHit.placement']).toBe(1);
    expect(counters['getScopeFrame.cacheHit.depth.1']).toBe(1);
    expect(counters['getScopeFrame.cacheHit.depth.2']).toBe(1);
    expect(counters['getScopeFrame.create']).toBe(1);
    expect(counters['getScopeFrame.create.placement']).toBe(1);
    expect(counters['getScopeFrame.create.depth.2']).toBe(1);
    expect(counters['getScopeFrame.cacheHit.ms']).toBeGreaterThanOrEqual(0);
    expect(counters['getScopeFrame.create.ms']).toBeGreaterThanOrEqual(0);
  });
});
