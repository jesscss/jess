import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { cssBaseMathOutsideParens,
  compoundSelectorOf, complexSelector, decl, dimension, funcCall, interpolatedSimpleSelector, interpolation, keyword, operation, quoted, selist, spaced, stylesheet, rule, variableDeclaration, variableReference,
  type MixinCall, type MixinDefinition, type Stylesheet, type Statement
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { Context } from '../../context.js';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

const call = (name: string, args: MixinCall['args'] = []): MixinCall => ({
  type: 'MixinCall', name, args, path: [], important: false, content: null
});

const mixin = (
  name: string,
  params: MixinDefinition['params'],
  rules: Statement[],
  guard?: MixinDefinition['guard']
): MixinDefinition => ({ type: 'MixinDefinition', name, params, rules, ...(guard ? { guard } : {}) });

describe('Mixin canonical AST emission', () => {
  it('errors for an unresolved mixin independently of functionMode', () => {
    const context = new Context({ functionMode: 'error' });
    const document = stylesheet([rule('.out', [call('.missing')])]);

    expect(() => serialize(document, { context, evaluator, collapseNesting: true }))
      .toThrow(/Name not found/);
  });

  it('errors when visible mixin definitions cannot bind the call arguments', () => {
    const document = stylesheet([
      mixin('.m', [{ pattern: keyword('saxofon') }], []),
      rule('.out', [call('.m', [{ value: keyword('trumpete') }])])
    ]);

    expect(() => serialize(document, { evaluator, collapseNesting: true }))
      .toThrow(/Name not found/);
  });

  it('deduplicates exact declarations from matching overloads and repeated calls', () => {
    const first = mixin('.same', [], [decl('color', keyword('red'))]);
    const second = mixin('.same', [], [decl('color', keyword('red'))]);
    const document = stylesheet([
      first,
      second,
      rule('.out', [call('.same'), call('.same')])
    ]);

    /*
     * The canonical engine keeps one exact declaration even when it was
     * contributed by several matching definitions and several calls. Authored
     * and expanded output share the same declaration-dedup rule.
     */
    expect(render(document)).toBe('.out {\n  color: red;\n}\n');
  });

  it('does not deduplicate mixin declarations with distinct importance', () => {
    const normal = mixin('.same', [], [decl('color', keyword('red'))]);
    const important = mixin('.same', [], [decl('color', keyword('red'), null, true)]);
    const document = stylesheet([normal, important, rule('.out', [call('.same')])]);

    expect(render(document)).toBe('.out {\n  color: red;\n  color: red !important;\n}\n');
  });

  it('terminates guarded recursion through direct guard and operation nodes', () => {
    const loop = mixin('.loop', [{ name: 'n' }], [
      decl('step', variableReference('n', 'scoped')),
      call('.loop', [{ value: operation('-', variableReference('n', 'scoped'), dimension(1), false, cssBaseMathOutsideParens('-')) }])
    ], {
      g: 'cmp', op: '>', left: variableReference('n', 'scoped'), right: dimension(0)
    });
    const document = stylesheet([loop, rule('.out', [call('.loop', [{ value: dimension(3) }])])]);

    expect(render(document)).toBe('.out {\n  step: 3;\n  step: 2;\n  step: 1;\n}\n');
  });

  it('continues past an enclosing same-name ruleset mixin to an outer mixin definition', () => {
    const document = stylesheet([
      mixin('.recursion', [], [decl('color', keyword('black'))]),
      rule('.test-rule-rec', [
        rule('.recursion', [call('.recursion')])
      ])
    ]);

    expect(render(document)).toBe('.test-rule-rec .recursion {\n  color: black;\n}\n');
  });

  it('selects an overload while evaluating a default in the callee closure', () => {
    const small = mixin('.space', [{ name: 'n' }, { name: 'gap', default: operation('+', variableReference('n', 'scoped'), dimension(1), false, cssBaseMathOutsideParens('+')) }], [
      decl('kind', { type: 'Keyword', src: 'small' }),
      decl('gap', variableReference('gap', 'scoped'))
    ], { g: 'cmp', op: '<', left: variableReference('n', 'scoped'), right: dimension(10) });
    const large = mixin('.space', [{ name: 'n' }, { name: 'gap', default: dimension(99) }], [
      decl('kind', { type: 'Keyword', src: 'large' }),
      decl('gap', variableReference('gap', 'scoped'))
    ], { g: 'cmp', op: '>=', left: variableReference('n', 'scoped'), right: dimension(10) });
    const document = stylesheet([
      small,
      large,
      rule('.small', [variableDeclaration('n', dimension(40), { mode: 'declare' }), call('.space', [{ value: dimension(4) }])]),
      rule('.large', [call('.space', [{ value: dimension(12) }])])
    ]);

    expect(render(document)).toBe('.small {\n  kind: small;\n  gap: 5;\n}\n'
      + '.large {\n  kind: large;\n  gap: 99;\n}\n');
  });

  it('compares a false parameter against default() as the typed Less keyword', () => {
    const trueCase = mixin('.m', [{ name: 'x' }], [decl('case', variableReference('x', 'scoped'))], {
      g: 'cmp', op: '=', left: variableReference('x', 'scoped'), right: keyword('true')
    });
    const falseCase = mixin('.m', [{ name: 'x' }], [decl('case', variableReference('x', 'scoped'))], {
      g: 'cmp', op: '=', left: variableReference('x', 'scoped'), right: keyword('false')
    });
    const defaultCase = mixin('.m', [{ name: 'x' }], [decl('default', variableReference('x', 'scoped'))], {
      g: 'cmp', op: '=', left: variableReference('x', 'scoped'), right: funcCall('default', [])
    });
    const document = stylesheet([
      trueCase,
      falseCase,
      defaultCase,
      rule('.out', [call('.m', [{ value: keyword('false') }])])
    ]);

    expect(render(document)).toBe('.out {\n  case: false;\n  default: false;\n}\n');
  });

  it('does not select not(default()) when no ordinary overload matches', () => {
    const exact = mixin('.m', [{ pattern: dimension(1) }], [decl('case', dimension(1))]);
    const nonDefault = mixin('.m', [{ name: 'x' }], [decl('default', variableReference('x', 'scoped'))], {
      g: 'not', inner: { g: 'default' }
    });
    const document = stylesheet([
      exact,
      nonDefault,
      rule('.one', [call('.m', [{ value: dimension(1) }])]),
      rule('.two', [call('.m', [{ value: dimension(2) }])])
    ]);

    expect(render(document)).toBe('.one {\n  case: 1;\n  default: 1;\n}\n');
  });

  it('runs a synchronous Context-owned default-guard body once', () => {
    const exact = mixin('.m', [{ pattern: dimension(1) }], [decl('case', dimension(1))]);
    const fallback = mixin('.m', [{ name: 'x' }], [decl('default', variableReference('x', 'scoped'))], { g: 'default' });
    const document = stylesheet([exact, fallback, rule('.out', [call('.m', [{ value: dimension(1) }])])]);
    const context = new Context();
    context.withDocumentBody = <T>(_body: object, run: () => T): T => run();

    expect(serialize(document, { evaluator, context }).css)
      .toBe('.out {\n  case: 1;\n}\n');
  });

  it('runs an asynchronous Context-owned default-guard body once', async () => {
    const fallback = mixin('.m', [{ name: 'x' }], [decl('default', variableReference('x', 'scoped'))], { g: 'default' });
    const document = stylesheet([fallback, rule('.out', [call('.m', [{ value: dimension(2) }])])]);
    const context = new Context();
    context.withDocumentBody = <T>(_body: object, run: () => T): Promise<T> => Promise.resolve().then(run);

    await expect(Promise.resolve(serialize(document, { evaluator, context })))
      .resolves.toEqual({ css: '.out {\n  default: 2;\n}\n' });
  });

  it('carries a nested-output property merge through an inline ruleset mixin', () => {
    const document = stylesheet([
      rule('.base', [decl('box-shadow', keyword('first'), ',')]),
      rule('.out', [call('.base'), decl('box-shadow', keyword('second'), ',')])
    ]);

    expect(render(document, false)).toBe('.base {\n  box-shadow: first;\n}\n'
      + '.out {\n  box-shadow: first, second;\n}\n');
  });

  /*
   * An escaped quoted operand stays TYPED — it lowers to opaque unquoted bytes,
   * not to a bare identifier — and takes §4.1's STRING ground against the number:
   * `"5" > "4"`. Less 4.x answered `false` to both `<` and `>` here and selected
   * only the `not(=)` overload; §4.2 forbids that pair of falses, so the `>`
   * overload now selects too. The ground is the same one equality reads, which is
   * why `not(@a = @b)` still matches.
   */
  it('keeps an escaped quoted guard operand typed instead of re-materializing its bytes', () => {
    const less = mixin('.m', [{ name: 'a' }, { name: 'b' }], [decl('order', keyword('less'))], {
      g: 'cmp', op: '<', left: variableReference('a', 'scoped'), right: variableReference('b', 'scoped')
    });
    const greater = mixin('.m', [{ name: 'a' }, { name: 'b' }], [decl('order', keyword('greater'))], {
      g: 'cmp', op: '>', left: variableReference('a', 'scoped'), right: variableReference('b', 'scoped')
    });
    const unequal = mixin('.m', [{ name: 'a' }, { name: 'b' }], [decl('order', keyword('unequal'))], {
      g: 'not', inner: { g: 'cmp', op: '=', left: variableReference('a', 'scoped'), right: variableReference('b', 'scoped') }
    });
    const document = stylesheet([
      less,
      greater,
      unequal,
      rule('.out', [call('.m', [{ value: dimension(5) }, { value: quoted('~"4"', '4', '"', true) }])])
    ]);

    expect(render(document)).toBe('.out {\n  order: greater;\n  order: unequal;\n}\n');
  });

  it('preserves typed space-list units through a mixin guard binding', () => {
    const equal = mixin('.m', [{ name: 'a' }, { name: 'b' }], [decl('match', keyword('yes'))], {
      g: 'cmp', op: '=', left: variableReference('a', 'scoped'), right: variableReference('b', 'scoped')
    });
    const document = stylesheet([
      equal,
      rule('.out', [call('.m', [
        { value: spaced([dimension(1), dimension(2, 'px'), dimension(300, 'ms')]) },
        { value: spaced([dimension(1, 'em'), dimension(2), dimension(0.3, 's')]) }
      ])])
    ]);

    expect(render(document)).toBe('.out {\n  match: yes;\n}\n');
  });

  it('canonically emits a leading-decimal dimension carried through a mixin binding', () => {
    const output = mixin('.m', [{ name: 'duration' }], [decl('duration', variableReference('duration', 'scoped'))]);
    const document = stylesheet([
      output,
      rule('.out', [call('.m', [{ value: dimension(0.3, 's', '.3s') }])])
    ]);

    expect(render(document)).toBe('.out {\n  duration: 0.3s;\n}\n');
  });

  it('filters guarded and parametric namespace containers before mixin descent', () => {
    const active = mixin('#guarded', [], [mixin('.mixin', [], [decl('active', keyword('yes'))])], {
      g: 'cmp', op: '>', left: variableReference('namespaceGuard', 'scoped'), right: dimension(0)
    });
    const needsArgument = mixin('#guarded', [{ name: 'value' }], [mixin('.mixin', [], [decl('argument', keyword('wrong'))])]);
    const inactive = mixin('#guarded', [], [mixin('.mixin', [], [decl('guard', keyword('wrong'))])], {
      g: 'cmp', op: '<', left: variableReference('namespaceGuard', 'scoped'), right: dimension(0)
    });
    const guardedRule = rule('#top', [
      rule('#deeper', [mixin('.mixin', [], [decl('rule-guard', keyword('wrong'))])], undefined, {
        g: 'cmp', op: '<', left: variableReference('namespaceGuard', 'scoped'), right: dimension(0)
      }),
      rule('#deeper', [mixin('.mixin', [{ name: 'value' }], [decl('nested', variableReference('value', 'scoped'))])])
    ]);
    const guardedCall: MixinCall = {
      type: 'MixinCall', name: '.mixin', args: [],
      path: [{ combinator: '>' as const, selector: '#guarded' }], important: false, content: null
    };
    const deeperCall: MixinCall = {
      type: 'MixinCall', name: '.mixin', args: [{ value: dimension(1) }],
      path: [{ combinator: '>' as const, selector: '#top' }, { combinator: '>' as const, selector: '#deeper' }], important: false, content: null
    };
    const document = stylesheet([
      variableDeclaration('namespaceGuard', dimension(1), { mode: 'declare' }),
      active,
      needsArgument,
      inactive,
      guardedRule,
      rule('.out', [guardedCall]),
      rule('.deeper', [deeperCall])
    ]);

    expect(render(document)).toBe('.out {\n  active: yes;\n}\n.deeper {\n  nested: 1;\n}\n');
  });

  it('unlocks a parameter-bound variable for later canonical siblings', () => {
    const set = mixin('.set', [{ name: 'value' }], [variableDeclaration('shared', variableReference('value', 'scoped'), { mode: 'declare' })]);
    const document = stylesheet([
      set,
      call('.set', [{ value: dimension(7, 'px') }]),
      rule('.out', [decl('width', variableReference('shared', 'scoped'))])
    ]);

    expect(render(document)).toBe('.out {\n  width: 7px;\n}\n');
  });

  it('places one shared mixin body correctly in flat and nested output modes', () => {
    const box = mixin('.box', [], [
      decl('color', { type: 'Keyword', src: 'red' }),
      rule('.inner', [decl('width', dimension(1, 'px'))])
    ]);
    const document = stylesheet([box, rule('.outer', [call('.box')])]);

    expect(render(document)).toBe('.outer {\n  color: red;\n}\n'
      + '.outer .inner {\n  width: 1px;\n}\n');
    expect(render(document, false)).toBe('.outer {\n  color: red;\n  .inner {\n    width: 1px;\n  }\n}\n');
  });

  it('projects only a selected ruleset-mixin ampersand header in nested output', () => {
    const rulesetMixin = rule('.shell', [
      rule('.ordinary', [decl('state', keyword('literal'))]),
      rule('&-active', [decl('state', keyword('on'))]),
      rule('&-later', [decl('state', keyword('literal'))])
    ]);
    const document = stylesheet([
      rulesetMixin,
      rule('.host', [call('.shell')]),
      rule('.authored', [rule('&-local', [decl('state', keyword('literal'))])])
    ]);

    expect(render(document, false)).toBe('.shell {\n'
      + '  .ordinary {\n'
      + '    state: literal;\n'
      + '  }\n'
      + '  &-active {\n'
      + '    state: on;\n'
      + '  }\n'
      + '  &-later {\n'
      + '    state: literal;\n'
      + '  }\n'
      + '}\n'
      + '.host {\n'
      + '  .ordinary {\n'
      + '    state: literal;\n'
      + '  }\n'
      + '  .host-active {\n'
      + '    state: on;\n'
      + '  }\n'
      + '  &-later {\n'
      + '    state: literal;\n'
      + '  }\n'
      + '}\n'
      + '.authored {\n'
      + '  &-local {\n'
      + '    state: literal;\n'
      + '  }\n'
      + '}\n');
  });

  it('groups only adjacent equal evaluated root headers in nested output', () => {
    const evaluatedSame = selist(complexSelector([{
      term: compoundSelectorOf([interpolatedSimpleSelector(interpolation([
        { lit: '.' }, { ref: variableReference('name', 'scoped'), unquote: true }
      ]))])
    }]));
    const document = stylesheet([
      variableDeclaration('name', keyword('same'), { mode: 'declare' }),
      rule(evaluatedSame, [decl('first', dimension(1))]),
      rule(evaluatedSame, [decl('second', dimension(2))]),
      variableDeclaration('gap', dimension(0), { mode: 'declare' }),
      rule(evaluatedSame, [decl('third', dimension(3))]),
      rule('.other', [decl('fourth', dimension(4))])
    ]);

    expect(render(document, false)).toBe('.same {\n  first: 1;\n  second: 2;\n}\n'
      + '.same {\n  third: 3;\n}\n'
      + '.other {\n  fourth: 4;\n}\n');
  });

  it('publishes an explicit mixin ruleset placement for a later namespaced call', () => {
    const namedPerson = rule(selist(complexSelector([{
      term: compoundSelectorOf([interpolatedSimpleSelector(interpolation([
        { lit: '.' }, { ref: variableReference('name', 'scoped'), unquote: true }
      ]))])
    }])), [
      variableDeclaration('gender', variableReference('gender', 'scoped'), { mode: 'declare' }),
      mixin('.sayGender', [], [decl('gender', variableReference('gender', 'scoped'))])
    ]);
    const person = mixin('.Person', [{ name: 'name' }, { name: 'gender' }], [namedPerson]);
    const sayGender: MixinCall = {
      type: 'MixinCall', name: '.sayGender', args: [],
      path: [{ combinator: ' ' as const, selector: '.person' }], important: false, content: null
    };
    const document = stylesheet([
      person,
      rule('mi-test-d', [
        call('.Person', [{ value: keyword('person') }, { value: quoted('"Male"', 'Male', '"') }]),
        sayGender
      ])
    ]);

    expect(render(document, false)).toBe('mi-test-d {\n  gender: "Male";\n}\n');
  });

  it('projects only exact synthesized-rule-mixin amp shells', () => {
    const source = rule('.source', [rule('.inside', [decl('x', dimension(1))])]);
    const explicit = mixin('.explicit', [], [decl('x', dimension(2))]);
    const document = stylesheet([
      source,
      explicit,
      rule('.host', [
        rule('&-one', [call('.source')]),
        rule('&-two', [call('.source')])
      ]),
      rule('.authored', [rule('&-literal', [decl('x', dimension(3))])]),
      rule('.explicit-host', [rule('&-literal', [call('.explicit')])]),
      rule('.multi', [rule('&-literal', [call('.source'), call('.source')])])
    ]);

    const nested = render(document, false)!;
    expect(nested).toContain('.host-one {\n  .inside {\n    x: 1;\n  }\n}\n');
    expect(nested).toContain('.host-two {\n  .inside {\n    x: 1;\n  }\n}\n');
    expect(nested).toContain('.authored {\n  &-literal {\n    x: 3;\n  }\n}\n');
    expect(nested).toContain('.explicit-host {\n  &-literal {\n    x: 2;\n  }\n}\n');
    expect(nested).toContain('.multi {\n  &-literal {\n    .inside {\n      x: 1;\n    }\n    .inside {\n      x: 1;\n    }\n  }\n}\n');
    expect(render(document)).toContain('.host-one .inside {\n  x: 1;\n}\n');
  });

  /*
   * §4.2a. A groundless relational in GUARD position is a NON-MATCH, not a
   * compile error: `.generic(1, true)` selects only the definitions whose guards
   * can answer, and the `<` / `>` overloads simply do not apply. lessc 4.6.3
   * emits exactly this, and so does the owner-maintained expected CSS for
   * `tests-unit/mixins-guards/mixins-guards.less`.
   *
   * Erroring here is the regression this pins: one non-matching candidate in an
   * overload set would fail a stylesheet that never selects it.
   */
  it('treats a groundless relational mixin guard as a non-match, not an error', () => {
    const params: MixinDefinition['params'] = [{ name: 'a' }, { name: 'b' }];
    const left = variableReference('a', 'scoped');
    const right = variableReference('b', 'scoped');
    const document = stylesheet([
      mixin('.generic', params, [decl('content', keyword('less'))], { g: 'match', op: '<', left, right }),
      mixin('.generic', params, [decl('content', keyword('greater'))], { g: 'match', op: '>', left, right }),
      mixin('.generic', params, [decl('content', keyword('unequal'))], {
        g: 'not', inner: { g: 'match', op: '=', left, right }
      }),
      rule('.out', [call('.generic', [{ value: dimension(1) }, { value: keyword('true') }])])
    ]);

    expect(render(document)).toBe('.out {\n  content: unequal;\n}\n');
  });

  /*
   * The same operand pair in VALUE position still raises (§4.2). The two
   * positions are distinguished by the node's own `g` and by nothing else, so
   * pinning one without the other would not show the distinction exists.
   */
  it('still errors for the same groundless pair in value position', () => {
    const document = stylesheet([
      mixin('.generic', [{ name: 'a' }, { name: 'b' }], [decl('content', keyword('less'))], {
        g: 'cmp', op: '<', left: variableReference('a', 'scoped'), right: variableReference('b', 'scoped')
      }),
      rule('.out', [call('.generic', [{ value: dimension(1) }, { value: keyword('true') }])])
    ]);

    /*
     * Asserted on the STRUCTURED error, not on `message`. The raise is wrapped
     * into `eval/incomparable-operands` at the arithmetic site, so the summary
     * is the code's and the operand prose lives in `reason` — checking the code
     * plus the reason pins both the classification and the explanation, where a
     * regex over `message` pinned neither.
     */
    expect(() => render(document)).toThrow(
      expect.objectContaining({
        code: 'eval/incomparable-operands',
        reason: expect.stringContaining('share no common ground')
      })
    );
  });
});
