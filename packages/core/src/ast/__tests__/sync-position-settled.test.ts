import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize, type SerializeReturn } from '../serialize.js';
import { defineFunction } from '../value-dispatch.js';
import { makeKeyword } from '../value-factory.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { parse as parseScss } from '../../../../syntax/scss/scss-parser/src/index.js';

/*
 * Some positions cannot wait for a value: a namespace-path index, a mixin read as
 * a map, an `@if`/`@while` condition. A value that is already settled passes
 * through them synchronously, so a fully synchronous render returns a plain
 * result and a synchronous error still throws at the call. The assertions below
 * are deliberately NOT awaited: a render that returned a promise has no `css`.
 */
const registry = makeLessRegistry();
registry.register(defineFunction('aslow', { variadic: true, params: [], body: async () => makeKeyword('zed') }));
const evaluator = buildEvaluator(registry);
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};
const syncCss = (out: SerializeReturn): string | undefined => (out instanceof Promise ? undefined : out.css);
const render = (root: ReturnType<typeof parseLess>): string | undefined => syncCss(serialize(root, { evaluator }));

describe('positions confined to the synchronous lane', () => {
  it('pass a settled value through without suspending the render', () => {
    expect(render(parseLess('#ns when (true) { .m() { color: red; } }\n.a { #ns > .m(); }'))).toBe('.a {\n  color: red;\n}\n');
    expect(render(parseLess('.ns() { .m() { color: red; } }\n.a { .ns > .m(); }'))).toBe('.a {\n  color: red;\n}\n');
    expect(render(parseLess('.m() { a: 1px; }\n@kk: a;\n@k: kk;\n.b { w: .m[@@k]; }'))).toBe('.b {\n  w: a;\n}\n');
    expect(render(parseScss('$i: 0;\n@while $i < 2 { .w-#{$i} { a: $i; } $i: $i + 1; }\n@if $i == 2 { .ok { b: 1; } } @else { .no { b: 0; } }\n.v { c: if(true, 1, 2); }')))
      .toBe('.w-0 {\n  a: 0;\n}\n.w-1 {\n  a: 1;\n}\n.ok {\n  b: 1;\n}\n.v {\n  c: 1;\n}\n');
  });

  it('keep a synchronous error thrown at the call', () => {
    expect(thrownBy(() => render(parseLess('#ns when (true) { .m() { color: @missing; } }\n.a { #ns > .m(); }'))))
      .toMatchObject({ code: 'resolve/name-not-found', reason: expect.stringContaining('@missing') });
    expect(thrownBy(() => render(parseScss('$i: 0;\n@while $i < 1 { .w { a: $missing; } $i: $i + 1; }'))))
      .toMatchObject({ code: 'resolve/name-not-found', reason: expect.stringContaining('missing') });
  });

  it('report an awaitable value with the position it reached', async () => {
    const root = parseLess('#outer when (aslow() = zed) { #inner { .m() { color: red; } } }\n.entry { #outer > #inner > .m(); }');
    await expect(Promise.resolve().then(() => serialize(root, { evaluator }))).rejects.toMatchObject({
      code: 'eval/async-in-sync-position',
      reason: expect.stringContaining('namespace-path index build')
    });
  });

  /*
   * A value lambda (`@function`) is called from a value position that cannot wait,
   * so neither a parameter default nor an argument may suspend. A `@content(args)`
   * block binds its args the same way, but from a statement position that can.
   */
  it('confine a value lambda to the synchronous lane but not a content block', async () => {
    expect(thrownBy(() => serialize(parseScss('@function f($a: aslow()) { @return $a; }\n.x { c: f(); }'), { evaluator })))
      .toMatchObject({ code: 'eval/async-in-sync-position', reason: expect.stringContaining('lambda parameter default') });
    expect(thrownBy(() => serialize(parseScss('@function f($a) { @return $a; }\n.x { c: f(aslow()); }'), { evaluator })))
      .toMatchObject({ code: 'eval/async-in-sync-position', reason: expect.stringContaining('value-lambda argument binding') });
    const content = serialize(parseScss('@mixin wrap { @content(1); }\n.x { @include wrap using ($a, $b: aslow()) { c: $a $b; } }'), { evaluator });
    expect(content).toBeInstanceOf(Promise);
    expect((await content).css).toBe('.x {\n  c: 1 zed;\n}\n');
  });
});
