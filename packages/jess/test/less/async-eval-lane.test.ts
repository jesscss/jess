/**
 * The awaitable evaluation lane, exercised through a NATIVE async `Fn`.
 *
 * Deliberately not through `@plugin`: legacy plugin calls are served on a
 * blocking channel so their results never reach the engine as promises, which
 * means a `@plugin`-based test passes without the async lane being involved at
 * all. A config-injected `Fn` with real latency is the honest probe.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { defineFunction, makeDimension, makeKeyword } from '@jesscss/core';

/** Resolves after a real tick, so the value genuinely arrives as a promise. */
const slowKeyword = defineFunction('aslow', {
  variadic: true,
  params: [],
  body: async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return makeKeyword('zed');
  }
});

const slowWidth = defineFunction('awidth', {
  variadic: true,
  params: [],
  body: async () => {
    // Deliberately SLOWER than `aslow`, so completion order inverts source order.
    await new Promise(resolve => setTimeout(resolve, 25));
    return makeDimension(576, 'px');
  }
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function render(source: string, collapseNesting = true) {
  const compiler = new Compiler({
    compile: { plugins: [lessPlugin(), lessCompatPlugin({ functions: [slowKeyword, slowWidth] })] },
    output: { collapseNesting }
  });
  return compiler.renderToResult(
    { source, filePath: '/virtual/async-lane.less', language: 'less', extension: '.less' },
    { suppressWarnings: true, breakOnError: false }
  );
}

describe('awaitable values in guard conditions', () => {
  it('resolves a ruleset guard whose operand is awaitable', async () => {
    const result = await render(
      '@w: awidth();\n'
      + '.a when not (@w = ~"") {\n  width: @w;\n}\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).toContain('width: 576px');
  }, 20000);

  it('takes the false branch of an awaitable guard', async () => {
    const result = await render(
      '@w: aslow();\n'
      + '.a when (@w = ~"nope") {\n  width: 1px;\n}\n'
      + '.b when not (@w = ~"nope") {\n  width: 2px;\n}\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).not.toContain('width: 1px');
    expect(result.css).toContain('width: 2px');
  }, 20000);

  it('locates an awaitable guard while descending a namespace ruleset', async () => {
    const result = await render(
      '@w: aslow();\n'
      + '#outer when (@w = zed) { #inner { .m() { color: red; } } }\n'
      + '.entry { #outer > #inner > .m(); }\n'
    );
    const failure = result.errors.find(error => error.code === 'eval/async-in-sync-position');

    expect(failure).toMatchObject({
      line: 2,
      column: 1
    });
  }, 20000);

  it.each([true, false])(
    'iterates an each() list built from an awaitable value with collapseNesting=%s',
    async (collapseNesting) => {
      const result = await render(
        '@item: aslow();\n'
        + 'each(@item, {\n  .x-@{value} { color: red; }\n});\n',
        collapseNesting
      );
      expect(result.errors).toEqual([]);
      expect(result.css).toContain('.x-zed');
    },
    20000
  );
});

describe('awaitable values in at-rule preludes', () => {
  it('resolves a @media query built from an awaitable value', async () => {
    const result = await render(
      '@w: awidth();\n'
      + '@media (min-width: @w) {\n  .a { color: red; }\n}\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).toContain('@media (min-width: 576px)');
    expect(result.css).toContain('color: red');
  }, 20000);

  it('resolves a @supports prelude built from an awaitable value', async () => {
    const result = await render(
      '@v: aslow();\n'
      + '@supports (color: @v) {\n  .a { color: red; }\n}\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).toContain('@supports (color: zed)');
  }, 20000);

  it('drops an at-rule whose body is empty even when its prelude awaited', async () => {
    const result = await render(
      '@w: awidth();\n'
      + '@media (min-width: @w) {\n}\n'
      + '.keep { color: red; }\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).not.toContain('@media');
    expect(result.css).toContain('.keep');
  }, 20000);

  it('keeps declaration order when preludes resolve out of order', async () => {
    // `awidth` is slower than `aslow`, so completion order is the REVERSE of
    // source order. Output must still follow the source.
    const result = await render(
      '@a: aslow();\n@w: awidth();\n'
      + '@media (min-width: @w) {\n  .first { color: red; }\n}\n'
      + '@supports (color: @a) {\n  .second { color: blue; }\n}\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css.indexOf('.first')).toBeLessThan(result.css.indexOf('.second'));
  }, 20000);
});

/**
 * Ordering regressions the emission-order probe cannot see.
 *
 * The mixin INDEX is built per frame and consumed assuming it is rank-sorted.
 * When a rule's key is interpolated from an awaitable value, deferring that
 * rule's index insert past later statements silently INVERTS dispatch order —
 * output positions all look right, so an emission-order check misses it
 * entirely. This asserts candidate order directly.
 */
describe('index-build order under async', () => {
  it('keeps mixin candidates in source order when a key must be awaited', async () => {
    const result = await render(
      '@n: aslow();\n'
      // `.zed` is defined twice: first via an AWAITABLE interpolated selector,
      // then statically. Less dispatches both, in source order.
      + '.@{n} { first: 1; }\n'
      + '.zed { second: 2; }\n'
      + '.use { .zed(); }\n'
    );
    expect(result.errors).toEqual([]);
    const use = result.css.slice(result.css.indexOf('.use'));
    expect(use).toContain('first: 1');
    expect(use).toContain('second: 2');
    expect(use.indexOf('first'), 'interpolated-key rule must dispatch BEFORE the later static one')
      .toBeLessThan(use.indexOf('second'));
  }, 20000);
});

/**
 * Imported facts publish in SOURCE ORDER, interleaved as authored. A rule-mixin
 * and a parametric def of the same name both land in one per-name candidate
 * list, so batching the rule-mixins to the end of the import silently sorts
 * every imported `MixinDef` ahead of them. Synchronous — no async needed to
 * expose it — and the Less corpus does not cover it.
 */
describe('imported mixin publication order', () => {
  it('interleaves an imported rule-mixin and parametric def in source order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-order-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'imp.less'), '.m { a: rule-mixin; }\n.m() { b: parametric; }\n', 'utf8');
    const entry = path.join(dir, 'main.less');
    fs.writeFileSync(entry, '@import "imp.less";\n.out { .m(); }\n', 'utf8');

    const compiler = new Compiler({
      compile: { plugins: [lessPlugin()] },
      output: { collapseNesting: true }
    });
    const result = await compiler.renderToResult(entry, { suppressWarnings: true, breakOnError: false });

    expect(result.errors).toEqual([]);
    const out = result.css.slice(result.css.indexOf('.out'));
    expect(out.indexOf('a: rule-mixin'), 'imported facts must dispatch in source order')
      .toBeLessThan(out.indexOf('b: parametric'));
  }, 20000);
});

/**
 * The extend pre-pass resolves selector interpolation synchronously, in place.
 * Before this was fenced, an awaitable interp left the selector with NO text:
 * the rule emitted with an empty leading selector (`,\n.a { … }`) and the
 * `:extend()` silently did not apply — wrong CSS, and not one diagnostic.
 * Until the pre-pass gains an awaitable lane it must FAIL, not guess.
 */
describe('awaitable selector interpolation in the extend pre-pass', () => {
  it('errors instead of emitting an empty leading selector', async () => {
    const result = await render(
      '@e: aslow();\n'
      + '.@{e} { color: blue; }\n'
      + '.a:extend(.@{e}) { color: red; }\n'
    );
    expect(result.css).not.toMatch(/^\s*,/mu);
    const failure = result.errors.find(error => error.code === 'eval/async-in-sync-position');
    expect(failure, `expected eval/async-in-sync-position, got ${JSON.stringify(result.errors.map(e => e.code))}`)
      .toBeDefined();
    // The parser records no span for a selector-interp reference, so the message
    // must name the offending selector to stay actionable.
    expect(failure!.reason).toContain('.@{e}');
  }, 20000);

  it('errors instead of silently dropping the extend', async () => {
    const result = await render(
      '@e: aslow();\n'
      + '.zed { color: blue; }\n'
      + '.a:extend(.@{e}) { color: red; }\n'
    );
    const failure = result.errors.find(error => error.code === 'eval/async-in-sync-position');
    expect(failure).toBeDefined();
  }, 20000);

  it('leaves the fully synchronous equivalent working', async () => {
    const result = await render(
      '@e: ~"zed";\n'
      + '.@{e} { color: blue; }\n'
      + '.a:extend(.@{e}) { color: red; }\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).toContain('.zed,');
    expect(result.css).toContain('.a {');
  }, 20000);
});
