import { parseLessAstStylesheet } from '../src/index.js';
import { N, isNode, serializeTypes } from '@jesscss/core';

describe('parseLessAstStylesheet', () => {
  test('returns a string-backed core Stylesheet for cheap Less declarations', () => {
    const result = parseLessAstStylesheet('inline.less', `
      @tone: red;
      @callish: rgb(10, 20, 30);

      .a {
        @local: 1px;
        color: @tone;
        background: blue !important; // ignored value comment
        --custom:  @local;
      }
    `);
    const [tone, callish, firstRule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(tone, N.VarDeclaration)).toBe(true);
    expect(isNode(callish, N.VarDeclaration)).toBe(true);
    expect(isNode(firstRule, N.Ruleset)).toBe(true);
    if (!isNode(tone, N.VarDeclaration) || !isNode(callish, N.VarDeclaration) || !isNode(firstRule, N.Ruleset)) {
      throw new Error('Expected Less AST proof nodes');
    }

    expect(tone.name.valueOf()).toBe('tone');
    expect(tone.value).toBe('red');
    expect(callish.value).toBe('rgb(10, 20, 30)');
    expect(firstRule.selector).toBe('.a');

    const [local, color, background, custom] = firstRule.rules.rules;
    expect(isNode(local, N.VarDeclaration)).toBe(true);
    expect(isNode(color, N.Declaration)).toBe(true);
    expect(isNode(background, N.Declaration)).toBe(true);
    expect(isNode(custom, N.Declaration)).toBe(true);
    if (
      !isNode(local, N.VarDeclaration)
      || !isNode(color, N.Declaration)
      || !isNode(background, N.Declaration)
      || !isNode(custom, N.Declaration)
    ) {
      throw new Error('Expected Less declaration proof nodes');
    }

    expect(local.name.valueOf()).toBe('local');
    expect(local.value).toBe('1px');
    expect(color.name).toBe('color');
    expect(color.value).toBe('@tone');
    expect(background.important).toBe('!important');
    expect(custom.name).toBe('--custom');
    expect(custom.value).toBe('  @local');
    expect(firstRule.toTrimmedString()).toBe([
      '.a {',
      '  color: @tone;',
      '  background: blue !important;',
      '  --custom:  @local;',
      '}',
      ''
    ].join('\n'));
  });

  test('materializes cheap selector structure and keeps variable values unparsed', () => {
    const result = parseLessAstStylesheet('selectors.less', `
      @tone: red;
      #id.card { color: @tone; }
      .link:hover::before { color: @tone; }
      .a > .b + div { width: @size; }
      [data-x].card { color: black; }
      .æøå { margin: 0; }
    `);
    const [, compoundRule, pseudoRule, complexRule, attributeRule, unicodeRule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(compoundRule, N.Ruleset) && isNode(compoundRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(pseudoRule, N.Ruleset) && isNode(pseudoRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(complexRule, N.Ruleset) && isNode(complexRule.selector, N.ComplexSelector)).toBe(true);
    expect(isNode(attributeRule, N.Ruleset) && isNode(attributeRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(unicodeRule, N.Ruleset) && unicodeRule.selector).toBe('.æøå');
    if (!isNode(compoundRule, N.Ruleset) || !isNode(compoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed compound selector');
    }
    if (!isNode(pseudoRule, N.Ruleset) || !isNode(pseudoRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed pseudo compound selector');
    }
    if (!isNode(complexRule, N.Ruleset) || !isNode(complexRule.selector, N.ComplexSelector)) {
      throw new Error('Expected string-backed complex selector');
    }
    if (!isNode(attributeRule, N.Ruleset) || !isNode(attributeRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed attribute compound selector');
    }
    expect(compoundRule.selector.value).toEqual(['#id', '.card']);
    expect(pseudoRule.selector.value).toEqual(['.link', ':hover', '::before']);
    expect(complexRule.selector.value).toEqual(['.a', '>', '.b', '+', 'div']);
    expect(attributeRule.selector.value).toEqual(['[data-x]', '.card']);
    expect(serializeTypes(compoundRule)).not.toContain('(BasicSelector');
    expect(serializeTypes(pseudoRule)).not.toContain('(PseudoSelector');
    expect(serializeTypes(attributeRule)).not.toContain('(AttributeSelector');
    expect(serializeTypes(complexRule)).not.toContain('(Combinator');
    expect(serializeTypes(result.tree)).toContainString(`
          value: '@tone'
    `);
    expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 'tone'
        value: 'red'
      )
    `);
    expect(serializeTypes(result.tree)).not.toContain('(Any [role=ident]');
    expect(serializeTypes(result.tree)).not.toContain('(Reference');
  });

  test('parses cheap selector lists without materializing selector leaves', () => {
    const result = parseLessAstStylesheet('selector-list.less', `
      h1, h2 > a > p, h3 {
        color: none;
      }
    `);
    const [rule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (!isNode(rule, N.Ruleset)) {
      throw new Error('Expected selector-list ruleset');
    }
    expect(isNode(rule.selector, N.SelectorList)).toBe(true);
    if (!isNode(rule.selector, N.SelectorList)) {
      throw new Error('Expected string-backed selector list');
    }
    expect(rule.selector.value[0]).toBe('h1');
    expect(isNode(rule.selector.value[1], N.ComplexSelector)).toBe(true);
    expect(rule.selector.value[1]?.valueOf()).toBe('h2>a>p');
    expect(rule.selector.value[2]).toBe('h3');
    expect(rule.toTrimmedString()).toBe([
      'h1,',
      'h2 > a > p,',
      'h3 {',
      '  color: none;',
      '}',
      ''
    ].join('\n'));
    const serialized = serializeTypes(rule);
    expect(serialized).toContain('(SelectorList');
    expect(serialized).toContain('[\'h1\', ComplexSelector, \'h3\']');
    expect(serialized).not.toContain('(BasicSelector');
    expect(serialized).not.toContain('(Combinator');
  });

  test('diagnoses malformed selector-list boundaries instead of dropping empty branches', () => {
    const result = parseLessAstStylesheet('selector-list-boundary.less', `
      .a, { color: red; }
      .b,   { color: blue; }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header'
    ]);
  });

  test('keeps interpolated Less selector headers deferred as strings', () => {
    const result = parseLessAstStylesheet('interpolated-selectors.less', `
      @{inputs} {
        .focus { color: red; }
      }

      .host {
        &-bar@{state} { width: 1px; }
        .row:nth-child(@{index}) { height: 2px; }
      }
    `);
    const [interpolatedRoot, host] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(interpolatedRoot, N.Ruleset)).toBe(true);
    expect(isNode(host, N.Ruleset)).toBe(true);
    if (!isNode(interpolatedRoot, N.Ruleset) || !isNode(host, N.Ruleset)) {
      throw new Error('Expected interpolated selector rulesets');
    }
    expect(interpolatedRoot.selector).toBe('@{inputs}');
    const [focusRule] = interpolatedRoot.rules.rules;
    expect(isNode(focusRule, N.Ruleset)).toBe(true);
    expect(isNode(focusRule, N.Ruleset) && focusRule.selector).toBe('.focus');
    const [interpolatedChild, pseudoFunctionChild] = host.rules.rules;
    expect(isNode(interpolatedChild, N.Ruleset)).toBe(true);
    expect(isNode(interpolatedChild, N.Ruleset) && interpolatedChild.selector).toBe('&-bar@{state}');
    expect(isNode(pseudoFunctionChild, N.Ruleset)).toBe(true);
    expect(isNode(pseudoFunctionChild, N.Ruleset) && pseudoFunctionChild.selector).toBe('.row:nth-child(@{index})');
    const serialized = serializeTypes(result.tree);
    expect(serialized).toContain('selector: \'@{inputs}\'');
    expect(serialized).toContain('selector: \'&-bar@{state}\'');
    expect(serialized).toContain('selector: \'.row:nth-child(@{index})\'');
    expect(serialized).not.toContain('(Reference');
    expect(serialized).not.toContain('(Interpolated');
  });

  test('parses nested Less rulesets without fallback parsing', () => {
    const result = parseLessAstStylesheet('nested.less', `
      .outer {
        color: red;
        .inner {
          width: @size;
          #id.card { color: blue; }
        }
        background: green;
      }
    `);
    const [outer] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(outer, N.Ruleset)).toBe(true);
    if (!isNode(outer, N.Ruleset)) {
      throw new Error('Expected outer ruleset');
    }

    const [color, inner, background] = outer.rules.rules;
    expect(isNode(color, N.Declaration)).toBe(true);
    expect(isNode(inner, N.Ruleset)).toBe(true);
    expect(isNode(background, N.Declaration)).toBe(true);
    if (!isNode(color, N.Declaration) || !isNode(inner, N.Ruleset) || !isNode(background, N.Declaration)) {
      throw new Error('Expected declarations around nested ruleset');
    }

    expect(inner.selector).toBe('.inner');
    const [width, compoundRule] = inner.rules.rules;
    expect(isNode(width, N.Declaration)).toBe(true);
    expect(isNode(compoundRule, N.Ruleset)).toBe(true);
    expect(width?.value).toBe('@size');
    expect(isNode(compoundRule, N.Ruleset) && isNode(compoundRule.selector, N.CompoundSelector)).toBe(true);
    if (!isNode(compoundRule, N.Ruleset) || !isNode(compoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed nested compound selector');
    }
    expect(compoundRule.selector.value).toEqual(['#id', '.card']);
    expect(serializeTypes(compoundRule)).not.toContain('(BasicSelector');
    expect(outer.toTrimmedString()).toBe([
      '.outer {',
      '  color: red;',
      '  .inner {',
      '    width: @size;',
      '    #id.card {',
      '      color: blue;',
      '    }',
      '  }',
      '  background: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('parses plain ampersand blocks as scope Rules without selector materialization', () => {
    const result = parseLessAstStylesheet('ampersand-scope.less', `
      & {
        @tone: red;
        .inner { color: @tone; }
      }

      .outer {
        & {
          color: blue;
        }
        width: 1px;
      }
    `);
    const [rootScope, outer] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(rootScope, N.Rules)).toBe(true);
    expect(isNode(outer, N.Ruleset)).toBe(true);
    if (!isNode(rootScope, N.Rules) || !isNode(outer, N.Ruleset)) {
      throw new Error('Expected ampersand scope rules and outer ruleset');
    }

    expect(isNode(rootScope.rules[0], N.VarDeclaration)).toBe(true);
    expect(isNode(rootScope.rules[1], N.Ruleset)).toBe(true);
    const [nestedScope, width] = outer.rules.rules;
    expect(isNode(nestedScope, N.Rules)).toBe(true);
    expect(isNode(width, N.Declaration)).toBe(true);
    if (!isNode(nestedScope, N.Rules)) {
      throw new Error('Expected nested ampersand scope rules');
    }

    expect(nestedScope.toTrimmedString()).toBe('color: blue;');
    expect(outer.toTrimmedString()).toBe([
      '.outer {',
      '  color: blue;',
      '  width: 1px;',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(result.tree)).not.toContain('(Ampersand');
    expect(serializeTypes(result.tree)).not.toContain('selector: \'&\'');
  });

  test('keeps ampersand suffix selector headers deferred as strings', () => {
    const result = parseLessAstStylesheet('ampersand-suffix.less', `
      .host {
        &1 { width: 1px; }
        &:focus { color: red; }
        &-item { height: 2px; }
      }
    `);
    const [host] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(host, N.Ruleset)).toBe(true);
    if (!isNode(host, N.Ruleset)) {
      throw new Error('Expected host ruleset');
    }
    const [numbered, focus, item] = host.rules.rules;
    expect(isNode(numbered, N.Ruleset)).toBe(true);
    expect(isNode(focus, N.Ruleset)).toBe(true);
    expect(isNode(item, N.Ruleset)).toBe(true);
    expect(isNode(numbered, N.Ruleset) && numbered.selector).toBe('&1');
    expect(isNode(focus, N.Ruleset) && focus.selector).toBe('&:focus');
    expect(isNode(item, N.Ruleset) && item.selector).toBe('&-item');
    const serialized = serializeTypes(host);
    expect(serialized).toContain('selector: \'&1\'');
    expect(serialized).toContain('selector: \'&:focus\'');
    expect(serialized).toContain('selector: \'&-item\'');
    expect(serialized).not.toContain('(Ampersand');
  });

  test('parses cheap guarded Less blocks as string-backed guards without fallback parsing', () => {
    const result = parseLessAstStylesheet('guarded.less', `
      .enabled when (@enabled = true) {
        color: green;
      }

      .paint(@tone) when (@tone = red) {
        color: @tone;
      }

      & when (@debug = 1) {
        .debug { outline: 1px solid red; }
      }

      .negated when not (@debug) {
        display: none;
      }

      div when {
        color: blue;
      }
    `);
    const [guardedRule, guardedMixin, guardedScope, negated, whenSelector] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(guardedRule, N.Ruleset)).toBe(true);
    expect(isNode(guardedMixin, N.Mixin)).toBe(true);
    expect(isNode(guardedScope, N.Ruleset)).toBe(true);
    expect(isNode(negated, N.Ruleset)).toBe(true);
    expect(isNode(whenSelector, N.Ruleset)).toBe(true);
    if (
      !isNode(guardedRule, N.Ruleset)
      || !isNode(guardedMixin, N.Mixin)
      || !isNode(guardedScope, N.Ruleset)
      || !isNode(negated, N.Ruleset)
      || !isNode(whenSelector, N.Ruleset)
    ) {
      throw new Error('Expected guarded Less block nodes');
    }

    expect(guardedRule.selector).toBe('.enabled');
    expect(guardedRule.guard).toBe('(@enabled = true)');
    expect(guardedMixin.name?.valueOf()).toBe('.paint');
    expect(guardedMixin.guard).toBe('(@tone = red)');
    expect(isNode(guardedScope.selector, N.Nil)).toBe(true);
    expect(guardedScope.guard).toBe('(@debug = 1)');
    expect(isNode(guardedScope.rules.rules[0], N.Ruleset)).toBe(true);
    expect(negated.selector).toBe('.negated');
    expect(negated.guard).toBe('not (@debug)');
    expect(isNode(whenSelector.selector, N.ComplexSelector)).toBe(true);
    expect(whenSelector.guard).toBeUndefined();
    expect(serializeTypes(result.tree)).not.toContain('(Condition');
    expect(serializeTypes(result.tree)).not.toContain('selector: \'&\'');
  });

  test('parses parameterless Less mixin definitions without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-definition.less', `
      .paint() {
        color: red;
        .nested { width: @size; }
      }

      #theme() {
        background: blue;
      }
    `);
    const [paint, theme] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(paint, N.Mixin)).toBe(true);
    expect(isNode(theme, N.Mixin)).toBe(true);
    if (!isNode(paint, N.Mixin) || !isNode(theme, N.Mixin)) {
      throw new Error('Expected parameterless Less mixin definitions');
    }
    expect(paint.name?.valueOf()).toBe('.paint');
    expect(paint.params).toBeUndefined();
    expect(paint.rules.rules[0]?.toTrimmedString()).toBe('color: red');
    expect(paint.rules.rules[1]?.toTrimmedString()).toBe([
      '.nested {',
      '  width: @size;',
      '}',
      ''
    ].join('\n'));
    expect(theme.name?.valueOf()).toBe('#theme');
    expect(theme.rules.rules[0]?.toTrimmedString()).toBe('background: blue');
    expect(serializeTypes(result.tree)).toContainString(`
      (Mixin
        name: (Any [role=name] '.paint')
    `);
  });

  test('parses cheap Less mixin definition parameters without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-params.less', `
      .paint(@tone; @size) {
        color: @tone;
        width: @size;
      }

      #theme(@mode, @contrast) {
        color: @mode;
      }

      .trail(@tone;) {
        color: @tone;
      }

      .defaulted(@tone: red; @shadow : 1px 2px, blue) {
        color: @tone;
      }

      .resty(@head, @tail...) {
        width: @head;
      }

      .all(...) {
        color: red;
      }

      .commaDefault(@margin: 2, 2, 2, 2) {
        margin: @margin;
      }

      .case(1) {
        case: 1;
      }

      .mixout('left') {
        left: 1;
      }

      .border-side(left, @width) {
        border-left: @width;
      }
    `);
    const [paint, theme, trail, defaulted, resty, all, commaDefault, numericCase, quotedCase, mixedPattern] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(paint, N.Mixin)).toBe(true);
    expect(isNode(theme, N.Mixin)).toBe(true);
    expect(isNode(trail, N.Mixin)).toBe(true);
    expect(isNode(defaulted, N.Mixin)).toBe(true);
    expect(isNode(resty, N.Mixin)).toBe(true);
    expect(isNode(all, N.Mixin)).toBe(true);
    expect(isNode(commaDefault, N.Mixin)).toBe(true);
    expect(isNode(numericCase, N.Mixin)).toBe(true);
    expect(isNode(quotedCase, N.Mixin)).toBe(true);
    expect(isNode(mixedPattern, N.Mixin)).toBe(true);
    if (
      !isNode(paint, N.Mixin)
      || !isNode(theme, N.Mixin)
      || !isNode(trail, N.Mixin)
      || !isNode(defaulted, N.Mixin)
      || !isNode(resty, N.Mixin)
      || !isNode(all, N.Mixin)
      || !isNode(commaDefault, N.Mixin)
      || !isNode(numericCase, N.Mixin)
      || !isNode(quotedCase, N.Mixin)
      || !isNode(mixedPattern, N.Mixin)
    ) {
      throw new Error('Expected parameterized Less mixin definition');
    }
    expect(paint.name?.valueOf()).toBe('.paint');
    expect(isNode(paint.params, N.List)).toBe(true);
    expect(paint.params?.sep).toBe(';');
    expect(paint.params?.items.map(item => item.toTrimmedString())).toEqual(['$tone', '$size']);
    expect(serializeTypes(paint)).toContainString(`
        params:
          (List
            items:
              [
                (VarDeclaration
                  name:
                    (Any [role=property] 'tone')
                  value:
                    (Nil '')
                )
                (VarDeclaration
                  name:
                    (Any [role=property] 'size')
                  value:
                    (Nil '')
                )
              ]
          )
    `);
    expect(theme.name?.valueOf()).toBe('#theme');
    expect(theme.params?.sep).toBe(',');
    expect(theme.params?.items.map(item => item.toTrimmedString())).toEqual(['$mode', '$contrast']);
    expect(trail.params?.sep).toBe(';');
    expect(trail.params?.items.map(item => item.toTrimmedString())).toEqual(['$tone']);
    expect(defaulted.params?.sep).toBe(';');
    expect(defaulted.params?.items.map(item => item.toTrimmedString())).toEqual([
      '$tone: red',
      '$shadow: 1px 2px, blue'
    ]);
    expect(resty.params?.sep).toBe(',');
    expect(resty.params?.items.map(item => item.type)).toEqual(['VarDeclaration', 'Rest']);
    expect(resty.params?.items[0]?.toTrimmedString()).toBe('$head');
    expect(isNode(resty.params?.items[1], N.Rest)).toBe(true);
    if (!isNode(resty.params?.items[1], N.Rest)) {
      throw new Error('Expected named rest parameter');
    }
    expect(resty.params.items[1].node).toBe('tail');
    expect(isNode(all.params?.items[0], N.Rest)).toBe(true);
    if (!isNode(all.params?.items[0], N.Rest)) {
      throw new Error('Expected anonymous rest parameter');
    }
    expect(all.params.items[0].node).toBeUndefined();
    expect(commaDefault.params?.sep).toBe(',');
    expect(commaDefault.params?.items).toHaveLength(1);
    expect(commaDefault.params?.items[0]?.toTrimmedString()).toBe('$margin: 2, 2, 2, 2');
    expect(numericCase.params?.items[0]?.type).toBe('Num');
    expect(numericCase.params?.items[0]?.valueOf()).toBe(1);
    expect(quotedCase.params?.items[0]?.type).toBe('Quoted');
    expect(quotedCase.params?.items[0]?.toTrimmedString()).toBe('\'left\'');
    expect(mixedPattern.params?.items.map(item => item.type)).toEqual(['Any', 'VarDeclaration']);
    expect(mixedPattern.params?.items.map(item => item.toTrimmedString())).toEqual(['left', '$width']);
    expect(serializeTypes(result.tree)).toContain('(Rest');
  });

  test('keeps unsupported Less mixin parameter forms out of the cheap AST path', () => {
    const result = parseLessAstStylesheet('unsupported-mixin-params.less', `
      .badMixed(@a; @b, @c) { color: @a; }
      .badDefaultComma(@a: 1, , @b) { color: @a; }
      .badRestOrder(@a..., @b) { color: @b; }
      .1(@a) { color: red; }
      .-(@a) { color: red; }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header'
    ]);
  });

  test('parses parameterless Less mixin calls without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-calls.less', `
      .paint();
      #theme() !important;

      .a {
        .nested();
      }
    `);
    const [paint, theme, rule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(paint, N.Call)).toBe(true);
    expect(isNode(theme, N.Call)).toBe(true);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (!isNode(paint, N.Call) || !isNode(theme, N.Call) || !isNode(rule, N.Ruleset)) {
      throw new Error('Expected parameterless Less mixin calls');
    }
    expect(isNode(paint.name, N.Reference)).toBe(true);
    expect(isNode(theme.name, N.Reference)).toBe(true);
    if (!isNode(paint.name, N.Reference) || !isNode(theme.name, N.Reference)) {
      throw new Error('Expected Less mixin call references');
    }
    expect(paint.name.key).toBe('.paint');
    expect(paint.name.options.type).toBe('mixin-ruleset');
    expect(paint.name.options.role).toBe('name');
    expect(paint.args).toBeUndefined();
    expect(theme.name.key).toBe('#theme');
    expect(theme.name.options.type).toBe('mixin-ruleset');
    expect(theme.name.options.role).toBe('name');
    expect(theme.options.markImportant).toBe(true);

    const [nested] = rule.rules.rules;
    expect(isNode(nested, N.Call)).toBe(true);
    if (!isNode(nested, N.Call) || !isNode(nested.name, N.Reference)) {
      throw new Error('Expected nested parameterless mixin call');
    }
    expect(nested.name.key).toBe('.nested');
    expect(serializeTypes(result.tree)).toContainString(`
      (Call
        name:
          (Reference [role=name]
            key: '.paint'
          )
      )
    `);
  });

  test('parses argument-bearing Less mixin calls without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-calls-with-args.less', `
      .withArgs(@tone, 2px);
      #theme(red; screen and (min-width: 1px)) !important;
      .named(@tone: red, @size: 2px);
      .semiNamed(@tone: red; @shadow: 1px 2px, blue);
      .semiList(1px, 2px; 3px);
      .semiTrail(1px;);
      .spread(@items...);
      .spreadSemi(0; @items...);
      .spreadMixed(@items..., @tone: red);
      .spreadAnon(...);

      .a {
        .nested(rgb(10, 20, 30), "{");
      }
    `);
    const [
      withArgs,
      theme,
      named,
      semiNamed,
      semiList,
      semiTrail,
      spread,
      spreadSemi,
      spreadMixed,
      spreadAnon,
      rule
    ] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(withArgs, N.Call)).toBe(true);
    expect(isNode(theme, N.Call)).toBe(true);
    expect(isNode(named, N.Call)).toBe(true);
    expect(isNode(semiNamed, N.Call)).toBe(true);
    expect(isNode(semiList, N.Call)).toBe(true);
    expect(isNode(semiTrail, N.Call)).toBe(true);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (
      !isNode(withArgs, N.Call)
      || !isNode(theme, N.Call)
      || !isNode(named, N.Call)
      || !isNode(semiNamed, N.Call)
      || !isNode(semiList, N.Call)
      || !isNode(semiTrail, N.Call)
      || !isNode(spread, N.Call)
      || !isNode(spreadSemi, N.Call)
      || !isNode(spreadMixed, N.Call)
      || !isNode(spreadAnon, N.Call)
      || !isNode(rule, N.Ruleset)
    ) {
      throw new Error('Expected argument-bearing Less mixin calls');
    }
    expect(isNode(withArgs.args, N.List)).toBe(true);
    expect(isNode(theme.args, N.List)).toBe(true);
    expect(isNode(named.args, N.List)).toBe(true);
    expect(isNode(semiNamed.args, N.List)).toBe(true);
    expect(isNode(semiList.args, N.List)).toBe(true);
    expect(isNode(semiTrail.args, N.List)).toBe(true);
    if (
      !isNode(withArgs.args, N.List)
      || !isNode(theme.args, N.List)
      || !isNode(named.args, N.List)
      || !isNode(semiNamed.args, N.List)
      || !isNode(semiList.args, N.List)
      || !isNode(semiTrail.args, N.List)
      || !isNode(spread.args, N.List)
      || !isNode(spreadSemi.args, N.List)
      || !isNode(spreadMixed.args, N.List)
      || !isNode(spreadAnon.args, N.List)
    ) {
      throw new Error('Expected Less mixin call argument lists');
    }
    expect(withArgs.args.sep).toBe(',');
    expect(withArgs.args.items.map(item => item.valueOf())).toEqual(['@tone', '2px']);
    expect(theme.args.sep).toBe(';');
    expect(theme.args.items.map(item => item.valueOf())).toEqual(['red', 'screen and (min-width: 1px)']);
    expect(theme.options.markImportant).toBe(true);
    expect(named.args.sep).toBe(',');
    expect(named.args.items.map(item => item.toTrimmedString())).toEqual(['$tone: red', '$size: 2px']);
    expect(named.args.items.every(item => isNode(item, N.VarDeclaration))).toBe(true);
    expect(semiNamed.args.sep).toBe(';');
    expect(semiNamed.args.items.map(item => item.toTrimmedString())).toEqual([
      '$tone: red',
      '$shadow: 1px 2px, blue'
    ]);
    expect(semiNamed.args.items.every(item => isNode(item, N.VarDeclaration))).toBe(true);
    expect(semiList.args.sep).toBe(';');
    expect(semiList.args.items.map(item => item.valueOf())).toEqual(['1px, 2px', '3px']);
    expect(semiTrail.args.sep).toBe(';');
    expect(semiTrail.args.items.map(item => item.valueOf())).toEqual(['1px']);
    expect(spread.args.items[0]?.type).toBe('Rest');
    expect(isNode(spread.args.items[0], N.Rest)).toBe(true);
    expect(isNode(spread.args.items[0], N.Rest) && isNode(spread.args.items[0].node, N.Reference)).toBe(true);
    if (!isNode(spread.args.items[0], N.Rest) || !isNode(spread.args.items[0].node, N.Reference)) {
      throw new Error('Expected named spread argument to wrap a variable reference');
    }
    expect(spread.args.items[0].node.key).toBe('items');
    expect(spread.args.items[0].node.options.type).toBe('variable');
    expect(spreadSemi.args.sep).toBe(';');
    expect(spreadSemi.args.items.map(item => item.type)).toEqual(['Any', 'Rest']);
    expect(spreadMixed.args.sep).toBe(',');
    expect(spreadMixed.args.items.map(item => item.type)).toEqual(['Rest', 'VarDeclaration']);
    expect(spreadAnon.args.items[0]?.type).toBe('Rest');
    expect(isNode(spreadAnon.args.items[0], N.Rest) && spreadAnon.args.items[0].node).toBeUndefined();

    const [nested] = rule.rules.rules;
    expect(isNode(nested, N.Call)).toBe(true);
    if (!isNode(nested, N.Call) || !isNode(nested.args, N.List)) {
      throw new Error('Expected nested argument-bearing mixin call');
    }
    expect(nested.args.items.map(item => item.valueOf())).toEqual(['rgb(10, 20, 30)', '"{"']);
    expect(serializeTypes(result.tree)).toContainString(`
      (Call
        name:
          (Reference [role=name]
            key: '.withArgs'
          )
        args:
          (List
            items:
              [
                (Any '@tone')
                (Any '2px')
              ]
          )
      )
    `);
  });

  test('parses namespaced Less mixin calls as reference key arrays', () => {
    const result = parseLessAstStylesheet('namespaced-mixin-calls.less', `
      #ns.mixin(1);
      #library.core.colors();
      #theme.dark.navbar() !important;
      #theme > .mixin();
      #namespace .borders();

      .a {
        #theme.dark.navbar.colors(dark);
        #guarded > #deeper > .mixin(1);
      }
    `);
    const [namespaceCall, libraryCall, themedCall, childCall, descendantCall, rule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(namespaceCall, N.Call)).toBe(true);
    expect(isNode(libraryCall, N.Call)).toBe(true);
    expect(isNode(themedCall, N.Call)).toBe(true);
    expect(isNode(childCall, N.Call)).toBe(true);
    expect(isNode(descendantCall, N.Call)).toBe(true);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (
      !isNode(namespaceCall, N.Call)
      || !isNode(libraryCall, N.Call)
      || !isNode(themedCall, N.Call)
      || !isNode(childCall, N.Call)
      || !isNode(descendantCall, N.Call)
      || !isNode(rule, N.Ruleset)
    ) {
      throw new Error('Expected namespaced Less mixin calls');
    }
    expect(isNode(namespaceCall.name, N.Reference)).toBe(true);
    expect(isNode(libraryCall.name, N.Reference)).toBe(true);
    expect(isNode(themedCall.name, N.Reference)).toBe(true);
    expect(isNode(childCall.name, N.Reference)).toBe(true);
    expect(isNode(descendantCall.name, N.Reference)).toBe(true);
    if (
      !isNode(namespaceCall.name, N.Reference)
      || !isNode(libraryCall.name, N.Reference)
      || !isNode(themedCall.name, N.Reference)
      || !isNode(childCall.name, N.Reference)
      || !isNode(descendantCall.name, N.Reference)
    ) {
      throw new Error('Expected namespaced Less mixin call references');
    }
    expect(namespaceCall.name.key).toEqual(['#ns', '.mixin']);
    expect(libraryCall.name.key).toEqual(['#library', '.core', '.colors']);
    expect(themedCall.name.key).toEqual(['#theme', '.dark', '.navbar']);
    expect(childCall.name.key).toEqual(['#theme', '.mixin']);
    expect(descendantCall.name.key).toEqual(['#namespace', '.borders']);
    expect(themedCall.options.markImportant).toBe(true);

    const [nested, nestedChild] = rule.rules.rules;
    expect(isNode(nested, N.Call)).toBe(true);
    expect(isNode(nestedChild, N.Call)).toBe(true);
    if (
      !isNode(nested, N.Call)
      || !isNode(nested.name, N.Reference)
      || !isNode(nestedChild, N.Call)
      || !isNode(nestedChild.name, N.Reference)
    ) {
      throw new Error('Expected nested namespaced Less mixin call');
    }
    expect(nested.name.key).toEqual(['#theme', '.dark', '.navbar', '.colors']);
    expect(nestedChild.name.key).toEqual(['#guarded', '#deeper', '.mixin']);
    expect(serializeTypes(result.tree)).toContainString(`
      (Call
        name:
          (Reference [role=name]
            key:
              ['#ns', '.mixin']
          )
        args:
          (List
            items:
              [
                (Any '1')
              ]
          )
      )
    `);
  });

  test('parses root Less function calls as fallback function references', () => {
    const result = parseLessAstStylesheet('root-functions.less', `
      test-collapse();
      store(@var);
      store(5);
      store("bird");
      test-atrule("@charset"; '"utf-8"');
      grouped(a, b; c);
      escaped(~(a, b); c);
      e('/* anything to unquote */');
    `);
    const [collapse, storeVar, storeNumber, storeString, atRule, grouped, escaped, escape] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    for (const node of [collapse, storeVar, storeNumber, storeString, atRule, grouped, escaped, escape]) {
      expect(isNode(node, N.Call)).toBe(true);
      if (!isNode(node, N.Call) || !isNode(node.name, N.Reference)) {
        throw new Error('Expected root function call with reference name');
      }
      expect(node.name.options.type).toBe('function');
      expect(node.name.options.fallbackValue).toBe(true);
      expect(node.options.silentFail).toBe(true);
    }
    if (
      !isNode(collapse, N.Call)
      || !isNode(storeVar, N.Call)
      || !isNode(storeNumber, N.Call)
      || !isNode(storeString, N.Call)
      || !isNode(atRule, N.Call)
      || !isNode(grouped, N.Call)
      || !isNode(escaped, N.Call)
      || !isNode(escape, N.Call)
      || !isNode(collapse.name, N.Reference)
      || !isNode(storeVar.name, N.Reference)
      || !isNode(storeNumber.name, N.Reference)
      || !isNode(storeString.name, N.Reference)
      || !isNode(atRule.name, N.Reference)
      || !isNode(grouped.name, N.Reference)
      || !isNode(escaped.name, N.Reference)
      || !isNode(escape.name, N.Reference)
      || !isNode(storeVar.args, N.List)
      || !isNode(storeNumber.args, N.List)
      || !isNode(storeString.args, N.List)
      || !isNode(atRule.args, N.List)
      || !isNode(grouped.args, N.List)
      || !isNode(escaped.args, N.List)
      || !isNode(escape.args, N.List)
    ) {
      throw new Error('Expected concrete root function call shapes');
    }

    expect(collapse.name.key).toBe('test-collapse');
    expect(collapse.args).toBeUndefined();
    expect(storeVar.name.key).toBe('store');
    expect(storeVar.args.items[0]?.type).toBe('Reference');
    expect(isNode(storeVar.args.items[0], N.Reference) && storeVar.args.items[0].options.type).toBe('variable');
    expect(isNode(storeVar.args.items[0], N.Reference) && storeVar.args.items[0].key).toBe('var');
    expect(storeNumber.args.items[0]?.type).toBe('Num');
    expect(storeNumber.args.items[0]?.valueOf()).toBe(5);
    expect(storeString.args.items[0]?.type).toBe('Quoted');
    expect(storeString.args.items[0]?.toTrimmedString()).toBe('"bird"');
    expect(atRule.name.key).toBe('test-atrule');
    expect(atRule.args.sep).toBe(';');
    expect(atRule.args.items.map(item => item.toTrimmedString())).toEqual(['"@charset"', '\'"utf-8"\'']);
    expect(grouped.args.sep).toBe(';');
    expect(grouped.args.items[0]?.type).toBe('List');
    expect(isNode(grouped.args.items[0], N.List) && grouped.args.items[0].items.map(item => item.valueOf())).toEqual(['a', 'b']);
    expect(grouped.args.items[1]?.valueOf()).toBe('c');
    expect(escaped.args.sep).toBe(';');
    expect(escaped.args.items[0]?.type).toBe('Paren');
    expect(escaped.args.items[0]?.toTrimmedString()).toBe('~(a, b)');
    expect(escaped.args.items[1]?.valueOf()).toBe('c');
    expect(escape.name.key).toBe('e');
    expect(escape.args.items.map(item => item.toTrimmedString())).toEqual(['\'/* anything to unquote */\'']);

    const serialized = serializeTypes(result.tree, { showOptions: true });
    expect(serialized).toContain('type: \'function\'');
    expect(serialized).toContain('fallbackValue: true');
    expect(serialized).toContain('silentFail: true');
    expect(serialized).not.toContain('(Declaration');
    expect(serialized).not.toContain('raw');
  });

  test('keeps block-valued function statements out of the cheap function path', () => {
    const result = parseLessAstStylesheet('function-blocks.less', `
      each(@list, { color: @value; });
      if((false), {g: 7});
      func(a b);
      func(rgb(1, 2, 3));
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement'
    ]);
  });

  test('keeps unsupported Less mixin call forms out of the cheap AST path', () => {
    const result = parseLessAstStylesheet('unsupported-mixin-calls.less', `
      .empty(,);
      .suffix(a) b;
      #ns.mixin extra;
      .emptySemiComma(a; ,);
      .trailingSemiComma(a; b,);
      .doubleSemiComma(a; b,, c);
      .badSpread(foo...);
      .bad([oops)]);
      .deprecated;
      #theme > .mixin;
      .1();
      .-();
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement'
    ]);
  });

  test('diagnoses malformed Less at-rule blocks without fallback parsing', () => {
    const result = parseLessAstStylesheet('unsupported.less', `
      @ {
        .inside { color: red; }
      }

      .outer {
        .nested { color: blue; }
      }

      .kept {
        color: green;
      }
    `);

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-at-rule'
    ]);
    expect(result.tree.rules).toHaveLength(2);
    expect(result.tree.rules[0]?.toTrimmedString()).toBe([
      '.outer {',
      '  .nested {',
      '    color: blue;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(result.tree.rules[1]?.toTrimmedString()).toBe([
      '.kept {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('parses cheap block at-rules with string-backed headers', () => {
    const result = parseLessAstStylesheet('at-rule.less', `
      @media screen {
        .inside { color: red; }
      }
    `);
    const [media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected string-backed AtRule');
    }
    expect(media.name).toBe('@media');
    expect(media.prelude).toBe('screen');
    expect(media.toTrimmedString()).toBe([
      '@media screen {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(media)).toContainString(`
      (AtRule
        name: '@media'
        prelude: 'screen'
    `);
    expect(serializeTypes(media)).not.toContain('(Any [role=atkeyword]');
  });

  test('parses keyframe selector headers only inside keyframes bodies', () => {
    const result = parseLessAstStylesheet('keyframes.less', `
      @keyframes fade {
        from {
          opacity: 0;
          0% { opacity: 0; }
        }
        5.5% { opacity: .5; }
        0%, 100% { opacity: 1; }
      }

      0% { opacity: 0; }
    `);
    const [keyframes] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header'
    ]);
    expect(isNode(keyframes, N.AtRule)).toBe(true);
    if (!isNode(keyframes, N.AtRule)) {
      throw new Error('Expected keyframes AtRule');
    }
    const [from, decimal, endpoints] = keyframes.rules?.rules ?? [];
    expect(isNode(from, N.Ruleset) && from.selector).toBe('from');
    expect(isNode(decimal, N.Ruleset) && decimal.selector).toBe('5.5%');
    expect(isNode(endpoints, N.Ruleset)).toBe(true);
    if (!isNode(endpoints, N.Ruleset)) {
      throw new Error('Expected comma-list keyframe ruleset');
    }
    expect(isNode(endpoints.selector, N.SelectorList)).toBe(true);
    expect(endpoints.selector.valueOf()).toBe('0%,100%');
    const serialized = serializeTypes(keyframes);
    expect(serialized).toContain('selector: \'from\'');
    expect(serialized).toContain('selector: \'5.5%\'');
    expect(serialized).toContain('(SelectorList');
    expect(serialized).not.toContain('(BasicSelector');
  });

  test('parses balanced block at-rule preludes into query-ready nodes', () => {
    const result = parseLessAstStylesheet('media-query.less', `
      @media screen and (min-width: 1px) {
        .inside { color: red; }
      }
    `);
    const [media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected query-backed AtRule');
    }
    expect(typeof media.prelude).not.toBe('string');
    expect(media.prelude?.toTrimmedString()).toBe('screen and (min-width: 1px)');
    expect(media.toTrimmedString()).toBe([
      '@media screen and (min-width: 1px) {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(media)).toContainString(`
        prelude:
          (QueryCondition
            items:
              [
                (Any 'screen')
                (Any 'and')
                (Paren
                  node:
                    (Any 'min-width: 1px')
    `);
  });

  test('parses cheap comma-list at-rule preludes without widening raw strings', () => {
    const result = parseLessAstStylesheet('media-query-list.less', `
      @media screen and (min-width: 1px), print {
        .inside { color: red; }
      }
    `);
    const [media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected list-backed AtRule');
    }
    expect(isNode(media.prelude, N.List)).toBe(true);
    if (!isNode(media.prelude, N.List)) {
      throw new Error('Expected comma-list AtRule prelude');
    }
    expect(media.prelude.sep).toBeUndefined();
    expect(media.prelude.items[0]?.toTrimmedString()).toBe('screen and (min-width: 1px)');
    expect(media.prelude.items[1]?.toTrimmedString()).toBe('print');
    expect(media.toTrimmedString()).toBe([
      '@media screen and (min-width: 1px), print {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    const serialized = serializeTypes(media);
    expect(serialized).toContain('(List');
    expect(serialized).toContain('(QueryCondition');
    expect(serialized).toContain('(Any \'print\')');
    expect(serialized).not.toContain('prelude: \'screen and (min-width: 1px), print\'');
  });

  test('keeps structured Less at-rule preludes deferred as strings', () => {
    const result = parseLessAstStylesheet('deferred-media.less', `
      @media screen and (foo, bar) {
        .comma { color: red; }
      }

      @media screen and (foo, bar), print {
        .nestedComma { color: green; }
      }

      @media (@{bp}) {
        .interpolated { color: blue; }
      }

      @media @{bp} {
        .topLevelInterpolation { color: purple; }
      }
    `);
    const [comma, nestedComma, interpolated, topLevelInterpolation] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(comma, N.AtRule)).toBe(true);
    expect(isNode(nestedComma, N.AtRule)).toBe(true);
    expect(isNode(interpolated, N.AtRule)).toBe(true);
    expect(isNode(topLevelInterpolation, N.AtRule)).toBe(true);
    if (
      !isNode(comma, N.AtRule)
      || !isNode(nestedComma, N.AtRule)
      || !isNode(interpolated, N.AtRule)
      || !isNode(topLevelInterpolation, N.AtRule)
    ) {
      throw new Error('Expected deferred Less at-rule preludes');
    }
    expect(comma.prelude).toBe('screen and (foo, bar)');
    expect(nestedComma.prelude).toBe('screen and (foo, bar), print');
    expect(interpolated.prelude).toBe('(@{bp})');
    expect(topLevelInterpolation.prelude).toBe('@{bp}');
    expect(interpolated.toTrimmedString()).toBe([
      '@media (@{bp}) {',
      '  .interpolated {',
      '    color: blue;',
      '  }',
      '}',
      ''
    ].join('\n'));
    const serialized = serializeTypes(result.tree);
    expect(serialized).toContain('prelude: \'screen and (foo, bar)\'');
    expect(serialized).toContain('prelude: \'screen and (foo, bar), print\'');
    expect(serialized).toContain('prelude: \'(@{bp})\'');
    expect(serialized).toContain('prelude: \'@{bp}\'');
    expect(serialized).not.toContain('(QueryCondition');
  });

  test('diagnoses malformed deferred Less at-rule preludes', () => {
    const result = parseLessAstStylesheet('malformed-deferred-media.less', `
      @media } {
        .bad { color: red; }
      }

      @media @{bp {
        .badInterpolation { color: blue; }
      }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-at-rule',
      'less-ast-unsupported-trailing-source'
    ]);
  });

  test('diagnoses unsupported Less block headers instead of creating raw selector rulesets', () => {
    const result = parseLessAstStylesheet('unsupported-block.less', `
      .mixin(@x, , @y) { color: @x; }
      .mixin-@{name}(@x, , @y) { color: @x; }
      .a {
        .b:hover(.c) { color: blue; }
        color: red;
      }
    `);
    const [rule] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header'
    ]);
    expect(result.tree.rules).toHaveLength(1);
    expect(rule?.toTrimmedString()).toBe([
      '.a {',
      '  color: red;',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(result.tree)).not.toContain('.mixin(@x, , @y)');
    expect(serializeTypes(result.tree)).not.toContain('.mixin-@{name}(@x, , @y)');
  });

  test('parses detached ruleset variable values as string-backed mixins', () => {
    const result = parseLessAstStylesheet('detached-ruleset.less', `
      @ruleset: {
        color: black;
        .nested { width: @size; }
      };
    `);
    const [rulesetVariable] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(rulesetVariable, N.VarDeclaration)).toBe(true);
    if (!isNode(rulesetVariable, N.VarDeclaration) || !isNode(rulesetVariable.value, N.Mixin)) {
      throw new Error('Expected detached ruleset variable with anonymous mixin value');
    }
    expect(rulesetVariable.value.rules.options.rulesVisibility).toEqual({
      Declaration: 'public',
      Mixin: 'private',
      Ruleset: 'public',
      VarDeclaration: 'private'
    });
    expect(serializeTypes(rulesetVariable)).toContainString(`
      (VarDeclaration
        name: 'ruleset'
        value:
          (Mixin
            rules:
              (Rules
                rules:
                  [
                    (Declaration
                      name: 'color'
                      value: 'black'
                    )
                    (Ruleset
                      selector: '.nested'
                      rules:
                        (Rules
                          rules:
                            [
                              (Declaration
                                name: 'width'
                                value: '@size'
                              )
                            ]
                        )
                    )
                  ]
              )
          )
      )
    `);
  });

  test('diagnoses empty declaration names inside rulesets', () => {
    const result = parseLessAstStylesheet('empty-name.less', '.a { : red; color: green; }');
    const [rule] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-empty-declaration-name'
    ]);
    expect(isNode(rule, N.Ruleset) && rule.rules.rules).toHaveLength(1);
    expect(rule?.toTrimmedString()).toBe([
      '.a {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });
});
