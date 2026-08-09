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
      steps: [{ type: 'Call', args: [{ value: { type: 'Lookup', scope: 'live', kind: 'var', name: 'type', raw: '@type' } }] }],
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
    expect(call.args).toEqual([{ value: { type: 'Dimension', number: 1, unit: 'px', src: '1px' } }]);
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
   * OWNER MODEL: `content` is JUST A SCOPED VARIABLE, bound in the call frame
   * when — and only when — the caller passed a block, the way `arguments` is
   * bound in a JS function. `$content()` is then a REGULAR call on that regular
   * variable; the evaluator knows nothing about the name.
   *
   * OWNER RULING — SETTLED: the raise STAYS. A block-less `@include` leaves
   * `content` unbound, and a regular call on an unbound variable is an ordinary
   * resolve failure. This is not a decision about `@content`; it falls out of the
   * model. dart-sass's no-op is a real convenience, but it is only purchasable by
   * teaching the language that `content` is a special name — the exact thing the
   * model removes. Restoring it would mean reintroducing a resolver special case,
   * which is what deleting a sentinel constant and a miss-site hook bought.
   * The divergence is public: see the "Content blocks: `content` is an ordinary
   * variable" entry in
   * `packages/docs/docs-content/docs/shared/04-guides/02-coming-from-sass/04-semantic-differences.mdx`.
   *
   * Migration for a library relying on the no-op: pass an EMPTY block,
   * `@include m { }`. VERIFIED to render identically in jess and dart-sass
   * 1.101.0 — empty output here, and `.a .in { color: blue; }` when the mixin
   * body also carries a declaration of its own.
   *
   * Measured before ruling, over bootstrap 5.3.8 (92 `.scss`) and
   * foundation-sites 6.9.0 (136 `.scss`) — 228 files. Bootstrap: 10 mixins
   * containing `@content`, 287 block-less `@include` sites, 0 on a `@content`
   * mixin. Foundation: 26 such mixins, 651 block-less sites, 5 on a `@content`
   * mixin — all `grid-row`/`flex-grid-row`, whose `@content` sits behind
   * `@if $columns != null`, and every one of those calls leaves `$columns` at its
   * `null` default, so `@content` is never reached. (A sixth apparent hit,
   * `-zf-each-breakpoint-in`, was a scan artifact: that call does pass a block.)
   * ZERO affected files in either. That is the scope of risk on two libraries,
   * NOT proof the pattern is rare in the wild.
   */
  it('raises where @content sits when no block was assigned', async () => {
    await expect(render('@mixin m { .in { @content; } }\n.a { @include m; }'))
      .rejects.toBeTruthy();
  });

  /*
   * Ordinary scoping, not a special case: an `@include` with NO block that runs
   * inside a mixin which DOES have one reads the enclosing frame's `content`.
   * Under "just a scoped variable" the outer binding resolving is CORRECT.
   *
   * Load-bearing for the ruling above: dart-sass does not merely differ here, it
   * REJECTS this program — `Mixin doesn't accept a content block.` at
   * `@include outer { … }`, because `outer` does not itself mention `@content`.
   * So this is not a silent divergence, and no Sass code can be relying on it.
   */
  it('resolves an enclosing frame\'s content binding', async () => {
    expect(await render(
      '@mixin inner { .in { @content; } }\n@mixin outer { @include inner; }\n.a { @include outer { color: red; } }'
    )).toBe('.a .in {\n  color: red;\n}\n');
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
