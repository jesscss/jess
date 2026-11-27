/**
 * Foundation blockers 5, 2 and 6 — `@return` nested inside `@if`/`@else`,
 * `@include` with a trailing content block, and `@content`.
 *
 * All three lower to constructs that ALREADY EXIST, so the assertions here are
 * about NODE IDENTITY, not about a new shape (§12.0: lower to the `.jess` you
 * want, then read off the node):
 *
 * | source | the `.jess` you want | ∴ the node |
 * | --- | --- | --- |
 * | `@return v` inside `@if` | `result: v` | `Declaration` — the same one a top-level `@return` already built |
 * | `@content;` | `$content()` | `Reference` on a live `content` `Lookup` + one `Call` step |
 * | `@include m { … }` | `$ > m(): @{ … }` | `MixinCall` carrying the block on `content` |
 *
 * The `@content` case is checked against the JESS parser's own tree for
 * `$content()`: if the two disagree, one of the two grammars is spelling the
 * documented built-in a second way, which is exactly what §12.0 forbids.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { parse as parseJess } from '../../../jess/jess-parser/src/index.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { makeLessRegistry } from '../../../../fns/src/index.js';

/** Drop span slots so a tree compares by structure. */
const shape = (node: unknown): unknown =>
  JSON.parse(JSON.stringify(node, (key, value) => (key.startsWith('_') ? undefined : value)));

const render = async (source: string): Promise<string> =>
  (await serialize(parse(source), { evaluator: buildEvaluator({ functions: makeLessRegistry() }) })).css;

describe('blocker 5 — @return nested inside @if/@else', () => {
  it('builds the same `result:` declaration a top-level @return builds', () => {
    const nested = parse('@function f($v) { @if $v { @return 1; } @else { @return 2; } }');
    const branches = shape(nested) as {
      rules: [{ value: { rules: [{ branches: [{ rules: unknown[] }, { rules: unknown[] }] }] } }];
    };
    const [whenTrue, whenFalse] = branches.rules[0].value.rules[0].branches;

    const topLevel = shape(parse('@function f() { @return 1; }')) as {
      rules: [{ value: { rules: unknown[] } }];
    };

    expect(whenTrue.rules).toEqual(topLevel.rules[0].value.rules);
    expect(whenFalse.rules).toEqual([
      { type: 'Declaration', name: 'result', value: { type: 'Dimension', number: 2, unit: '', src: '2' }, merge: null, important: false }
    ]);
  });

  it('reaches a @return through a nested @else if', () => {
    expect(() => parse('@function f($v) { @if $v == 1 { @return a; } @else if $v == 2 { @return b; } }')).not.toThrow();
  });
});

describe('blocker 6 — @content', () => {
  it('lowers to the SAME node the Jess grammar builds for `$content()`', () => {
    const fromScss = shape(parse('@mixin m { @content; }')) as { rules: [{ rules: unknown[] }] };
    const fromJess = shape(parseJess('m() {\n  $content();\n}')) as { rules: [{ rules: unknown[] }] };
    expect(fromScss.rules[0].rules).toEqual(fromJess.rules[0].rules);
  });

  it('carries `@content(…)` arguments on the Call step', () => {
    const tree = shape(parse('@mixin m { @content($type); }')) as { rules: [{ rules: [unknown] }] };
    expect(tree.rules[0].rules[0]).toEqual({
      type: 'Reference',
      base: { type: 'Lookup', scope: 'live', kind: 'var', name: 'content', raw: '@content' },
      steps: [{ type: 'Call', args: [{ spread: false, value: { type: 'Lookup', scope: 'live', kind: 'var', name: 'type', raw: '@type' } }] }],
      raw: '$content($type)'
    });
  });

  it('accepts the terminator-less form Foundation authors', () => {
    expect(() => parse('@mixin m {\n  @content\n}')).not.toThrow();
  });
});

