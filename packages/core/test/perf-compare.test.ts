import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import { performance } from 'node:perf_hooks';

function fmt(ms: number) {
  return `${ms.toFixed(2)}ms`;
}
function pad(s: string, n: number) {
  return s.padStart(n, ' ');
}

function isPromiseLike(x: unknown): x is Promise<unknown> {
  return !!x && (typeof x === 'object' || typeof x === 'function') && typeof (x as any).then === 'function';
}

function patchAllEvalAsync(treeModule: Record<string, any>): () => void {
  const originals: Array<{ proto: any; key: 'eval' | 'evalNode' | 'preEval'; fn: Function }> = [];
  const wrap = (proto: any, key: 'eval' | 'evalNode' | 'preEval') => {
    if (!proto) {
      return;
    }
    const orig = proto[key];
    if (typeof orig !== 'function') {
      return;
    }
    if ((orig as any).__wrappedAsync) {
      return;
    }
    const wrapped = function(this: any, ...args: any[]) {
      const out = orig.apply(this, args);
      return isPromiseLike(out) ? out : Promise.resolve(out);
    } as any;
    (wrapped as any).__wrappedAsync = true;
    originals.push({ proto, key, fn: orig });
    proto[key] = wrapped;
  };
  for (const v of Object.values(treeModule)) {
    if (typeof v === 'function' && v.prototype) {
      wrap(v.prototype, 'preEval');
      wrap(v.prototype, 'evalNode');
      wrap(v.prototype, 'eval');
    }
  }
  return () => {
    for (const { proto, key, fn } of originals) {
      proto[key] = fn;
    }
  };
}

