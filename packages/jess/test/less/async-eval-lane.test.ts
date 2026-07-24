/**
 * The awaitable evaluation lane, exercised through a NATIVE async `Fn`.
 *
 * Deliberately not through `@plugin`: legacy plugin calls are served on a
 * blocking channel so their results never reach the engine as promises, which
 * means a `@plugin`-based test passes without the async lane being involved at
 * all. A config-injected `Fn` with real latency is the honest probe.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { defineFunction, makeDimension, makeKeyword } from '@jesscss/core/value';

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
    await new Promise(resolve => setTimeout(resolve, 5));
    return makeDimension(576, 'px');
  }
});

function render(source: string) {
  const compiler = new Compiler({
    compile: { plugins: [lessPlugin(), lessCompatPlugin({ functions: [slowKeyword, slowWidth] })] },
    output: { collapseNesting: true }
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

  it('iterates an each() list built from an awaitable value', async () => {
    const result = await render(
      '@item: aslow();\n'
      + 'each(@item, {\n  .x-@{value} { color: red; }\n});\n'
    );
    expect(result.errors).toEqual([]);
    expect(result.css).toContain('.x-zed');
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