describe('blocker 2 — @include with a trailing content block', () => {
  it('puts the block on MixinCall.content, not in the argument list', () => {
    const tree = shape(parse('.a { @include m(1px) { color: red; } }')) as { rules: [{ rules: [Record<string, unknown>] }] };
    const call = tree.rules[0].rules[0];
    expect(call.type).toBe('MixinCall');
    expect(call.args).toEqual([{ value: { type: 'Dimension', number: 1, unit: 'px', src: '1px' }, spread: false }]);
    expect(call.content).toEqual({
      type: 'AnonymousMixin',
      rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' }, merge: null, important: false }]
    });
  });

  it('lowers `using (…)` to the content block AnonymousMixin.params', () => {
    const tree = shape(parse('.a { @include m using ($t) { color: $t; } }')) as { rules: [{ rules: [{ content: { params: unknown } }] }] };
    expect(tree.rules[0].rules[0].content.params).toEqual([{ name: 't' }]);
  });

  it('leaves a block-less @include with a null content slot', () => {
    const tree = shape(parse('.a { @include m(1px); }')) as { rules: [{ rules: [{ content: unknown }] }] };
    expect(tree.rules[0].rules[0].content).toBeNull();
  });
});

describe('the two halves compose end to end', () => {
  it('renders the assigned block where @content sits', async () => {
    expect(await render('@mixin m { .in { @content; } }\n.a { @include m { color: red; } }'))
      .toBe('.a .in {\n  color: red;\n}\n');
  });

  /*
   * OWNER RULING — SETTLED (dart-sass semantics): a content block does NOT leak
   * across frames. `@content` refers ONLY to the block passed to THIS mixin's own
   * `@include`, bound in its own call frame (`mixin-dispatch.ts` — `bound.set(
   * 'content', call.content)`, set only when `call.content !== null`). When no
   * block was bound to this activation, `@content` splices EMPTY (a no-op), NOT an
   * error and NOT a read of an enclosing/caller frame's `content`. This is the R16
   * hermetic model: the block-less-include case never needs the caller fallback.
   */
  it('renders empty where @content sits when no block was assigned', async () => {
    expect(await render('@mixin m { .in { @content; } }\n.a { @include m; }')).toBe('');
  });

  /*
   * No cross-frame leak (dart-sass): a block passed to an OUTER mixin does not
   * reach a block-less inner `@include`. `inner`'s `@content` is bound to nothing
   * on `inner`'s own activation, so it splices empty — it does NOT propagate `.a`'s
   * block. (dart-sass rejects this program outright — `Mixin doesn't accept a
   * content block.` at `@include outer { … }` — so no Sass code relies on a leak.)
   */
  it('does not leak an outer block into a block-less inner @include', async () => {
    expect(await render(
      '@mixin inner { .in { @content; } }\n@mixin outer { @include inner; }\n.a { @include outer { color: red; } }'
    )).toBe('');
  });

  /* The published migration path, pinned so the docs claim cannot go stale: an
   * EMPTY block binds `content` to an empty anonymous mixin, so the call
   * resolves and contributes nothing — byte-identical to dart-sass 1.101.0. */
  it('renders nothing, without raising, for an empty assigned block', async () => {
    expect(await render('@mixin m { .in { @content; } }\n.a { @include m { } }')).toBe('');
  });

  it('keeps the mixin\'s own declarations when the assigned block is empty', async () => {
    expect(await render('@mixin m { .in { color: blue; @content; } }\n.a { @include m { } }'))
      .toBe('.a .in {\n  color: blue;\n}\n');
  });

  it('still raises the unbound-reference error for any other name', async () => {
    await expect(render('@mixin m { .in { @include nope-not-bound; } }\n.a { @include m; }'))
      .rejects.toBeTruthy();
  });
});

/*
 * Rule-pin (dart-sass): `@content` binds only to THIS mixin's own `@include`
 * block; it never leaks across frames and a missing block is a no-op, not an
 * error. Pins the three cases so a future re-widening of content resolution
 * (e.g. a caller-fallback read) fails a dedicated named test.
 */
describe('@content no cross-frame leak (dart-sass rule-pin)', () => {
  it('(a) no block bound → empty splice, not an error', async () => {
    expect(await render('@mixin m { .x { @content; } }\n.a { @include m; }')).toBe('');
  });

  it('(b) a block on an outer mixin does NOT reach a block-less inner @include', async () => {
    expect(await render(
      '@mixin inner { .x { @content; } }\n@mixin outer { @include inner; }\n.a { @include outer { color: red; } }'
    )).toBe('');
  });

  it('(c) a direct @include with a block still splices it', async () => {
    expect(await render('@mixin m { .x { @content; } }\n.a { @include m { color: red; } }'))
      .toBe('.a .x {\n  color: red;\n}\n');
  });
});