function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runScenario(
  mockPipe: boolean,
  patchNodes: boolean,
  withSparseAsync: boolean = false,
  asyncRatio: number = 0.05,
  depth: number = 8,
  breadth: number = 10,
  repeats: number = 80,
  microDelay: boolean = false,
  microDelaySteps: number = 1,
  randomizePlacement: boolean = true,
  seed: number = 12345,
  forceNoCheck: boolean = false
): Promise<number> {
  vi.resetModules();
  if (mockPipe) {
    vi.doMock('@jesscss/awaitable-pipe', async (importOriginal) => {
      const mod: any = await importOriginal();
      const isThenable = (x: unknown): x is Promise<unknown> => !!x && (typeof x === 'object' || typeof x === 'function') && typeof (x as any).then === 'function';
      function asyncPipe(...args: any[]): any {
        if (args.length === 0) {
          return undefined as any;
        }
        const first = args[0];
        const fns = (typeof first === 'function' && typeof args[1] === 'function') ? (args as any[]) : args.slice(1);
        const hasInput = !(typeof first === 'function' && typeof args[1] === 'function');
        const initial = hasInput ? (typeof first === 'function' ? (first as any)() : first) : undefined;
        let p = Promise.resolve(initial);
        for (const fn of fns) {
          p = p.then((val) => {
            const out = hasInput ? fn(val) : fn(val);
            if (forceNoCheck) {
              return Promise.resolve(out);
            }
            return isThenable(out) ? out : Promise.resolve(out);
          });
        }
        return p;
      }
      return { ...mod, pipe: asyncPipe };
    });
  } else {
    vi.unmock('@jesscss/awaitable-pipe');
  }

  const { Context } = await import('../src/context.js');
  const Tree = await import('../src/tree/index.js');
  const { rules } = await import('../src/tree/rules.js');
  const { ruleset } = await import('../src/tree/ruleset.js');
  const { decl } = await import('../src/tree/declaration.js');
  const { el } = await import('../src/tree/selector-basic.js');
  const { sel } = await import('../src/tree/selector-complex.js');
  const { compound } = await import('../src/tree/selector-compound.js');
  const { co } = await import('../src/tree/combinator.js');
  const { sellist } = await import('../src/tree/selector-list.js');
  const { seq, spaced } = await import('../src/tree/sequence.js');
  const { list } = await import('../src/tree/list.js');
  const { any } = await import('../src/tree/any.js');
  const { quoted } = await import('../src/tree/quoted.js');
  const { style } = await import('../src/tree/import-style.js');
  const { isThenable } = await import('@jesscss/awaitable-pipe');

  let restore: undefined | (() => void);
  if (patchNodes) {
    restore = patchAllEvalAsync(Tree as unknown as Record<string, any>);
  }

  const build = (depth: number, breadth: number) => {
    const rng = mulberry32(seed);
    const makeSelector = (i: number) => sel([compound([el(`.c${i}`), el(`#id${i}`)]), co('>'), el(`.d${i}`)]);
    const makeSelectorList = (i: number) => sellist([el(`.x${i}`), el(`.y${i}`)]);
    const makeDecls = (i: number) => [
      decl({ name: 'color', value: any(`#${(i % 16).toString(16)}${(i % 16).toString(16)}${(i % 16).toString(16)}`) }),
      decl({ name: 'margin', value: seq([any(`${i}px`), co('>'), any(`${i + 1}px`)]) }),
      decl({ name: 'padding', value: spaced([list([any(`${i}`), any(`${i + 1}`)]), any('px')]) })
    ];
    const makeLevel = (level: number) => {
      const r = rules([]);
      for (let i = 0; i < breadth; i++) {
        if (withSparseAsync) {
          const hit = randomizePlacement ? rng() < asyncRatio : (i % Math.max(1, Math.floor(1 / asyncRatio)) === 0);
          if (hit) {
            r.push(style({ path: quoted('virtual.css') }, { type: 'import', importOptions: {} as any }));
            continue;
          }
        }
        const childRules = rules(makeDecls(i));
        const selector = i % 2 === 0 ? makeSelector(i) : makeSelectorList(i);
        r.push(ruleset({ selector, rules: childRules }));
      }
      if (level > 0) {
        const nested = makeLevel(level - 1);
        r.push(ruleset({ selector: makeSelector(level + 100), rules: nested }));
      }
      return r;
    };
    return makeLevel(depth);
  };

  const roots = Array.from({ length: repeats }, () => build(depth, breadth));
  for (let i = 0; i < Math.min(3, repeats); i++) {
    const ctx = new Context();
    if (withSparseAsync) {
      (ctx as any).getTree = async (importPath: string) => {
        if (microDelay) {
          for (let d = 0; d < microDelaySteps; d++) {
            await Promise.resolve();
          }
        }
        return { node: rules([]), resolvedPath: importPath };
      };
      (ctx as any).evaldTrees = new Map();
    }
    const out = roots[i]!.eval(ctx);
    if (isThenable(out)) {
      await out;
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < repeats; i++) {
    const ctx = new Context();
    if (withSparseAsync) {
      (ctx as any).getTree = async (importPath: string) => {
        if (microDelay) {
          for (let d = 0; d < microDelaySteps; d++) {
            await Promise.resolve();
          }
        }
        return { node: rules([]), resolvedPath: importPath };
      };
      (ctx as any).evaldTrees = new Map();
    }
    const out = roots[i]!.eval(ctx);
    if (isThenable(out)) {
      await out;
    }
  }
  const t1 = performance.now();
  if (restore) {
    restore();
  }
  return t1 - t0;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { median, min, max, avg };
}

async function runScenarioMulti(opts: Parameters<typeof runScenario>, runs: number): Promise<{ runs: number[]; summary: ReturnType<typeof stats> }> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    times.push(await runScenario(...opts));
  }
  return { runs: times, summary: stats(times) };
}

