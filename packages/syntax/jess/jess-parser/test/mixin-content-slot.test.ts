/**
 * The `:`-introduced content block on a Jess mixin CALL —
 * `$ > m(callArgs): (params)? { body }` — the owner's `.jess` spelling
 * (2026-09-06) of what Sass writes `@include m { … }`.
 *
 * This is a GRAMMAR-ONLY surface: the block lowers to the SAME
 * `MixinCall.content` `AnonymousMixin` the SCSS `@include` block already
 * builds, so the existing dialect-agnostic dispatch (`mixin-dispatch.ts` binds
 * `content` in the call frame; `$content()` reads it) evaluates it unchanged.
 * The assertions here are about NODE IDENTITY with the SCSS path, not a new
 * shape — see `scss-parser/test/content-block-and-return.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { MixinCall, Stylesheet } from '@jesscss/core/ast';
import { parse } from '../src/index.js';
import { parse as parseScss } from '../../../scss/scss-parser/src/index.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { makeLessRegistry } from '../../../../fns/src/index.js';

/** Drop span slots so a tree compares by structure. */
const shape = (node: unknown): unknown =>
  JSON.parse(JSON.stringify(node, (key, value) => (key.startsWith('_') ? undefined : value)));

/** The mixin call nested one ruleset deep — typed navigation, no casts. */
const nestedCall = (sheet: Stylesheet): MixinCall => {
  const ruleset = sheet.rules[0];
  if (ruleset?.type !== 'Ruleset') {
    throw new TypeError('expected a top-level ruleset');
  }
  const call = ruleset.rules[0];
  if (call?.type !== 'MixinCall') {
    throw new TypeError('expected a nested mixin call');
  }
  return call;
};

const render = async (source: string): Promise<string> =>
  (await serialize(parse(source), { evaluator: buildEvaluator({ functions: makeLessRegistry() }) })).css;

describe('jess mixin-call content slot — grammar', () => {
  it('puts the block on MixinCall.content, not in the argument list', () => {
    const call = nestedCall(parse('.a { $>m(1px): { color: red; } }'));
    expect(shape(call.args)).toEqual([{ value: { type: 'Dimension', number: 1, unit: 'px', src: '1px' }, spread: false }]);
    expect(shape(call.content)).toEqual({
      type: 'AnonymousMixin',
      rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' }, merge: null, important: false }]
    });
  });

  it('lowers the `(params)` block header to the content AnonymousMixin.params', () => {
    const call = nestedCall(parse('.a { $>m(): ($t) { color: $t; } }'));
    expect(call.content?.params).toEqual([{ name: 't' }]);
  });

  it('leaves a block-less call with a null content slot', () => {
    expect(nestedCall(parse('.a { $>m(1px); }')).content).toBeNull();
  });

  it('builds the SAME content node the SCSS `@include` block builds', () => {
    const fromJess = nestedCall(parse('.a { $>m(): { color: red; } }')).content;
    const fromScss = nestedCall(parseScss('.a { @include m { color: red; } }')).content;
    expect(shape(fromJess)).toEqual(shape(fromScss));
  });

  it('rewinds the optional content slot when a `:`-leading sibling is not a block', () => {
    /*
     * No `;` after the call, and the next statement starts with `:`. The content
     * arm speculatively matches that `:`, then fails at its required `{` (the next
     * token is `hover`, not `{`) and must rewind so the sibling parses. Proves
     * `optional(MixinContentBlock)` does not swallow an unrelated `:`.
     */
    const sheet = parse('.a {\n  $>m()\n  :hover { color: red; }\n}');
    const ruleset = sheet.rules[0];
    if (ruleset?.type !== 'Ruleset') {
      throw new TypeError('expected a top-level ruleset');
    }
    const [call, sibling] = ruleset.rules;
    if (call?.type !== 'MixinCall') {
      throw new TypeError('expected a mixin call first');
    }
    expect(call.content).toBeNull();
    expect(sibling?.type).toBe('Ruleset');
    if (sibling?.type === 'Ruleset') {
      expect(sibling.selector.selectors[0]?.type).toBe('SimpleSelector');
      expect(shape(sibling.selector.selectors[0])).toMatchObject({ text: ':hover' });
    }
  });
});

describe('jess mixin-call content slot — end to end', () => {
  it('renders the assigned block where `$content()` sits', async () => {
    expect(await render('m() {\n  .in { $content(); }\n}\n.a {\n  $>m(): { color: red; }\n}'))
      .toBe('.a .in {\n  color: red;\n}\n');
  });

  it('binds a `(params)` block\'s parameter to a `$content($v)` argument', async () => {
    /*
     * The block header `($t)` names the block's parameter; a value-position
     * `$content($v)` call passes `$v` and yields the block's `result:`. (Jess's
     * argument-bearing call is value-position; statement-position `$content()`
     * remains argument-less — see the PR's verify notes.)
     */
    expect(await render('m($v) {\n  .in { color: $content($v); }\n}\n.a {\n  $>m(red): ($t) { result: $t; }\n}'))
      .toBe('.a .in {\n  color: red;\n}\n');
  });

  it('resolves call-site variables from inside the assigned block', async () => {
    expect(await render('$g: green;\nm() {\n  .in { $content(); }\n}\n.a {\n  $>m(): { color: $g; }\n}'))
      .toBe('.a .in {\n  color: green;\n}\n');
  });

  it('still dispatches a plain call with no content block', async () => {
    expect(await render('m() {\n  color: red;\n}\n.a {\n  $>m();\n}'))
      .toBe('.a {\n  color: red;\n}\n');
  });

  it('renders nothing, without raising, for an empty assigned block', async () => {
    expect(await render('m() {\n  .in { $content(); }\n}\n.a {\n  $>m(): { }\n}')).toBe('');
  });
});
