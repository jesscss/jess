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
   * The direct consequence, recorded here as observed behaviour: a block-less
   * `@include` leaves `content` UNBOUND, and a regular call on an unbound
   * variable is a resolve failure like any other. dart-sass makes this a no-op;
   * jess raises. OPEN — pending an owner ruling on whether the no-op should be
   * restored, and if so by what mechanism. It must NOT be restored by teaching
   * the resolver the name `content`: a sentinel consulted at the miss site is
   * what this model replaced.
   */
  it('raises where @content sits when no block was assigned', async () => {
    await expect(render('@mixin m { .in { @content; } }\n.a { @include m; }'))
      .rejects.toBeTruthy();
  });

  /*
   * Ordinary scoping, not a special case: an `@include` with NO block that runs
   * inside a mixin which DOES have one reads the enclosing frame's `content`.
   * Under "just a scoped variable" the outer binding resolving is CORRECT.
   */
  it('resolves an enclosing frame\'s content binding', async () => {
    expect(await render(
      '@mixin inner { .in { @content; } }\n@mixin outer { @include inner; }\n.a { @include outer { color: red; } }'
    )).toBe('.a .in {\n  color: red;\n}\n');
  });

  it('still raises the unbound-reference error for any other name', async () => {
    await expect(render('@mixin m { .in { @include nope-not-bound; } }\n.a { @include m; }'))
      .rejects.toBeTruthy();
  });
});