/** Skip these tests for now */
describe.skip('Jess real-AST perf compare (baseline vs forced async)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unmock('@jesscss/awaitable-pipe');
  });
  afterEach(() => {
    vi.unmock('@jesscss/awaitable-pipe');
    vi.resetModules();
  });
  it('compares baseline vs forced async cleanly', async () => {
    const runs = 3;
    const base = await runScenarioMulti([false, false, false, 0.05, 6, 7, 40, false], runs);
    const bothOn = await runScenarioMulti([true, true, false, 0.05, 6, 7, 40, false, 1, true, 12345, true], runs);
    const widths = [12, 10];
    console.log('\nJess real-AST perf compare (baseline vs forced async)');
    console.log(['scenario', 'median', 'min', 'max'].map((h, i) => pad(h, widths[i % 2]!)).join(' | '));
    console.log([pad('baseline', widths[0]!), pad(fmt(base.summary.median), widths[1]!), pad(fmt(base.summary.min), widths[1]!), pad(fmt(base.summary.max), widths[1]!)].join(' | '));
    console.log([pad('forced-async', widths[0]!), pad(fmt(bothOn.summary.median), widths[1]!), pad(fmt(bothOn.summary.min), widths[1]!), pad(fmt(bothOn.summary.max), widths[1]!)].join(' | '));
    const rows = [
      ['baseline', base.summary.median],
      ['forced-async', bothOn.summary.median]
    ] as const;
    const best = rows.reduce((a, b) => (b[1] < a[1] ? b : a));
    const worst = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
    console.log(`winner=${best[0]}  (x${(worst[1] / best[1]).toFixed(2)} vs slowest)`);
  }, 60_000);

  it('compares baseline vs forced async with sparse async (~5% StyleImport)', async () => {
    const runs = 3;
    const base = await runScenarioMulti([false, false, true, 0.05, 6, 7, 40, true, 1], runs);
    const bothOn = await runScenarioMulti([true, true, true, 0.05, 6, 7, 40, true, 1, true, 12345, true], runs);
    const widths = [12, 10];
    console.log('\nJess real-AST perf compare (sparse async ~5%)');
    console.log(['scenario', 'median', 'min', 'max'].map((h, i) => pad(h, widths[i % 2]!)).join(' | '));
    console.log([pad('baseline', widths[0]!), pad(fmt(base.summary.median), widths[1]!), pad(fmt(base.summary.min), widths[1]!), pad(fmt(base.summary.max), widths[1]!)].join(' | '));
    console.log([pad('forced-async', widths[0]!), pad(fmt(bothOn.summary.median), widths[1]!), pad(fmt(bothOn.summary.min), widths[1]!), pad(fmt(bothOn.summary.max), widths[1]!)].join(' | '));
    const rows = [
      ['baseline', base.summary.median],
      ['forced-async', bothOn.summary.median]
    ] as const;
    const best = rows.reduce((a, b) => (b[1] < a[1] ? b : a));
    const worst = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
    console.log(`winner=${best[0]}  (x${(worst[1] / best[1]).toFixed(2)} vs slowest)`);
  }, 60_000);

  it('sweeps sparse async ratios (baseline vs forced async, microDelay=1 step)', async () => {
    const runs = 3;
    const ratios = [0.01, 0.05, 0.10];
    console.log('\nJess real-AST ratio sweep (microDelay=1)');
    const header = ['ratio', 'baseline', 'forced-async', 'winner'];
    const widths = [8, 12, 12, 14];
    console.log(header.map((h, i) => pad(h, widths[i]!)).join(' | '));
    let winsBaseline = 0;
    let winsForced = 0;
    for (const r of ratios) {
      const base = await runScenarioMulti([false, false, true, r, 6, 7, 40, true, 1], runs);
      const bothOn = await runScenarioMulti([true, true, true, r, 6, 7, 40, true, 1, true, 12345, true], runs);
      const winner = base.summary.median <= bothOn.summary.median ? 'baseline' : 'forced-async';
      if (winner === 'baseline') {
        winsBaseline++;
      } else {
        winsForced++;
      }
      console.log([
        pad(`${Math.round(r * 100)}%`, widths[0]!),
        pad(fmt(base.summary.median), widths[1]!),
        pad(fmt(bothOn.summary.median), widths[2]!),
        pad(winner, widths[3]!)
      ].join(' | '));
    }
    console.log(`summary: baseline wins=${winsBaseline}, forced-async wins=${winsForced}`);
  }, 60_000);

  it('heavier async cost scenario (microDelay=3 steps, ratio 5%)', async () => {
    if (!process.env.HEAVY_PERF) {
      console.log('skipped heavy perf (set HEAVY_PERF=1 to run)');
      return;
    }
    const runs = 5;
    const base = await runScenarioMulti([false, false, true, 0.05, 7, 8, 60, true, 3], runs);
    const bothOn = await runScenarioMulti([true, true, true, 0.05, 7, 8, 60, true, 3, true, 12345, true], runs);
    const widths = [12, 10];
    console.log('\nJess real-AST perf compare (heavier async microDelay=3, ~5%)');
    console.log(['scenario', 'median', 'min', 'max'].map((h, i) => pad(h, widths[i % 2]!)).join(' | '));
    console.log([pad('baseline', widths[0]!), pad(fmt(base.summary.median), widths[1]!), pad(fmt(base.summary.min), widths[1]!), pad(fmt(base.summary.max), widths[1]!)].join(' | '));
    console.log([pad('forced-async', widths[0]!), pad(fmt(bothOn.summary.median), widths[1]!), pad(fmt(bothOn.summary.min), widths[1]!), pad(fmt(bothOn.summary.max), widths[1]!)].join(' | '));
    const rows = [
      ['baseline', base.summary.median],
      ['forced-async', bothOn.summary.median]
    ] as const;
    const best = rows.reduce((a, b) => (b[1] < a[1] ? b : a));
    const worst = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
    console.log(`winner=${best[0]}  (x${(worst[1] / best[1]).toFixed(2)} vs slowest)`);
  }, 90_000);
});
