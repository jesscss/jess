import { run } from 'parseman';
import { sourceSpanOf, type InterpPart, type SelectorBranch, type SelectorTerm, type Stylesheet, type Ruleset, type SimpleToken } from '@jesscss/core/ast';
import { JessError } from '@jesscss/core';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parseJessCst } from '../src/cst.js';
import { parse } from '../src/index.js';
import { jessAstGrammar } from '../src/grammar.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && Array.isArray(value.rules);
}

function stylesheet(value: unknown): Stylesheet {
  if (!isStylesheet(value)) {
    throw new TypeError('Expected the Jess grammar to produce a Stylesheet');
  }
  return value;
}

function firstSelectorTerm(branch: SelectorBranch | undefined): SelectorTerm | undefined {
  if (branch === undefined) {
    return undefined;
  }
  if (branch.type === 'ComplexSelector') {
    return branch.value[0];
  }
  if (branch.type === 'RelativeSelector') {
    return branch.value[1];
  }
  return branch;
}

function expectExplicitListSeparators(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectExplicitListSeparators);
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.type === 'List') {
    expect(value.sep).toSatisfy(separator => separator === ',' || separator === '/');
  }
  Object.values(value).forEach(expectExplicitListSeparators);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasCstGrammar(node: unknown, grammarType: string): boolean {
  if (typeof node !== 'object' || node === null) {
    return false;
  }
  if ('grammarType' in node && node.grammarType === grammarType) {
    return true;
  }
  return 'rules' in node && Array.isArray(node.rules)
    && node.rules.some(child => hasCstGrammar(child, grammarType));
}

describe('Jess AST grammar facts', () => {
  it('keeps ordinary adjacency as a raw value array and reserves List for explicit separators', () => {
    const direct = run(
      jessAstGrammar.Stylesheet,
      '$space: red blue; $comma: red, blue; $w: 1; .x { slash: $w / 2; }',
      { trivia: jessAstGrammar.whitespace }
    );
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(stylesheet(direct.value).rules).toMatchObject([
      { type: 'VariableDeclaration', name: 'space', value: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }] },
      { type: 'VariableDeclaration', name: 'comma', value: { type: 'List', sep: ',' } },
      { type: 'VariableDeclaration', name: 'w' },
      { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'slash', value: { type: 'List', sep: '/' } }] }
    ]);
    expectExplicitListSeparators(direct.value);
  });

  it('constructs ordered $if / $else if / $else branches directly and renders only the selected branch', () => {
    const source = '$theme: "dark"; $if ($theme = "light") { .card { color: black; } } $else if ($theme = "dark") { .card { color: white; } } $else { .card { color: gray; } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'theme' },
        {
          type: 'If',
          branches: [
            { guard: { g: 'cmp', op: '=' }, rules: [{ type: 'Ruleset' }] },
            { guard: { g: 'cmp', op: '=' }, rules: [{ type: 'Ruleset' }] },
            { guard: null, rules: [{ type: 'Ruleset' }] }
          ]
        }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe('.card {\n  color: white;\n}\n');
  });

  it('constructs strict logical $if guard trees directly and evaluates their selected branch', () => {
    const source = '$enabled: true; $disabled: false; $if ((($enabled=true) and not($disabled)) or false) { .card { color: green; } } $else { .card { color: red; } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'enabled' },
        { type: 'VariableDeclaration', name: 'disabled' },
        {
          type: 'If',
          branches: [
            {
              guard: {
                g: 'or',
                left: {
                  g: 'and',
                  left: { g: 'cmp', op: '=' },
                  right: { g: 'not', inner: { g: 'truth' } }
                },
                right: { g: 'truth' }
              }
            },
            { guard: null }
          ]
        }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe('.card {\n  color: green;\n}\n');
  });

  it('retains CST-admitted adjacent $if comparison operators through public parse and render', () => {
    const source = '$size: 6; $if ($size>5) { .card { color: green; } } $else { .card { color: red; } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      rules: [{ type: 'VariableDeclaration', name: 'size' }, {
        type: 'If', branches: [{ guard: { g: 'cmp', op: '>' } }, { guard: null }]
      }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe('.card {\n  color: green;\n}\n');
  });

  it('rejects mixin-only and ungrouped logical forms in direct $if conditions', () => {
    for (const source of [
      '$if ($a = true and $b = false) { color: red; }',
      '$if (true and false or true) { color: red; }',
      '$if (default()) { color: red; }',
      '$if ($type.iscolor(red)) { color: red; }',
      '$if (not true) { color: red; }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('publishes selected branch declarations into the containing live and scoped stores', () => {
    const source = '$tone: gray; $if (true) { $tone := blue; $$tone := navy; $if (true) { $nested: green; } } .after { live: $tone; scoped: $$tone; nested: $$nested; }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'tone', write: { mode: 'declare' } },
        {
          type: 'If',
          branches: [{
            rules: [
              { type: 'VariableDeclaration', name: 'tone', write: { mode: 'reassign', lookup: 'live' } },
              { type: 'VariableDeclaration', name: 'tone', write: { mode: 'reassign', lookup: 'scoped' } },
              { type: 'If', branches: [{ rules: [{ type: 'VariableDeclaration', name: 'nested', write: { mode: 'declare' } }] }] }
            ]
          }]
        },
        { type: 'Ruleset' }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.after {\n  live: blue;\n  scoped: navy;\n  nested: green;\n}\n'
    );
  });

  it('keeps unselected branch declarations isolated and publishes the selected else arm', () => {
    const source = '$tone: gray; $if (false) { $tone := red; $$tone := maroon; } $else { $tone := blue; $$tone := navy; } .after { live: $tone; scoped: $$tone; }';

    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.after {\n  live: blue;\n  scoped: navy;\n}\n'
    );
  });

  it('makes a selected $if mixin definition available only after its reached statement', () => {
    const source = '$if (true) { paint() { color: blue; } .after { $ > paint(); } }';

    expect(parse(source)).toMatchObject({
      rules: [{
        type: 'If',
        branches: [{ rules: [
          { type: 'MixinDefinition', name: 'paint' },
          { type: 'Ruleset', selector: { type: 'SelectorList' } }
        ] }]
      }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.after {\n  color: blue;\n}\n'
    );

    const beforeDefinition = '$if (true) { .before { $ > paint(); } paint() { color: blue; } }';
    expect(() => serialize(parse(beforeDefinition), { evaluator: buildEvaluator(makeLessRegistry()) }))
      .toThrow(/Name not found/);
  });

  it('keeps false-arm mixins invisible and preserves A/$if(B)/C definition order', () => {
    const ordered = 'paint() { color: a; } $if (true) { paint() { color: b; } } paint() { color: c; } .after { $ > paint(); }';
    const falseArm = '$if (false) { paint() { color: wrong; } } .after { $ > paint(); }';

    expect(serialize(parse(ordered), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.after {\n  color: a;\n  color: b;\n  color: c;\n}\n'
    );
    expect(() => serialize(parse(falseArm), { evaluator: buildEvaluator(makeLessRegistry()) }))
      .toThrow(/Name not found/);
  });

  it('keeps selected $if mixin definitions in their parameterized activation closure', () => {
    const source = 'outer($tone) { $if (true) { paint() { color: $tone; } } .inside { $ > paint(); } } .one { $ > outer(red); } .two { $ > outer(blue); }';

    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.one .inside {\n  color: red;\n}\n.two .inside {\n  color: blue;\n}\n'
    );

    const outsideActivation = `${source} .after { $ > paint(); }`;
    expect(() => serialize(parse(outsideActivation), { evaluator: buildEvaluator(makeLessRegistry()) }))
      .toThrow(/Name not found/);
  });

  it('admits existing callable and loop statements inside selected direct $if bodies', () => {
    const source = 'paint() { color: red; } $held: @{ background: blue; }; $items: one, two; .host { $if (true) { $ > paint(); $held(); $apply .unused; $for ($item of $items) { .item-${item} { order: $item; } } } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'MixinDefinition' },
        { type: 'VariableDeclaration' },
        { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [{ type: 'If', branches: [{ rules: [
          { type: 'MixinCall', name: 'paint' },
          { type: 'Reference', base: { type: 'VariableReference', name: 'held', lookup: 'live' }, steps: [{ type: 'Call', args: [] }], raw: '$held()' },
          { type: 'Apply', selectors: [{ type: 'SimpleSelector', text: '.unused' }] },
          { type: 'For', binding: { kind: 'single', name: 'item' } }
        ] }] }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.host {\n  color: red;\n  background: blue;\n}\n.host .item-one {\n  order: one;\n}\n.host .item-two {\n  order: two;\n}\n'
    );
  });

  it('does not execute any newly admitted statement form from a false $if arm', () => {
    const source = 'paint() { color: red; } $held: @{ background: blue; }; $items: one, two; .host { $if (false) { $ > paint(); $held(); $apply .unused; $for ($item of $items) { .item-${item} { order: $item; } } } }';
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe('');
  });

  it('keeps imports held inside direct $if bodies', () => {
    for (const source of [
      '$if (true) { @-compose "./theme.jess"; }',
      '$if (true) { @-use "sass:math"; }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('constructs a first-class class-only Apply fact and rejects broader targets by default', () => {
    const source = '$apply .rounded, .shadow;';
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ rules: [{
      type: 'Apply', selectors: [
        { type: 'SimpleSelector', text: '.rounded' },
        { type: 'SimpleSelector', text: '.shadow' }
      ]
    }] });
    for (const invalid of ['$apply #theme;', '$apply button[data-x]:hover;', '$apply paint;', '$apply $[.rounded];', '$apply .rounded-$[tone];']) {
      const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && (() => {
        try {
          parse(invalid);
          return true;
        } catch {
          return false;
        }
      })()).toBe(false);
    }
    expect(() => parse('$apply #theme;', { allowApplySelectors: ['basic'] })).not.toThrow();
    expect(() => parse('$apply button[data-x]:hover;', { allowApplySelectors: ['compound'] })).not.toThrow();

    expect(serialize(parse('.rounded { border: solid; } .card { $apply .rounded; }')).css).toBe(
      '.rounded {\n  border: solid;\n}\n.card {\n  border: solid;\n}\n'
    );
  });

  it('keeps $apply first-class inside mixin and $for bodies', () => {
    const source = '.paint { color: red; } wrapper() { $apply .paint; } $items: one, two; .host { $ > wrapper(); $for ($item of $items) { $apply .paint; } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'Ruleset' },
        { type: 'MixinDefinition', name: 'wrapper', rules: [{ type: 'Apply', selectors: [{ type: 'SimpleSelector', text: '.paint' }] }] },
        { type: 'VariableDeclaration', name: 'items' },
        { type: 'Ruleset', rules: [{ type: 'MixinCall', name: 'wrapper' }, { type: 'For', rules: [{ type: 'Apply', selectors: [{ type: 'SimpleSelector', text: '.paint' }] }] }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.paint {\n  color: red;\n}\n.host {\n  color: red;\n  color: red;\n  color: red;\n}\n'
    );
    expect(() => parse('wrapper() { $apply $[paint]; }')).toThrow(SyntaxError);
  });

  it('applies allowExtendSelectors to Jess $extend targets', () => {
    expect(() => parse('.source { $extend .target; }')).not.toThrow();
    expect(() => parse('.source { $extend #target; }')).toThrow(SyntaxError);
    expect(() => parse('.source { $extend .target; }', { allowExtendSelectors: ['class'] })).not.toThrow();
    expect(() => parse('.source { $extend #target; }', { allowExtendSelectors: ['class'] })).toThrow(SyntaxError);
    expect(() => parse('.source { $extend #target; }', { allowExtendSelectors: ['basic'] })).not.toThrow();
  });

  it('hoists rule-body static $extend targets while rejecting unrepresentable root and dynamic forms', () => {
    const source = '.target { color: red; } .source { $extend .target, .other !exact; }';
    const cst = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'Ruleset', selector: { type: 'SelectorList' } },
        {
          type: 'Ruleset', extendInstructions: [
            { target: { type: 'SelectorList' }, partial: false },
            { target: { type: 'SelectorList' }, partial: false }
          ]
        }
      ]
    });
    expect(serialize(parse('.target { color: red; } .source { $extend .target; }')).css).toBe(
      '.target,\n.source {\n  color: red;\n}\n'
    );

    for (const invalid of ['$extend .target;', '.source { $extend .target-$[tone]; }', '.source { $extend $type; }']) {
      const direct = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, invalid).toBe(false);
    }
  });
  it('exposes the direct Stylesheet route as the package public parse API', () => {
    expect(parse('$tone: blue; .card { color: $tone; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'tone' },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone' } }] }
      ]
    });
    expect(parse('.card:hover { color: blue; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', selector: { type: 'SelectorList' } }]
    });
  });

  it('constructs documented Jess member and index references as one typed value chain', () => {
    const source = '.card { member: $theme.colors.primary; last: $sizes[-1]; dynamic: $theme[$key]; }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'member', value: {
          type: 'Reference', base: { type: 'DeclarationReference', raw: '$' },
          steps: [{ type: 'DotLookup', name: 'theme' }, { type: 'DotLookup', name: 'colors' }, { type: 'DotLookup', name: 'primary' }], raw: '$theme.colors.primary'
        } },
        { type: 'Declaration', name: 'last', value: {
          type: 'Reference', base: { type: 'VariableReference', name: 'sizes', lookup: 'live' },
          steps: [{ type: 'BracketLookup', key: -1, keyKind: 'index', indexBase: 0 }], raw: '$sizes[-1]'
        } },
        { type: 'Declaration', name: 'dynamic', value: {
          type: 'Reference', base: { type: 'VariableReference', name: 'theme', lookup: 'live' },
          steps: [{ type: 'BracketLookup', key: { type: 'VariableReference', name: 'key', lookup: 'live' }, keyKind: 'var' }], raw: '$theme[$key]'
        } }
      ] }]
    });

    // Base-less `$[...]` remains interpolation, not a Reference chain.
    expect(parse('.card { name: $[key]; }').rules[0]).toMatchObject({
      type: 'Ruleset', rules: [{ type: 'Declaration', value: { type: 'Interpolation' } }]
    });
  });

  it('parses declaration-member lookups without treating them as property-only accessors', () => {
    const source = '$tokens: { tone: blue; }; .card { value: $(.type.isnumber(.math.e)); namespaced: $tokens.tone; normal: $.tokens.tone; decimal: $(.1); }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    const rule = parse(source).rules[1];
    expect(rule).toMatchObject({
      type: 'Ruleset',
      rules: [
        {
          type: 'Declaration',
          name: 'value',
          value: {
            type: 'Interpolation',
            parts: [{
              ref: {
                type: 'Block',
                boundary: true,
                value: {
                  type: 'Reference',
                  base: { type: 'DeclarationReference', raw: '' },
                  steps: [
                    { type: 'DotLookup', name: 'type' },
                    { type: 'DotLookup', name: 'isnumber' },
                    {
                      type: 'Call',
                      args: [{
                        value: {
                          type: 'Reference',
                          base: { type: 'DeclarationReference', raw: '' },
                          steps: [{ type: 'DotLookup', name: 'math' }, { type: 'DotLookup', name: 'e' }],
                          raw: '.math.e'
                        }
                      }]
                    }
                  ],
                  raw: '.type.isnumber(.math.e)'
                }
              },
              unquote: true
            }]
          }
        },
        {
          type: 'Declaration',
          name: 'namespaced',
          value: {
            type: 'Reference',
            base: { type: 'DeclarationReference', raw: '$' },
            steps: [{ type: 'DotLookup', name: 'tokens' }, { type: 'DotLookup', name: 'tone' }],
            raw: '$tokens.tone'
          }
        },
        {
          type: 'Declaration',
          name: 'normal',
          value: {
            type: 'Reference',
            base: { type: 'DeclarationReference', raw: '$' },
            steps: [{ type: 'DotLookup', name: 'tokens' }, { type: 'DotLookup', name: 'tone' }],
            raw: '$.tokens.tone'
          }
        },
        {
          type: 'Declaration',
          name: 'decimal',
          value: {
            type: 'Interpolation',
            parts: [{
              ref: {
                type: 'Block',
                boundary: true,
                value: { type: 'Dimension', number: 0.1, unit: '', src: '.1' }
              },
              unquote: true
            }]
          }
        }
      ]
    });

    for (const invalid of [
      '.card { value: .type; }',
      '.card { value: .type.isnumber(.math.e); }',
      '.card { $w: 1px; value: $w + 1px; }',
      '.card { $w: 1px; base: 2px; value: $w + .base; }',
      '.card { value: $.1; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
    expect(parse('.card { value: .1; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ value: { type: 'Dimension', number: 0.1, src: '.1' } }] }]
    });
    expect(parse('$tokens: { tone: blue; }; .card { root: $($.tokens.tone); ns: $($tokens.tone); }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'tokens' },
        { type: 'Ruleset', rules: [
          { name: 'root', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', value: { type: 'Reference', base: { type: 'DeclarationReference', raw: '$' }, steps: [{ type: 'DotLookup', name: 'tokens' }, { type: 'DotLookup', name: 'tone' }], raw: '$.tokens.tone' } } }] } },
          { name: 'ns', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', value: { type: 'Reference', base: { type: 'DeclarationReference', raw: '$' }, steps: [{ type: 'DotLookup', name: 'tokens' }, { type: 'DotLookup', name: 'tone' }], raw: '$tokens.tone' } } }] } }
        ] }
      ]
    });

    const evaluator = buildEvaluator(makeLessRegistry());
    const render = (text: string): string | undefined => serialize(parse(text), { evaluator }).css;
    expect(render('$tokens: { tone: blue; }; .card { $local: blue; tone: red; $w: 3px; base: 2px; from-ns: $tokens.tone; from-root: $.tokens.tone; expr-ns: $($tokens.tone); expr-root: $($.tokens.tone); from-var: $.local; from-prop: $.tone; width: $(.w + .base); decimal: $(.1); }')).toBe(
      '.card {\n  tone: red;\n  base: 2px;\n  from-ns: blue;\n  from-root: blue;\n  expr-ns: blue;\n  expr-root: blue;\n  from-var: blue;\n  from-prop: red;\n  width: 5px;\n  decimal: 0.1;\n}\n'
    );
    expect(() => render('.card { $same: blue; same: red; value: $.same; }'))
      .toThrow(/Ambiguous reference member: same/);
    expect(() => render('.card { $same: { tone: blue; }; same: red; value: $same.tone; }'))
      .toThrow(/Ambiguous reference member: same/);
  });

  it('lowers Jess live/scoped references and lookup-bearing writes directly', () => {
    const source = '$live: one; $$scoped: two; $live?: three; $$scoped?: four; $live := five; $$scoped := six; .card { live: $live; scoped: $$scoped; }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { name: 'live', write: { mode: 'declare' } },
        { name: 'scoped', write: { mode: 'declare' } },
        { name: 'live', write: { mode: 'if-absent', lookup: 'live' } },
        { name: 'scoped', write: { mode: 'if-absent', lookup: 'scoped' } },
        { name: 'live', write: { mode: 'reassign', lookup: 'live' } },
        { name: 'scoped', write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Ruleset', rules: [
          { value: { type: 'VariableReference', name: 'live', lookup: 'live' } },
          { value: { type: 'VariableReference', name: 'scoped', lookup: 'scoped' } }
        ] }
      ]
    });
    expect(parse(source)).toMatchObject({
      rules: [
        { write: { mode: 'declare' } }, { write: { mode: 'declare' } },
        { write: { mode: 'if-absent', lookup: 'live' } }, { write: { mode: 'if-absent', lookup: 'scoped' } },
        { write: { mode: 'reassign', lookup: 'live' } }, { write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Ruleset' }
      ]
    });

    for (const unsupported of ['$!live: one;', '$$$scoped: two;', '$live ?: three;', '$live ? : three;', '$$ scoped: two;', '$ live: one;', '.card { value: $ live; }']) {
      expect(() => parse(unsupported), unsupported).toThrow(SyntaxError);
    }
  });

  it('lowers static unquoted Jess escape strings through public parse without widening escaped interpolation', () => {
    const source = '.asset { double: ~"theme"; single: ~\'tone\'; }';
    const cst = parseJessCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'double', value: { type: 'Quoted', src: '~"theme"', value: 'theme', quote: '"', escaped: true } },
        { type: 'Declaration', name: 'single', value: { type: 'Quoted', src: '~\'tone\'', value: 'tone', quote: '\'', escaped: true } }
      ] }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.asset {\n  double: theme;\n  single: tone;\n}\n'
    );

    /*
     * The static reduction must not claim an escaped string that carries
     * interpolation: dropping the quotes makes that value exactly the
     * Interpolation of its content parts, with no `Quoted` wrapper.
     */
    expect(parse('$theme: dark; .asset { value: ~"${theme}"; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'Ruleset', rules: [{
          type: 'Declaration',
          name: 'value',
          value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'theme' }, unquote: true }] }
        }] }
      ]
    });
  });

  // Documented at docs/jess/02-Language/08-interpolation.mdx ("Any plain output").
  it('constructs escaped Jess strings that carry interpolation as unwrapped Interpolation values', () => {
    const source = '$color-name: "red"; $w: 4px; .container { color: ~"${color-name}"; tone: ~\'$($w * 2)\'; }';
    expect(parse(source)).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'color-name' },
        { type: 'VariableDeclaration', name: 'w' },
        { type: 'Ruleset', rules: [
          { name: 'color', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'color-name' }, unquote: true }] } },
          { name: 'tone', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren' }, unquote: true }] } }
        ] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.container {\n  color: red;\n  tone: 8px;\n}\n'
    );
    expect(serialize(
      parse('$n: 3.5; .a { width: ~"calc(100% - ${n}px)"; }'),
      { evaluator: buildEvaluator(makeLessRegistry()) }
    ).css).toBe('.a {\n  width: calc(100% - 3.5px);\n}\n');
  });

  it('constructs plain CSS slash-separated declaration values as explicit slash lists', () => {
    expect(parse('.x { grid-area: 1 / 2; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{
        name: 'grid-area',
        value: { type: 'List', sep: '/', value: [{ type: 'Dimension', src: '1' }, { type: 'Dimension', src: '2' }] }
      }] }]
    });

    /*
     * Each side stays ONE authored space group, exactly as a modern function
     * component already does: flattening would render `12px / 1.5 / sans-serif`.
     */
    expect(parse('.x { font: 12px/1.5 sans-serif; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{
        name: 'font',
        value: { type: 'List', sep: '/', value: [
          { type: 'Dimension', src: '12px' },
          [{ type: 'Dimension', src: '1.5' }, { type: 'Keyword', src: 'sans-serif' }]
        ] }
      }] }]
    });
    const evaluator = buildEvaluator(makeLessRegistry());
    expect(serialize(parse('.x { grid-area: 1 / 2; a: 1 / 2 / 3; b: a / b; }'), { evaluator }).css).toBe(
      '.x {\n  grid-area: 1 / 2;\n  a: 1 / 2 / 3;\n  b: a / b;\n}\n'
    );

    /*
     * A `$`-headed left side keeps its existing left-factored slash reduction,
     * and a modern function component still admits exactly one separator.
     */
    expect(serialize(parse('$w: 1; .x { slash: $w / 2; color: rgb(15 23 42 / 0.22); }'), { evaluator }).css).toBe(
      '.x {\n  slash: 1 / 2;\n  color: rgb(15 23 42 / 0.22);\n}\n'
    );
    for (const invalid of ['.x { a: / 2; }', '.x { a: 1 /; }', '.x { color: rgb(15 23 42 / 0.22 / 1); }']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('routes value identifiers and glued function openers through owning value nodes', () => {
    expect(parse('.x { color: rgb(15 23 42 / 0.22); image: url(images/${file}.svg); keyword: red; custom: --accent; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [
        { name: 'color', value: { type: 'FunctionCall', name: 'rgb' } },
        { name: 'image', value: { type: 'Url' } },
        { name: 'keyword', value: { type: 'Keyword', src: 'red' } },
        { name: 'custom', value: { type: 'Keyword', src: '--accent' } }
      ] }]
    });
    expect(() => parse('.x { color: rgb (15 23 42); }')).toThrow(SyntaxError);
  });

  it('reads a collection member in condition position exactly as in value position', () => {
    const source = '$c: { x: 4px; }; $if ($c.x > 0) { .a { width: $($c.x * 2); } }';
    expect(parse(source)).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'c' },
        { type: 'If', branches: [{ guard: { g: 'cmp', op: '>', left: { type: 'Reference', raw: '$c.x' } } }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.a {\n  width: 8px;\n}\n'
    );
  });

  it('constructs parenthesized sub-groups and comments inside $( … )', () => {
    expect(parse('.a { width: $(2px * (2 + 1)); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{
        name: 'width',
        value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', value: { type: 'Operation', operator: '*', right: { type: 'Block' } } } }] }
      }] }]
    });
    const evaluator = buildEvaluator(makeLessRegistry());
    expect(serialize(parse('.a { width: $(2px * (2 + 1)); height: $(2px /* nudge */ * 2); depth: $(/* lead */ 1px + 1px); }'), { evaluator }).css).toBe(
      '.a {\n  width: 6px;\n  height: 4px;\n  depth: 2px;\n}\n'
    );
  });

  it('constructs an authored literal tail after a value-position interpolation', () => {
    expect(parse('$w: 20; .a { width: $($w)px; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'w' },
        { type: 'Ruleset', rules: [{
          name: 'width',
          value: { type: 'Interpolation', parts: [{ ref: { type: 'Block' }, unquote: true }, { lit: 'px' }] }
        }] }
      ]
    });
    const evaluator = buildEvaluator(makeLessRegistry());
    expect(serialize(parse('$w: 20; $side: left; .a { width: $($w)px; margin-${side}: $[w]px; ratio: $[w]%; }'), { evaluator }).css).toBe(
      '.a {\n  width: 20px;\n  margin-left: 20px;\n  ratio: 20%;\n}\n'
    );
  });

  /*
   * `through` is the Sass `@for` spelling; a Jess range is `1 to 3` / `1 to <3`.
   * It has to fail as a positioned parse error, never as an internal reduction
   * throw from a space-adjacency run that has no iteration semantics.
   */
  it('keeps a non-iterable $for source out of the route as a parse error', () => {
    for (const invalid of ['$for ($i of 1 through 3) { .a { c: $i; } }', '$for ($i of red blue) { .a { c: $i; } }']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
    expect(parse('$for ($i of 1 to 3) { .a { c: $i; } }')).toMatchObject({
      rules: [{ type: 'For', iterable: { type: 'Range' } }]
    });
  });

  it('keeps ordinary CSS declaration priority as a typed Declaration field', () => {
    for (const source of [
      '.card { color: red !IMPORTANT; }',
      '.card { color: red /* before */ ! /* between */ IMPORTANT /* after */; }',
      '.card { color: red // before marker\n !important; background: blue; }',
      '.card { color: red ! // between marker and name\n IMPORTANT; background: blue; }',
      '.card { color: red !important // after name\n; background: blue; }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok, source).toBe(true);
      expect(direct.unconsumedFrom, source).toBeNull();
      const document = parse(source);
      expect(document).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'Ruleset' }] });
      const rule = document.rules[0];
      if (rule?.type !== 'Ruleset') {
        throw new Error('expected a rule containing the important declaration');
      }
      expect(rule.rules[0]).toMatchObject(
        { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' }, important: true }
      );
      expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toContain(
        '  color: red !important;\n'
      );
    }

    for (const source of [
      '.outer { .inner { color: red // before marker\n !important // after priority\n; background: blue; } }',
      '@media screen { color: red // before marker\n !important // after priority\n; background: blue; }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok, source).toBe(true);
      expect(direct.unconsumedFrom, source).toBeNull();
      expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css, source).toContain(
        'color: red !important;\n'
      );
    }

    for (const source of [
      '.card { color: red !; }',
      '.card { color: red !important-extra; }',
      '.card { color: red !important blue; }',

      /*
       * A `//` comment owns the rest of its line, including a same-line `;`.
       * The priority must therefore end on a following line before its terminator.
       */
      '.card { color: red !important // consumes terminator; }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('keeps arithmetic expression-only while preserving slash and signed value boundaries', () => {
    const source = '$w: 2px; .card { signed: $w -1; slash: $w / 2; wrapped: $($w / 2); }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'w' },
        { type: 'Ruleset', rules: [
          { type: 'Declaration', name: 'signed', value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '-1' }] },
          { type: 'Declaration', name: 'slash', value: { type: 'List', sep: '/', value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '2' }] } },
          { type: 'Declaration', name: 'wrapped', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '/' } }, unquote: true }] } }
        ] }
      ]
    });
    expect(parse(source)).toMatchObject({
      rules: [{ type: 'VariableDeclaration' }, { type: 'Ruleset', rules: [
        { value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '-1' }] },
        { value: { type: 'List', sep: '/' } },
        { value: { type: 'Interpolation' } }
      ] }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.card {\n  signed: 2px -1;\n  slash: 2px / 2;\n  wrapped: 1px;\n}\n'
    );

    /*
     * Arithmetic and comparison operators belong to the explicit `$(...)`
     * expression grammar. Glued signs remain ordinary value items.
     */
    expect(parse('$w: 2; .card { glued-plus: $w +1; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [
          { name: 'glued-plus', value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '+1' }] }
        ] }
      ]
    });
    for (const invalid of [
      '$w: 2px; .card { x: $w + 1px; }',
      '$w: 2px; .card { x: $w * 2; }',
      '$w: 2px; .card { x: $w / 2 + 1; }',
      '$w: 2px; .card { x: $w % 2; }',
      '$w: 2px; .card { x: $w = 2px; }'
    ]) {
      const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('parses a static selector list between *[…] delimiters and rejects dynamic selector content', () => {
    const source = '$targets: *[.notice, main > .card:not(.muted, .disabled):nth-child(2n+1 of .item), .tail:nth-child(-n+2)];';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(hasCstGrammar(cst.tree, 'SelectorCapture')).toBe(true);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'VariableDeclaration',
        name: 'targets',
        value: {
          type: 'SelectorCapture',
          branches: ['.notice', 'main > .card:not(.muted, .disabled):nth-child(2n+1 of .item)', '.tail:nth-child(-n+2)'],
          src: '*[.notice, main > .card:not(.muted, .disabled):nth-child(2n+1 of .item), .tail:nth-child(-n+2)]'
        }
      }]
    });
    expect(parse(source)).toMatchObject({
      rules: [{ value: { type: 'SelectorCapture', branches: ['.notice', 'main > .card:not(.muted, .disabled):nth-child(2n+1 of .item)', '.tail:nth-child(-n+2)'] } }]
    });

    for (const invalid of ['$targets: * [.notice];', '$targets: *[$[selector]];', '$targets: *[.card-$[tone]];', '$targets: *[.card:not($[tone])];', '$targets: *[.card:nth-child(2n+1of .item)];']) {
      const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps static selector-list structure aligned with ordinary selectors', () => {
    for (const source of [
      '.notice',
      'main > .card:not(.muted, .disabled):nth-child(2n+1 of .item)',
      '.tail:nth-child(-n+2), [lang|=en]'
    ]) {
      const captured = run(jessAstGrammar.StaticSelector, source, { trivia: jessAstGrammar.whitespace });
      const ordinary = run(jessAstGrammar.Selector, source, { trivia: jessAstGrammar.whitespace });
      expect(captured.ok && captured.unconsumedFrom === null, source).toBe(true);
      expect(ordinary.ok && ordinary.unconsumedFrom === null, source).toBe(true);
      expect(captured.value).toEqual(ordinary.value);
    }
  });

  it('retains whitelisted selector-function pseudo arguments as structure, not baked text', () => {
    const secondSimple = (source: string): SimpleToken => {
      const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      const rule = stylesheet(result.value).rules.find((child): child is Ruleset => isRecord(child) && child.type === 'Ruleset');
      expect(rule, source).toBeDefined();
      const term = firstSelectorTerm(rule!.selector.selectors[0]);
      if (term.type !== 'CompoundSelector') {
        throw new TypeError('Expected a compound selector');
      }
      return term.value[1]!;
    };

    /*
     * `:is` keeps the parsed `SelectorList` as `args` (structure), forces `text`
     * to null (core serialization owns the join), and is crossable.
     */
    const isPseudo = secondSimple('.x:is(.a, .b) { c: d; }');
    expect(isPseudo).toMatchObject({
      type: 'PseudoSelector',
      name: ':is',
      text: null,
      crossable: true,
      args: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: '.a' }, { type: 'SimpleSelector', text: '.b' }] }
    });

    /*
     * Parser stores STRUCTURE only: the inner complex `_canon` memo is never
     * populated at parse (the earlier baked-text approach set it eagerly).
     */
    expect(isPseudo.type).toBe('PseudoSelector');
    if (isPseudo.type === 'PseudoSelector') {
      expect(isPseudo.args).not.toBeNull();
      for (const branch of isPseudo.args!.selectors) {
        expect(branch._canon).toBeUndefined();
      }
    }

    // `:not` is structured too but SEALED — not a boundary extend forks through.
    expect(secondSimple('.x:not(.a, .b) { c: d; }')).toMatchObject({
      type: 'PseudoSelector',
      name: ':not',
      text: null,
      crossable: false,
      args: { type: 'SelectorList' }
    });

    /*
     * Core owns the inline `:is(a, b)` join, so authored spacing is normalized
     * identically whether or not the source had a space after the comma.
     */
    for (const source of ['.x:is(.a,.b) { c: d; }', '.x:is(.a, .b) { c: d; }']) {
      const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(serialize(stylesheet(result.value)).css).toBe('.x:is(.a, .b) {\n  c: d;\n}\n');
    }

    /*
     * An `$[…]`-interpolated pseudo argument is NOT a static `SelectorList`, so it
     * never reaches the structured path: it stays opaque exactly as before (the
     * Jess selector chain has no typed interpolation for pseudo args yet, so the
     * rule does not fully parse).
     */
    for (const interpolated of ['.x:not(.a-$[t]) { c: d; }', '.x:is(.card-$[t]) { c: d; }']) {
      const rejected = run(jessAstGrammar.Stylesheet, interpolated, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, interpolated).toBe(false);
    }
  });

  it('rejects paren-less nth pseudo names at the identifier boundary (cross-dialect divergence unification)', () => {
    /*
     * A bare, paren-less nth name is not a keyword pseudo — it must reach the
     * structured nth arms with an immediate `(` or be rejected, matching Less's
     * identifier-boundary guard (design §7). Jess is already selector-only for
     * `:not`, so `:not(2n+1)` already rejects; this closes the remaining bare-nth
     * divergence with css/less.
     */
    for (const source of [
      '.x:nth-child { color: red; }',
      '.x:nth-of-type { color: red; }',
      '.x:nth-last-child { color: red; }',
      '.x:nth-last-of-type { color: red; }',
      '.x:not(2n+1) { color: red; }'
    ]) {
      const rejected = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, source).toBe(false);
    }

    for (const source of [
      '.x:nth-child(2n+1) { color: red; }',
      '.x:nth-of-type(2n) { color: red; }',
      '.x:not(.a) { color: red; }',
      '.x:is(.a, .b) { color: red; }',
      '.x:lang(en) { color: red; }'
    ]) {
      const accepted = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(accepted.ok && accepted.unconsumedFrom === null, source).toBe(true);
    }
  });

  it('rejects whitespace-separated static pseudo colons on the direct AST path', () => {
    for (const source of [
      '.card : hover { color: red; }',
      '.card: hover { color: red; }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('gives an unknown functional pseudo the general any-value argument (Selectors-4 §3.5)', () => {
    /*
     * Whether a pseudo-class exists is a language-service fact, not a parse
     * decision: an unknown functional pseudo takes `<any-value>`, so rejecting it
     * turned a diagnosable squiggle into a lost file. The other three dialects
     * already run this delimiter-aware verbatim scan for the same class.
     */
    for (const [source, text] of [
      ['.x:totally-made-up(1) { color: red; }', ':totally-made-up(1)'],
      ['.x:lang("en-US") { color: red; }', ':lang("en-US")'],

      /*
       * The scan is delimiter-aware: a `)` inside a string or a bracket group is
       * argument content, not the argument's close.
       */
      ['.x:future-thing("b(c)") { color: red; }', ':future-thing("b(c)")'],
      ['.x:future-thing([d]) { color: red; }', ':future-thing([d])']
    ] as const) {
      expect(parse(source), source).toMatchObject({
        rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [{ text: '.x' }, { text }] }] } }]
      });
    }

    /*
     * The selector-argument class keeps its selector-ONLY argument: a failed
     * selector must reject the whole pseudo rather than fall through to the
     * any-value scan, and a Jess interpolation must stay typed rather than being
     * flattened into opaque argument text.
     */
    for (const source of [
      '.x:not(2n+1) { color: red; }',
      '.x:is(2n+1) { color: red; }',
      '.x:has(2n+1) { color: red; }',
      '.x:totally-made-up($name) { color: red; }'
    ]) {
      const rejected = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('accepts An+B and selector pseudo whitespace as valid CSS, normalizing surrounding argument space', () => {
    /*
     * Valid CSS is valid .jess: Selectors-4 §6.6.2 permits OPTIONAL whitespace
     * around the `+`/`-` sign, and CSS permits insignificant whitespace
     * surrounding any functional pseudo's argument inside the parens
     * (https://www.w3.org/TR/selectors-4/#anb-microsyntax). Sign whitespace is
     * preserved verbatim; surrounding paren whitespace is normalized away exactly
     * as the canonical CSS grammar and the other dialects do.
     */
    for (const [source, expected] of [
      ['a:nth-child(2n + 1) { color: red; }', 'a:nth-child(2n + 1) {\n  color: red;\n}\n'],
      ['a:nth-last-child(n - 3) { color: red; }', 'a:nth-last-child(n - 3) {\n  color: red;\n}\n'],
      ['a:nth-child(2n+1) { color: red; }', 'a:nth-child(2n+1) {\n  color: red;\n}\n'],
      ['a:nth-child( 2n+1 ) { color: red; }', 'a:nth-child(2n+1) {\n  color: red;\n}\n'],
      ['a:not( .b ) { color: red; }', 'a:not(.b) {\n  color: red;\n}\n']
    ] as const) {
      expect(serialize(parse(source)).css, source).toEqual(expected);
    }
  });

  it('restricts `<An+B> of S` to the nth-child index, rejecting it on nth-of-type (Selectors-4 §6.6.2)', () => {
    /*
     * `of S` is defined ONLY for `:nth-child()`/`:nth-last-child()`; the
     * type-index families take a bare `<An+B>`. Mirroring the CSS reference, the
     * nth name now dispatches child vs of-type, so an `of` tail on the of-type
     * families fails to parse rather than being captured as opaque selector text.
     */
    for (const invalid of [
      'a:nth-of-type(2n of .a) { color: red; }',
      'a:nth-of-type(n of .a) { color: red; }',
      'a:nth-last-of-type(-n+3 of .a) { color: red; }',
      'a:nth-last-of-type(even of .a) { color: red; }'
    ]) {
      const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }

    /*
     * `of S` on the child index and a bare `<An+B>` on the of-type index stay
     * accepted, serialized byte-identically to the authored argument.
     */
    for (const [source, expected] of [
      ['a:nth-child(2n of .a) { color: red; }', 'a:nth-child(2n of .a) {\n  color: red;\n}\n'],
      ['a:nth-child(n of .a) { color: red; }', 'a:nth-child(n of .a) {\n  color: red;\n}\n'],
      ['a:nth-of-type(2n+1) { color: red; }', 'a:nth-of-type(2n+1) {\n  color: red;\n}\n'],
      ['a:nth-last-of-type(odd) { color: red; }', 'a:nth-last-of-type(odd) {\n  color: red;\n}\n']
    ] as const) {
      expect(serialize(parse(source)).css, source).toEqual(expected);
    }
  });

  it('constructs static Jess stylesheet and module import facts directly without resolving them', () => {
    const source = [
      '@-compose "./theme.jess" as theme;',
      '@-compose "./public.jess" as *;',
      '@-export "./tokens.jess";',
      '@-import "./legacy.less";',
      '@-use "#sass/math" as math;',
      '@-use "#sass/color" as *;',
      '@-from "./default.ts" import main, (named as alias);',
      '@-from "#jess/fns" import (rgb, clamp as limit);',
      '@-from "./plugin.ts" import * as plugin;'
    ].join('\n');
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'StyleImport', mode: 'compose', path: { type: 'Quoted', value: './theme.jess' }, namespace: 'theme', forward: false },
        { type: 'StyleImport', mode: 'compose', path: { type: 'Quoted', value: './public.jess' }, namespace: '*', forward: false },
        { type: 'StyleImport', mode: 'compose', path: { type: 'Quoted', value: './tokens.jess' }, namespace: null, forward: true },
        { type: 'StyleImport', mode: 'import', path: { type: 'Quoted', value: './legacy.less' }, namespace: null, forward: false },
        { type: 'ModuleImport', mode: 'use', path: { type: 'Quoted', value: '#sass/math' }, defaultImport: null, namespace: 'math', imports: [] },
        { type: 'ModuleImport', mode: 'use', path: { type: 'Quoted', value: '#sass/color' }, defaultImport: null, namespace: '*', imports: [] },
        { type: 'ModuleImport', mode: 'from', path: { type: 'Quoted', value: './default.ts' }, defaultImport: 'main', namespace: null, imports: [{ name: 'named', alias: 'alias' }] },
        { type: 'ModuleImport', mode: 'from', path: { type: 'Quoted', value: '#jess/fns' }, defaultImport: null, namespace: null, imports: [{ name: 'rgb', alias: null }, { name: 'clamp', alias: 'limit' }] },
        { type: 'ModuleImport', mode: 'from', path: { type: 'Quoted', value: './plugin.ts' }, defaultImport: null, namespace: 'plugin', imports: [] }
      ]
    });
    expect(serialize(parse(source))).toEqual({ css: `${source}\n` });
    for (const invalid of [
      '@-compose $[path];',
      '@-use "./x.ts" as **;',
      '@-from "./x.ts" import *;',
      '@-from "./x.ts" import foo, bar;',
      '@-COMPOSE "./theme.jess";',
      '@-USE "./module.ts";',
      '@-from "./module.ts" IMPORT foo;',
      '@-use "./module.ts" AS mod;'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('constructs static CSS at-rule facts directly, including nested documented media blocks', () => {
    const staticQuery = run(jessAstGrammar.StaticAtQuery, '(min-width: 48rem)', { trivia: jessAstGrammar.whitespace });
    expect(staticQuery.ok && staticQuery.unconsumedFrom === null).toBe(true);
    for (const staticSource of [
      '@media screen { .card { color: blue; } }',
      '@media (min-width: 48rem) { .card { color: blue; } }',
      '@media ( min-width : 48rem ) { .card { color: blue; } }',
      '@media screen and (min-width: 48rem), print { .card { color: blue; } }',
      '@media screen { ; .card { color: blue; } ; }',
      '.card { @media screen { color: blue; } }',
      '.card { @media screen { @supports (display: grid) { display: grid; } } }'
    ]) {
      const staticResult = run(jessAstGrammar.Stylesheet, staticSource, { trivia: jessAstGrammar.whitespace });
      expect(staticResult.ok && staticResult.unconsumedFrom === null, staticSource).toBe(true);
    }
    const source = [
      '@charset "UTF-8";',
      '@import "theme.css";',
      '.card {',
      '  padding: 1rem;',
      '  @media screen and (min-width: 48rem), print {',
      '    padding: 2rem;',
      '    @supports (display: grid) { display: grid; }',
      '  }',
      '}'
    ].join('\n');
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(hasCstGrammar(cst.tree, 'AtRuleBlock')).toBe(true);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'AtRuleStatement', name: '@charset', prelude: { type: 'Quoted', value: 'UTF-8' } },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'Quoted', value: 'theme.css' } },
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: 'padding' },
            {
              type: 'AtRuleBlock', name: '@media',
              prelude: { type: 'List', sep: ',' },
              rules: [
                { type: 'Declaration', name: 'padding' },
                { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Block', delimiter: 'paren' } }
              ]
            }
          ]
        }
      ]
    });
    expect(serialize(parse(source))).toEqual({
      css: '@charset "UTF-8";\n@import "theme.css";\n.card {\n  padding: 1rem;\n}\n@media screen and (min-width: 48rem), print {\n  .card {\n    padding: 2rem;\n  }\n  @supports (display: grid) {\n    .card {\n      display: grid;\n    }\n  }\n}\n'
    });

    const compilerBeforeLiteral = '@-import "legacy.less"; @import url(theme.css);';
    const compilerBeforeLiteralDirect = run(jessAstGrammar.Stylesheet, compilerBeforeLiteral, { trivia: jessAstGrammar.whitespace });
    expect(compilerBeforeLiteralDirect.ok).toBe(true);
    expect(compilerBeforeLiteralDirect.unconsumedFrom).toBeNull();
    expect(parse(compilerBeforeLiteral)).toMatchObject({
      rules: [
        { type: 'StyleImport', mode: 'import', path: { type: 'Quoted', value: 'legacy.less' } },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { type: 'Keyword', src: 'theme.css' } } }
      ]
    });

    for (const invalid of [
      '@media $screen { .card { color: blue; } }',
      '@media (min-width: $width) { .card { color: blue; } }',
      '.card { @charset "UTF-8"; }',
      '.card { @import "theme.css"; }',
      '.card { color: blue; } @charset "UTF-8";',
      '.card { color: blue; } @import "theme.css";',
      '.card { color: blue; } @CHARSET "UTF-8";',
      '.card { color: blue; } @IMPORT "theme.css";',
      '@charset "$[encoding]";',
      '@import "$[path]";',
      '@import url($path);'
    ]) {
      const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
    expect(parse('.card { color: blue; } @-import "legacy.less";')).toMatchObject({
      rules: [{ type: 'Ruleset' }, { type: 'StyleImport', mode: 'import', path: { value: 'legacy.less' } }]
    });
  });

  it('constructs static unknown CSS blocks as terminal opaque grammar facts', () => {
    const source = '@vendor-rule screen /* header */ {\n  raw: fn("}", nested({ value: 1; }));\n  // } stays in the raw body\n  @nested { value: "{ }"; }\n}';
    const document = parse(source);

    expect(document.rules[0]).toMatchObject({
      type: 'OpaqueAtRuleBlock',
      name: '@vendor-rule',
      prelude: 'screen /* header */',
      rawBody: '\n  raw: fn("}", nested({ value: 1; }));\n  // } stays in the raw body\n  @nested { value: "{ }"; }\n'
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(`${source}\n`);

    /*
     * A prelude-less unknown block is the common spelling. The prelude capture is
     * an `optional(scanTo(...))` that emits no child when it matches nothing, so
     * this reduces through a different child count than the prelude-bearing case
     * above; both must land the same raw facts.
     */
    expect(parse('@vendor-rule { raw: 1; }').rules[0]).toMatchObject({
      type: 'OpaqueAtRuleBlock',
      name: '@vendor-rule',
      prelude: null,
      rawBody: ' raw: 1; '
    });

    /*
     * Which at-rules exist is a language-service fact: a vendor prefix is
     * ordinary unknown CSS and must pass through, exactly as it does in the other
     * three dialects. Only Jess's own compiler namespace is reserved.
     */
    for (const [source, name] of [
      ['@-webkit-madeup { raw: 1; }', '@-webkit-madeup'],
      ['@-future raw { value: 1; }', '@-future'],
      ['@-moz-whatever screen { raw: 1; }', '@-moz-whatever']
    ] as const) {
      expect(parse(source).rules[0], source).toMatchObject({ type: 'OpaqueAtRuleBlock', name });
    }

    for (const invalid of [
      '@vendor-rule $[name] { raw: 1; }',
      '@vendor-rule ${name} { raw: 1; }',
      '@media { .card { color: red; } }',

      /*
       * The compiler namespace a module directive lowers to is never CSS output,
       * so it must reject rather than degrade to opaque bytes.
       */
      '@-use raw { value: 1; }',
      '@-compose raw { value: 1; }',
      '@-export raw { value: 1; }',
      '@-import raw { value: 1; }',
      '@-from raw { value: 1; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('constructs the CSS at-rule header shapes the generic static prelude could not reach', () => {
    /*
     * `@scope (<start>) [to (<end>)]` — css-cascade-6 §3. The prelude is a pair of
     * SELECTOR lists, not a media-style feature query, so it reduces to the same
     * verbatim `Any` css and scss carry while the body stays an ordinary
     * declaration list.
     */
    expect(parse('@scope (.a) to (.b) { a { color: red; } }')).toMatchObject({
      rules: [{
        type: 'AtRuleBlock',
        name: '@scope',
        prelude: { type: 'Any', src: '(.a) to (.b)' },
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }]
      }]
    });
    expect(parse('@scope (.a) { a { color: red; } }').rules[0]).toMatchObject({ prelude: { type: 'Any', src: '(.a)' } });

    // A prelude-less `@scope` and the statement form keep their existing shapes.
    expect(parse('@scope { a { color: red; } }').rules[0]).toMatchObject({ type: 'AtRuleBlock', name: '@scope', prelude: null });
    expect(parse('@scope;').rules[0]).toMatchObject({ type: 'AtRuleStatement', name: '@scope', prelude: null });

    /*
     * A `<dashed-ident>` header name — css-anchor-position-1 §5.1. The CSS ident
     * leaf admits one leading dash, so only the two-dash spelling was rejected.
     */
    expect(parse('@position-try --foo { top: 0; }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@position-try', prelude: { type: 'Keyword', src: '--foo' }, rules: [{ type: 'Declaration', name: 'top' }] }]
    });

    /*
     * The functional `@import` conditions — css-cascade-5 §2.1. `supports(...)`
     * reuses the typed `@supports` condition rather than restating it.
     */
    expect(parse('@import "a.css" supports(display: grid);').rules[0]).toMatchObject({
      type: 'AtRuleStatement',
      name: '@import',
      prelude: {
        type: 'SpacedValue',
        parts: [
          { type: 'Quoted', value: 'a.css' },
          { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] }
        ]
      }
    });
    expect(parse('@import "a.css" layer(base);').rules[0]).toMatchObject({
      prelude: { parts: [{ type: 'Quoted' }, { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'base' }] }] }
    });
    expect(parse('@import "a.css" SUPPORTS(display: grid) LaYeR(base);').rules[0]).toMatchObject({
      prelude: { parts: [
        { type: 'Quoted' },
        { type: 'FunctionCall', name: 'SUPPORTS' },
        { type: 'FunctionCall', name: 'LaYeR' }
      ] }
    });
    expect(parse('@import "a.css" supports((display: grid) and (color));').rules[0]).toMatchObject({
      prelude: { parts: [
        { type: 'Quoted' },
        { type: 'FunctionCall', name: 'supports', args: [{ type: 'SpacedValue' }] }
      ] }
    });
    expect(parse('@import "a.css" supports(not (display: grid));').rules[0]).toMatchObject({
      prelude: { parts: [
        { type: 'Quoted' },
        { type: 'FunctionCall', name: 'supports', args: [{ type: 'SpacedValue' }] }
      ] }
    });
    expect(parse('@import "a.css" supports (display: grid);').rules[0]).toMatchObject({
      prelude: { parts: [
        { type: 'Quoted' },
        { type: 'SpacedValue', parts: [
          { type: 'Keyword', src: 'supports' },
          { type: 'Block' }
        ] }
      ] }
    });

    /*
     * A dynamic header stays rejected: the static prelude capture stops at a
     * top-level `$`, so nothing is hidden in raw bytes.
     */
    for (const source of ['@scope ($sel) { a { color: red; } }', '@scope (.a) to ($end) { a { color: red; } }']) {
      const rejected = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('keeps a lone ${…} interpolation as a typed dynamic @media prelude', () => {
    const source = '$type: screen; @media ${type} { .card { color: red; } }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'type' },
        {
          type: 'AtRuleBlock', name: '@media',
          prelude: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'type' }, unquote: true }] }
        }
      ]
    });
    expect(serialize(document).css).toBe('@media screen {\n  .card {\n    color: red;\n  }\n}\n');

    for (const invalid of [
      '$type: screen; @media $type { .card { color: red; } }',
      '$type: screen; @media ${type} screen { .card { color: red; } }',
      '$type: screen; @media ${$type} { .card { color: red; } }',
      '$type: screen; @media ${type};',
      '$type: screen; @container ${type} { .card { color: red; } }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  /*
   * The CST route drives the editor and the AST route drives the compiler, so a
   * form either route accepts alone is a bug in whichever route disagrees. The
   * `${…}` prelude used to compile fine and light up red in the editor: the CST
   * inherited the shared CSS prelude primitive, whose stop set reads the `{` of
   * `${` as the block opener. Pin BOTH routes on the SAME accept/reject set.
   */
  it('accepts a ${…} @media prelude in the CST route and the AST route alike', () => {
    for (const source of [
      '@media ${type} { .card { color: red; } }',
      '@media ${[type]} { .card { color: red; } }',
      '@media ${["type"]} { .card { color: red; } }',
      '.card { @media ${type} { color: red; } }'
    ]) {
      const cst = parseJessCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();

      /*
       * Reduced as an `AtRuleBlock` so every language-service grammarType
       * allow-list treats it exactly like a static `@media`.
       */
      expect(hasCstGrammar(cst.tree, 'AtRuleBlock'), source).toBe(true);
      expect(hasCstGrammar(cst.tree, 'DollarBrace'), source).toBe(true);

      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
    }

    /*
     * The CST arm mirrors `MediaPrelude` exactly: `@media` only, the
     * prelude is a WHOLE `${…}` (no mixed/comma/glued form), block form only.
     * Every one of these stays rejected by BOTH routes.
     */
    for (const source of [
      '@media ${type} screen { .card { color: red; } }',
      '@media ${type} and (min-width: 1px) { .card { color: red; } }',
      '@media screen, ${type} { .card { color: red; } }',
      '@media pre${type} { .card { color: red; } }',
      '@media ${type};',
      '@container ${type} { .card { color: red; } }',
      '@supports ${type} { .card { color: red; } }'
    ]) {
      const cst = parseJessCst(source);
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('uses `only` only before a static media type', () => {
    expect(parse('@media only screen and (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' } }]
    });
    const invalid = '@media only (min-width: 1px) { .card { color: red; } }';
    const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
    expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
    expect(() => parse('@container only screen { .card { color: red; } }')).toThrow(SyntaxError);
    expect(parse('@media not (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media' }]
    });
  });

  it('constructs and renders static CSS media/container comparison queries without widening dynamic or function headers', () => {
    for (const [source, operator] of [
      ['@media (width > 30rem) { .card { color: blue; } }', '>'],
      ['@media (width >= 30rem) { .card { color: blue; } }', '>='],
      ['@media (width < 30rem) { .card { color: blue; } }', '<'],
      ['@media (width <= 30rem) { .card { color: blue; } }', '<='],
      ['@media (width = 30rem) { .card { color: blue; } }', '='],
      ['@container sidebar (30rem < width < 80rem) { .card { color: blue; } }', '<'],
      ['@container sidebar (30rem <= width <= 80rem) { .card { color: blue; } }', '<=']
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
      expect(parse(source).rules[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: source.startsWith('@media')
          ? { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator } }
          : { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'sidebar' }, { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator } }] }
      });
    }
    expect(serialize(parse('@container sidebar (30rem < width < 80rem) { .card { color: blue; } }'))).toEqual({
      css: '@container sidebar (30rem < width < 80rem) {\n  .card {\n    color: blue;\n  }\n}\n'
    });
    for (const rejected of [
      '@media (width >= $limit) { .card { color: blue; } }',
      '@media (width < 80rem < 100rem) { .card { color: blue; } }',
      '@container style(--theme: dark) { .card { color: blue; } }'
    ]) {
      expect(() => parse(rejected), rejected).toThrow(SyntaxError);
    }
  });

  it('constructs a media feature <ratio> value in every static query form', () => {
    const ratio = {
      type: 'Operation', operator: '/',
      left: { type: 'Dimension', src: '16' },
      right: { type: 'Dimension', src: '9' }
    };

    for (const [source, operator] of [
      ['@media (aspect-ratio: 16/9) { .card { color: blue; } }', ':'],
      ['@media (aspect-ratio: 16 / 9) { .card { color: blue; } }', ':'],
      ['@media (min-aspect-ratio: 16/9) { .card { color: blue; } }', ':'],
      ['@container (aspect-ratio: 16/9) { .card { color: blue; } }', ':'],
      ['@media (aspect-ratio >= 16/9) { .card { color: blue; } }', '>=']
    ] as const) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
      expect(parse(source).rules[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator, right: ratio } }
      });
    }

    expect(parse('@media (16/9 < aspect-ratio < 2/1) { .card { color: blue; } }').rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      prelude: { type: 'Block', delimiter: 'paren', value: {
        type: 'Operation', operator: '<',
        left: { type: 'Operation', operator: '<', left: ratio, right: { type: 'Keyword', src: 'aspect-ratio' } },
        right: { type: 'Operation', operator: '/', left: { type: 'Dimension', src: '2' }, right: { type: 'Dimension', src: '1' } }
      } }
    });

    expect(serialize(parse('@media (aspect-ratio: 16/9) { .card { color: blue; } }'))).toEqual({
      css: '@media (aspect-ratio: 16 / 9) {\n  .card {\n    color: blue;\n  }\n}\n'
    });

    // A single `<number>` is a whole ratio, so the slash tail stays optional.
    expect(parse('@media (aspect-ratio: 1) { .card { color: blue; } }').rules[0]).toMatchObject({
      prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', right: { type: 'Dimension', src: '1' } } }
    });
  });

  it('constructs static URL-bearing CSS at-rule preludes without widening generic headers', () => {
    const source = '@namespace svg url("http://www.w3.org/2000/svg"); @document url(site.css) { .icon { color: blue; } }';
    const root = parse(source);

    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'AtRuleStatement', name: '@namespace', prelude: { type: 'SpacedValue', parts: [
          { type: 'Keyword', src: 'svg' }, { type: 'Url', value: { type: 'Quoted', value: 'http://www.w3.org/2000/svg' } }
        ] } },
        { type: 'AtRuleBlock', name: '@document', prelude: { type: 'Url', value: { type: 'Any', src: 'site.css' } }, rules: [{ type: 'Ruleset' }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '@namespace svg url("http://www.w3.org/2000/svg");\n@document url(site.css) {\n  .icon {\n    color: blue;\n  }\n}\n'
    );

    for (const dynamic of [
      '@namespace svg url($[path]);',
      '@document url("$[path]") { .icon { color: blue; } }'
    ]) {
      expect(() => parse(dynamic), dynamic).toThrow(SyntaxError);
    }
  });

  it('constructs and renders a static CSS @property custom-property header directly', () => {
    const source = '@property --accent { syntax: "<color>"; inherits: false; initial-value: red; }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' },
        rules: [{ type: 'Declaration', name: 'syntax' }, { type: 'Declaration', name: 'inherits' }, { type: 'Declaration', name: 'initial-value' }]
      }]
    });
    expect(serialize(parse(source))).toEqual({
      css: '@property --accent {\n  syntax: "<color>";\n  inherits: false;\n  initial-value: red;\n}\n'
    });
    for (const invalid of [
      '@property accent { syntax: "<color>"; }',
      '@property -- accent { syntax: "<color>"; }',
      '@property --$name { syntax: "<color>"; }',
      '@property --accent { syntax: $syntax; }',
      '@property --accent { initial-value: $[accent]; }',
      '@property --accent { .nested { color: red; } }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps static @property descriptor lists and function values typed without admitting Jess values', () => {
    const source = '@property --offset { syntax: "<length>+"; inherits: false; initial-value: 1px 2px; } @property --accent { syntax: "<\\\\63olor>"; inherits: false; initial-value: color-mix(in srgb, rgb(1 2 3), blue); }';
    const root = parse(source);

    expect(root.rules).toMatchObject([
      {
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--offset' },
        rules: [{ type: 'Declaration', name: 'syntax' }, { type: 'Declaration', name: 'inherits' }, {
          type: 'Declaration', name: 'initial-value', value: [{ type: 'Dimension', src: '1px' }, { type: 'Dimension', src: '2px' }]
        }]
      },
      {
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' },
        rules: [{ type: 'Declaration', name: 'syntax', value: { type: 'Quoted', escaped: false } }, { type: 'Declaration', name: 'inherits' }, {
          type: 'Declaration', name: 'initial-value', value: {
            type: 'FunctionCall', name: 'color-mix', args: [
              [{ type: 'Keyword', src: 'in' }, { type: 'Keyword', src: 'srgb' }],
              { type: 'FunctionCall', name: 'rgb', args: [[{ type: 'Dimension', src: '1' }, { type: 'Dimension', src: '2' }, { type: 'Dimension', src: '3' }]] },
              { type: 'Keyword', src: 'blue' }
            ]
          }
        }]
      }
    ]);
    expect(serialize(root)).toEqual({
      css: '@property --offset {\n  syntax: "<length>+";\n  inherits: false;\n  initial-value: 1px 2px;\n}\n@property --accent {\n  syntax: "<\\\\63olor>";\n  inherits: false;\n  initial-value: color-mix(in srgb, rgb(1 2 3), blue);\n}\n'
    });

    for (const invalid of [
      '@property --accent { syntax: "<color>"; initial-value: rgb($red 0 0); }',
      '@property --accent { syntax: "<color>"; initial-value: rgb(1, $green, 3); }',

      /*
       * css-syntax-3 §4.3.4: an ident is a function token only when `(` follows
       * it immediately. A detached paren is a different shape, not a function.
       */
      '@property --accent { syntax: "<color>"; initial-value: var (--theme); }',
      '@property --accent { syntax: "<color>"; initial-value: $(rgb)(1 2 3); }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  /**
   * WHICH function may appear in a descriptor is a language-service fact — the
   * registered-property syntax decides whether `var()` is meaningful in an
   * `initial-value`, and a wrong one deserves a diagnostic, not a lost file. The
   * grammar's job stops at the function-token shape, so every function name
   * reduces the same way. `url()` keeps its own Url leaf, which is a real
   * css-syntax-3 §4.3.6 token type rather than a name the parser dislikes.
   */
  it('admits any static function shape in an @property descriptor, naming none', () => {
    const source = '@property --a { initial-value: var(--theme); } @property --b { initial-value: env(safe-area-inset-top); } @property --c { initial-value: url(a.png); }';

    expect(parse(source).rules).toMatchObject([
      { name: '@property', rules: [{ name: 'initial-value', value: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--theme' }] } }] },
      { name: '@property', rules: [{ name: 'initial-value', value: { type: 'FunctionCall', name: 'env', args: [{ type: 'Keyword', src: 'safe-area-inset-top' }] } }] },
      { name: '@property', rules: [{ name: 'initial-value', value: { type: 'Url', value: { type: 'Any', src: 'a.png' } } }] }
    ]);
    expect(serialize(parse(source))).toEqual({
      css: '@property --a {\n  initial-value: var(--theme);\n}\n@property --b {\n  initial-value: env(safe-area-inset-top);\n}\n@property --c {\n  initial-value: url(a.png);\n}\n'
    });
  });

  it('retains Jess @supports general-enclosed bodies as structural interpolation templates', () => {
    const source = '@supports selector(.card-${tone}:has([data-x="${state}"])) { .card { color: blue; } }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector', content: {
            type: 'Interpolation', parts: [
              { lit: '.card-' }, { ref: { type: 'VariableReference', name: 'tone' }, unquote: true },
              { lit: ':has([data-x="' }, { ref: { type: 'VariableReference', name: 'state' }, unquote: true }, { lit: '"])' }
            ]
          }
        }
      }]
    });
    expect(() => parse('@supports selector($[]) { .card { color: blue; } }')).toThrow(SyntaxError);
  });

  /*
   * Every interpolated position takes `${…}` only, and a general-enclosed body is
   * one: `$(…)` is a value-position EXPRESSION, not interpolation. A QUOTED
   * sub-template is a different position — an ordinary Jess string — and keeps
   * `$(…)` like every other string in the language. The two chains recurse, so
   * this pins the nesting in both directions: an extra paren must not unlock
   * `$(…)`, and a group nested inside a string must stay string content.
   */
  it('admits ${…} but not $(…) in an @supports general-enclosed body', () => {
    for (const source of [
      '@supports $(display) { .card { color: blue; } }',
      '@supports ($(display)) { .card { color: blue; } }',
      '@supports selector($(display)) { .card { color: blue; } }',

      /*
       * The strict chain is closed under its own wrappers, so wrapping does not
       * reopen the spelling.
       */
      '@supports selector(($(display))) { .card { color: blue; } }',
      '@supports selector([$(x)]) { .card { color: blue; } }',
      '@supports selector({$(x)}) { .card { color: blue; } }',
      '@supports selector(a $(x) b) { .card { color: blue; } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }

    for (const source of [
      '@supports (${display}) { .card { color: blue; } }',
      '@supports selector(${display}) { .card { color: blue; } }',
      '@supports selector((${x})) { .card { color: blue; } }',
      '@supports selector([${x}]) { .card { color: blue; } }',
      '@supports selector({${x}}) { .card { color: blue; } }',
      '@supports selector(${[x]}) { .card { color: blue; } }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }
  });

  it('keeps $(…) inside a quoted sub-template of an @supports general-enclosed body', () => {
    for (const source of [
      '@supports selector("a $(x) b") { .card { color: blue; } }',
      '@supports selector(\'a $(x) b\') { .card { color: blue; } }',

      /*
       * The permissive chain is closed under ITS wrappers too: once inside a
       * string you stay inside it, so a nested group is still string content.
       */
      '@supports selector("a ($(x)) b") { .card { color: blue; } }',
      '@supports selector("a [$(x)] b") { .card { color: blue; } }',
      '@supports selector("a {$(x)} b") { .card { color: blue; } }',
      '@supports selector("a ${x} b") { .card { color: blue; } }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }

    expect(parse('@supports selector("$(x)") { .card { color: blue; } }').rules[0]).toMatchObject({
      type: 'AtRuleBlock', name: '@supports',
      prelude: { type: 'GeneralEnclosed', form: 'function', name: 'selector' }
    });
  });

  it('constructs typed static @supports conditions without a generic at-rule or raw-function fallback', () => {
    const source = '@supports not ((display: grid) and (color)) { .card { color: blue; } }';
    const root = parse(source);

    expect(root.rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      prelude: {
        type: 'SpacedValue',
        parts: [
          { type: 'Keyword', src: 'not' },
          { type: 'Block', delimiter: 'paren', value: { type: 'SpacedValue' } }
        ]
      },
      rules: [{ type: 'Ruleset' }]
    });
    expect(parse('@supports (display: grid) or (width: 1px) { .card { color: blue; } }').rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      prelude: { type: 'SpacedValue', parts: [{ type: 'Block', delimiter: 'paren' }, { type: 'Keyword', src: 'or' }, { type: 'Block', delimiter: 'paren' }] }
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '@supports not ((display: grid) and (color)) {\n  .card {\n    color: blue;\n  }\n}\n'
    );

    for (const invalid of [
      '@supports { .card { color: blue; } }',
      '@supports color { .card { color: blue; } }',
      '@supports (display: $theme) { .card { color: blue; } }',
      '@supports $(display) { .card { color: blue; } }',
      '@supports (display: grid), (color: blue) { .card { color: blue; } }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('constructs CSS and vendor keyframes as typed at-rule blocks with selector-only descriptor bodies', () => {
    const source = '@KEYFRAMES fade { from /* selector delimiter */, 50% { opacity: 0; } to { opacity: 1; } } @-MOZ-KEYFRAMES "zoom" { from { opacity: 0; } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock', name: '@KEYFRAMES', prelude: { type: 'Keyword', src: 'fade' },
          rules: [{ type: 'Ruleset', selector: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: 'from' }, { type: 'SimpleSelector', text: '50%' }] } }, { type: 'Ruleset' }]
        },
        { type: 'AtRuleBlock', name: '@-MOZ-KEYFRAMES', prelude: { type: 'Quoted', value: 'zoom' }, rules: [{ type: 'Ruleset' }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '@KEYFRAMES fade {\n  from,\n  50% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@-MOZ-KEYFRAMES "zoom" {\n  from {\n    opacity: 0;\n  }\n}\n'
    );

    for (const invalid of [
      '@keyframes fade { .card { opacity: 0; } }',
      '@keyframes fade { opacity: 0; }',
      '@keyframes fade { 50px { opacity: 0; } }',
      '@keyframes $name { from { opacity: 0; } }',
      '.card { @keyframes fade { from { opacity: 0; } } }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps block and line comments in trivia instead of statement children', () => {
    const source = '// root\n$theme: blue; /* between */ .card { // inside\n color: $theme; /* tail */ }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();

    expect(result.value).toEqual({
      type: 'Stylesheet',
      rules: [
        expect.objectContaining({ type: 'VariableDeclaration', name: 'theme' }),
        expect.objectContaining({
          type: 'Ruleset',
          rules: [
            expect.objectContaining({ type: 'Declaration', name: 'color' })
          ]
        })
      ]
    });
    expect(JSON.stringify(result.value)).not.toContain('Comment');
  });

  it('keeps `//` out of the AST wherever it may appear, matching the Less parser', () => {
    for (const source of [
      '// only a comment\n',
      '.a { color: red; } // trailing\n',
      '.a {\n  // leading\n  color: red;\n}\n',
      '.a {\n  color: red; // after a declaration\n}\n',
      '$x: 1; // after a variable\n',
      '@media screen {\n  // inside an at-rule\n  .a { color: red; }\n}\n'
    ]) {
      const ast = parse(source);
      expect(JSON.stringify(ast), source).not.toContain('//');
    }
  });

  it('renders `/* */` but never renders a `//` line comment', () => {
    const source = '// dropped\n.card {\n  // dropped\n  color: red; // dropped\n}\n/* kept */\n';
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css)
      .toBe('.card {\n  color: red;\n}\n/* kept */\n');
  });

  it('does not let `//` trivia reach inside strings or url() bodies', () => {
    expect(parse('.a { content: "//not-a-comment"; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Quoted', value: '//not-a-comment' } }] }]
    });

    // A leading space belongs to the string, not to the ambient trivia.
    expect(parse('.a { content: " x"; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Quoted', value: ' x' } }] }]
    });
    expect(() => parse('.a { background: url(//cdn.example.com/x.png); }')).not.toThrow();
    expect(() => parse('.a { background: url("//cdn.example.com/x.png"); }')).not.toThrow();
  });

  it('constructs declarations, static rules, quoted, keyword, numeric, color, call, and variable-reference facts directly', () => {
    const source = '$base: "dark";\n$tone: $base;\n$accent: blue;\n$hex: #0a1B2c;\n$gap: -1.5e2rem;\n$ratio: .5;\n$percent: 50%;\n$shade: rgb(0, 10%, mix(blue, $percent));\n.card { color: $tone; margin: 1rem; filter: blur(2px); }';
    const legacy = parseJessCst(source);
    const result = run(
      jessAstGrammar.Stylesheet,
      source,
      { trivia: jessAstGrammar.whitespace }
    );

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'base', value: { type: 'Quoted', src: '"dark"', value: 'dark', quote: '"', escaped: false }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'tone', value: { type: 'VariableReference', name: 'base', lookup: 'live' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'accent', value: { type: 'Keyword', src: 'blue' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'hex', value: { type: 'Color', src: '#0a1B2c' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'gap', value: { type: 'Dimension', number: -150, unit: 'rem', src: '-1.5e2rem' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'ratio', value: { type: 'Dimension', number: 0.5, unit: '', src: '.5' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'percent', value: { type: 'Dimension', number: 50, unit: '%', src: '50%' }, write: { mode: 'declare' } },
        {
          type: 'VariableDeclaration',
          name: 'shade',
          value: {
            type: 'FunctionCall',
            name: 'rgb',
            args: [
              { type: 'Dimension', number: 0, unit: '', src: '0' },
              { type: 'Dimension', number: 10, unit: '%', src: '10%' },
              {
                type: 'FunctionCall',
                name: 'mix',
                args: [
                  { type: 'Keyword', src: 'blue' },
                  { type: 'VariableReference', name: 'percent', lookup: 'live' }
                ],
                modern: false
              }
            ],
            modern: false
          },
          write: { mode: 'declare' }
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [{ type: 'SimpleSelector', text: '.card', interp: null }]
          },
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone', lookup: 'live' }, merge: null, important: false },
            { type: 'Declaration', name: 'margin', value: { type: 'Dimension', number: 1, unit: 'rem', src: '1rem' }, merge: null, important: false },
            { type: 'Declaration', name: 'filter', value: { type: 'FunctionCall', name: 'blur', args: [{ type: 'Dimension', number: 2, unit: 'px', src: '2px' }], modern: false }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('constructs static CSS url values as Url facts rather than generic calls', () => {
    const source = '.asset { quoted: url("images/icon.svg"); raw: url(images/icon.svg); empty: url(); }';
    const cst = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'quoted', value: { type: 'Url', value: { type: 'Quoted', value: 'images/icon.svg' } } },
        { type: 'Declaration', name: 'raw', value: { type: 'Url', value: { type: 'Any', src: 'images/icon.svg' } } },
        { type: 'Declaration', name: 'empty', value: { type: 'Url', value: { type: 'Any', src: '' } } }
      ] }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.asset {\n  quoted: url("images/icon.svg");\n  raw: url(images/icon.svg);\n  empty: url();\n}\n'
    );
  });

  it('constructs modern CSS slash-separated function components while retaining existing variable-led call expressions', () => {
    const source = '.card { box-shadow: rgb(15 23 42 / 0.22); }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [{
        type: 'Declaration', name: 'box-shadow', value: {
          type: 'FunctionCall', name: 'rgb', args: [{
            type: 'List', sep: '/', value: [
              [{ type: 'Dimension', src: '15' }, { type: 'Dimension', src: '23' }, { type: 'Dimension', src: '42' }],
              { type: 'Dimension', src: '0.22' }
            ]
          }]
        }
      }] }]
    });
    expect(serialize(parse(source))).toEqual({ css: '.card {\n  box-shadow: rgb(15 23 42 / 0.22);\n}\n' });

    const variableCall = parse('$channel: 15; .card { color: rgb($($channel + 8) 23 42 / 0.22); }');
    expect(variableCall.rules[1]).toMatchObject({
      type: 'Ruleset', rules: [{
        type: 'Declaration', value: {
          type: 'FunctionCall', args: [{
            type: 'List', sep: '/', value: [[{ type: 'Interpolation', parts: [{ ref: { type: 'Block', value: { type: 'Operation', operator: '+' } }, unquote: true }] }, { type: 'Dimension', src: '23' }, { type: 'Dimension', src: '42' }], { type: 'Dimension', src: '0.22' }]
          }]
        }
      }]
    });

    for (const invalid of [
      '.card { color: rgb(/ 0.22); }',
      '.card { color: rgb(15 23 42 /); }',
      '.card { color: rgb(15 23 42 / 0.22 / 1); }'
    ]) {
      const cst = parseJessCst(invalid);
      const rejected = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), invalid).toBeGreaterThan(0);
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('constructs structured Jess interpolation in ordinary and CSS-import url targets', () => {
    const source = '$path: "images/icon.svg"; $file: "hero"; @import url(${path}) print; @import url(styles/${file}.css); .asset { direct: url(${path}); joined: url(images/${file}.svg); quoted: url("assets/${file}.svg"); }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'path' },
        { type: 'VariableDeclaration', name: 'file' },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'SpacedValue', parts: [{ type: 'Url', value: { type: 'Interpolation' } }, { type: 'Keyword', src: 'print' }] } },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: 'styles/' }, { ref: { type: 'VariableReference', name: 'file' }, unquote: true }, { lit: '.css' }] } } },
        { type: 'Ruleset', rules: [
          { type: 'Declaration', name: 'direct', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'path' }, unquote: true }] } } },
          { type: 'Declaration', name: 'joined', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: 'images/' }, { ref: { type: 'VariableReference', name: 'file' }, unquote: true }, { lit: '.svg' }] } } },
          { type: 'Declaration', name: 'quoted', value: { type: 'Url', value: { type: 'Interpolation' } } }
        ] }
      ]
    });
    expect(serialize(parse(source))).toEqual({
      css: '@import url(images/icon.svg) print;\n@import url(styles/hero.css);\n.asset {\n  direct: url(images/icon.svg);\n  joined: url(images/hero.svg);\n  quoted: url("assets/hero.svg");\n}\n'
    });

    let missingPath: unknown;
    try {
      void serialize(parse('@import url(${path}); $path: "images/icon.svg";'));
    } catch (error) {
      missingPath = error;
    }
    expect(missingPath).toBeInstanceOf(JessError);
    expect(missingPath).toMatchObject({
      code: 'resolve/name-not-found',
      phase: 'resolve',
      reason: 'Symbol "@path" is undefined in this scope.'
    });
    if (!(missingPath instanceof JessError) || !missingPath.node) {
      throw new Error('expected a JessError with parser provenance');
    }
    expect(sourceSpanOf(missingPath.node)).toEqual({ start: 12, end: 19 });

    expect(parse('@import url();')).toMatchObject({
      rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { type: 'Any', src: '' } } }]
    });
  });

  it('constructs and evaluates a live dynamic variable name without changing existing bracket interpolation', () => {
    const source = '$name: color; $color: navy; $color := blue; .card { dynamic: $[$name]; existing: $[color]; color: red; property: $[color]; }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    const publicDocument = parse(source);
    expect(publicDocument.rules[2]).toMatchObject({
      type: 'VariableDeclaration', name: 'color', write: { mode: 'reassign', lookup: 'live' }
    });
    const publicRule = publicDocument.rules[3];
    expect(publicRule).toMatchObject({ type: 'Ruleset' });
    if (publicRule?.type !== 'Ruleset') {
      throw new TypeError('Expected the dynamic-reference rule.');
    }
    expect(publicRule.rules[0]).toMatchObject({
      type: 'Declaration', name: 'dynamic', value: { type: 'Interpolation', parts: [{ ref: { type: 'VarIndirect', lookup: 'live', nameRef: { type: 'VariableReference', name: 'name', lookup: 'live' } }, unquote: true }] }
    });
    expect(publicRule.rules[1]).toMatchObject({
      type: 'Declaration', name: 'existing', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'color', lookup: 'live' }, unquote: true }] }
    });
    expect(serialize(publicDocument)).toEqual({
      css: '.card {\n  dynamic: blue;\n  existing: blue;\n  color: red;\n  property: blue;\n}\n'
    });
  });

  it('rejects unsupported dynamic CSS url bodies rather than falling through to FunctionCall', () => {
    for (const source of [
      '.asset { image: url($path); }',
      '.asset { image: url(images/$[path] icon.svg); }',
      '@import url($path);',
      '.asset { image: url("images/icon.svg"; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('admits $(…) expression interpolation in url bodies as a value position', () => {
    /*
     * A url body is a value position (like a quote interior), so the $(…)
     * arithmetic/expression form is admitted there alongside the $[…] accessor —
     * unlike identifier-like slots (selectors, property names) which stay accessor-only.
     */
    for (const source of ['.asset { image: url($(path)); }', '@import url($(path));']) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
    }
    const rule = parse('.asset { image: url($(path)); }').rules[0];
    expect(rule).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Declaration', name: 'image',
        value: { type: 'Url', value: { type: 'Interpolation', parts: [
          { ref: { type: 'Block', delimiter: 'paren', value: { type: 'Keyword', src: 'path' } }, unquote: true }
        ] } }
      }]
    });
  });

  it('constructs public static selector lists, compounds, combinators, and nested rules directly', () => {
    const source = '.card:hover > .title.active, #hero + button::before { color: blue; .icon ~ .label { color: red; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: {
          type: 'SelectorList',
          selectors: [
            {
              type: 'ComplexSelector',
              value: [{ type: 'CompoundSelector', value: [{ type: 'SimpleSelector', text: '.card' }, { type: 'SimpleSelector', text: ':hover' }] }, '>', { type: 'CompoundSelector', value: [{ type: 'SimpleSelector', text: '.title' }, { type: 'SimpleSelector', text: '.active' }] }]
            },
            {
              type: 'ComplexSelector',
              value: [{ type: 'SimpleSelector', text: '#hero' }, '+', { type: 'CompoundSelector', value: [{ type: 'SimpleSelector', text: 'button' }, { type: 'SimpleSelector', text: '::before' }] }]
            }
          ]
        },
        rules: [
          { type: 'Declaration', name: 'color' },
          {
            type: 'Ruleset',
            selector: {
              type: 'SelectorList',
              selectors: [{
                type: 'ComplexSelector',
                value: [{ type: 'SimpleSelector', text: '.icon' }, '~', { type: 'SimpleSelector', text: '.label' }]
              }]
            }
          }
        ]
      }]
    });
  });

  it('constructs public static attribute selectors as exact canonical SimpleSelector atoms', () => {
    const source = '[role], [data-kind="primary" i], [lang|=en] { color: blue; }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: {
          type: 'SelectorList',
          selectors: [
            { type: 'SimpleSelector', text: '[role]' },
            { type: 'SimpleSelector', text: '[data-kind="primary"i]' },
            { type: 'SimpleSelector', text: '[lang|=en]' }
          ]
        }
      }]
    });
  });

  it('constructs parent selectors as canonical `&`-bearing SimpleSelector text', () => {
    /*
     * `SimpleSelector.text` retaining `&` IS the dedicated semantic reduction:
     * core's selector path identifies a parent reference from that text and owns
     * both the spec substitution and the name concatenation.
     */
    const source = '.parent { & { color: blue; } &:hover { color: red; } & + & { color: green; } [foo]& { color: teal; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();

    expect(stylesheet(direct.value).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { selector: { selectors: [{ type: 'SimpleSelector', text: '&', interp: null }] } },
        { selector: { selectors: [{ type: 'CompoundSelector', value: [{ text: '&' }, { type: 'SimpleSelector', text: ':hover' }] }] } },
        { selector: { selectors: [{ value: [{ text: '&' }, '+', { text: '&' }] }] } },
        { selector: { selectors: [{ type: 'CompoundSelector', value: [{ text: '[foo]' }, { text: '&' }] }] } }
      ]
    });
  });

  it('fuses a parent selector with its identifier suffix into one selector atom', () => {
    /*
     * The name-concatenation extension. One token keeps "is this compound's
     * subject a bare `&`?" a single string compare, and `&(X)` is the explicit
     * spelling of the same append for suffixes that are not identifiers.
     */
    const source = '.block { &__el { color: blue; } &--mod { color: red; } &-suffix { color: green; } &(-1) { color: teal; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();

    expect(stylesheet(direct.value).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { selector: { selectors: [{ type: 'SimpleSelector', text: '&__el', interp: null }] } },
        { selector: { selectors: [{ type: 'SimpleSelector', text: '&--mod', interp: null }] } },
        { selector: { selectors: [{ type: 'SimpleSelector', text: '&-suffix', interp: null }] } },
        { selector: { selectors: [{ type: 'SimpleSelector', text: '&-1', interp: null }] } }
      ]
    });
  });

  it('fuses a parent selector with a glued $[…] template into one selector atom', () => {
    /*
     * A split representation would resolve the bare `&` to `:is(parents)` first
     * and append to that; only the fused atom distributes per parent.
     */
    const source = '$tone: primary; .a, .b { &-${tone} { color: blue; } }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(stylesheet(direct.value).rules[1]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Ruleset',
        selector: {
          selectors: [{
            type: 'SimpleSelector',
            text: null,
            interp: {
              type: 'Interpolation',
              parts: [{ lit: '&-' }, { ref: { type: 'VariableReference', name: 'tone' }, unquote: true }]
            }
          }]
        }
      }]
    });
  });

  it('keeps `&` suffixes that are not identifiers, and the at-root template, out of the route', () => {
    /*
     * `&-1` is rejected because `-1` is not an identifier: `&(-1)` is how the
     * append is spelled. `&('')` is an output-PLACEMENT instruction (Sass's
     * `@at-root`), which has no AST v2 carrier, and `nil` is not a Jess keyword,
     * so neither may degrade into an append of nothing.
     */
    for (const source of ['.a { &-1 { color: blue; } }', '.a { &1 { color: blue; } }', '.a { &() { color: blue; } }', '.a { &(\'\') { color: blue; } }', '.a { &(nil) { color: blue; } }']) {
      const cst = parseJessCst(source);
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value)).toBe(false);
    }
  });

  it('parses `&` in $extend while public parse keeps $extend and $apply class-only by default', () => {
    const source = '.a { color: blue; } .b { .c { $extend &; $apply .a-1; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();

    expect(stylesheet(direct.value).rules[1]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Ruleset',
        extendInstructions: [{ target: { selectors: [{ type: 'SimpleSelector', text: '&' }] }, partial: true }],
        rules: [{ type: 'Apply', selectors: [{ text: '.a-1' }] }]
      }]
    });
    expect(() => parse(source)).toThrow(SyntaxError);
    expect(() => parse(source, { allowExtendSelectors: ['basic'] })).not.toThrow();
    expect(() => parse('.a { .b { $apply &(-1); } }')).toThrow(SyntaxError);
  });

  it('constructs public $[…] selector templates as Interp-backed SimpleSelector atoms', () => {
    const source = '$side: left; .widget-${side}-${[tone]} { tone: dark; color: blue; }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'side' },
        {
          type: 'Ruleset',
          selector: {
            selectors: [{
              type: 'SimpleSelector', text: null,
              interp: {
                type: 'Interpolation',
                parts: [
                  { lit: '.widget-' },
                  { ref: { type: 'VariableReference', name: 'side' }, unquote: true },
                  { lit: '-' },
                  { ref: { type: 'PropertyReference', name: 'tone', raw: '${[tone]}' }, unquote: true }
                ]
              }
            }]
          }
        }
      ]
    });
  });

  it('evaluates parsed bare and quoted selector templates in their nesting scope', () => {
    const document = parse('$side: left; .shell { tone: dark; .widget-${side}-${[tone]} { color: blue; } }');

    expect(serialize(document).css).toBe(
      '.shell {\n'
      + '  tone: dark;\n'
      + '}\n'
      + '.shell .widget-left-dark {\n'
      + '  color: blue;\n'
      + '}\n'
    );
  });

  it('feeds parsed bare and quoted selector templates through the extend planner', () => {
    const parsed = parse('$side: bare; .scope { tone: quoted; .target { color: blue; } .bare-${side} {} .quoted-${[tone]} {} }');
    const scope = parsed.rules[1];
    if (scope?.type !== 'Ruleset') {
      throw new TypeError('Expected parsed scope rule.');
    }
    const target = scope.rules[1];
    const bare = scope.rules[2];
    const quoted = scope.rules[3];
    if (target?.type !== 'Ruleset' || bare?.type !== 'Ruleset' || quoted?.type !== 'Ruleset') {
      throw new TypeError('Expected parsed nested rules.');
    }
    const extend = (candidate: Ruleset): Ruleset => ({
      ...candidate,
      extendInstructions: [{ target: target.selector, partial: true }]
    });
    const document: Stylesheet = {
      ...parsed,
      rules: [
        parsed.rules[0]!,
        { ...scope, rules: [scope.rules[0]!, target, extend(bare), extend(quoted)] }
      ]
    };

    expect(serialize(document).css).toBe(
      '.scope {\n'
      + '  tone: quoted;\n'
      + '}\n'
      + '.scope :is(.target, .scope .bare-bare, .scope .quoted-quoted) {\n'
      + '  color: blue;\n'
      + '}\n'
    );
  });

  it('constructs structural Jess key and expression interpolation in values and quoted strings', () => {
    const source = '$tone: blue; $gap: 2px; $key: $[tone]; $quoted-key: $["theme"]; $math: $(1 + 2 * $gap); $compare: $(1  +  2 = 3); $quoted-compare: $("a-${tone}" = foo); .card { content: "tone-${tone}-$(1 + 2)"; color: rgb($[tone], $(1 + 2), blue); }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'tone' },
        { type: 'VariableDeclaration', name: 'gap' },
        { type: 'VariableDeclaration', name: 'key', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'tone' }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'quoted-key', value: { type: 'Interpolation', parts: [{ ref: { type: 'PropertyReference', name: 'theme', raw: '$["theme"]' }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'math', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '+' } }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'compare', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', value: { type: 'Condition', guard: { g: 'cmp', op: '=' }, src: '1  +  2 = 3' } }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'quoted-compare', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', value: { type: 'Condition', guard: { g: 'cmp', op: '=' }, src: '"a-${tone}" = foo' } }, unquote: true }] } },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'content', value: { type: 'Interpolation' } }, { type: 'Declaration', name: 'color', value: { type: 'FunctionCall', args: [{ type: 'Interpolation' }, { type: 'Interpolation' }, { type: 'Keyword', src: 'blue' }] } }] }
      ]
    });
  });

  it('keeps bare and quoted key interpolation as distinct direct-AST lookups through render', () => {
    const document = parse('$tone: teal; .card { color: blue; bare: $[tone]; quoted: $["color"]; }');

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'tone' },
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' } },
            { type: 'Declaration', name: 'bare', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'tone' }, unquote: true }] } },
            { type: 'Declaration', name: 'quoted', value: { type: 'Interpolation', parts: [{ ref: { type: 'PropertyReference', name: 'color', raw: '$["color"]' }, unquote: true }] } }
          ]
        }
      ]
    });
    expect(serialize(document).css).toBe('.card {\n  color: blue;\n  bare: teal;\n  quoted: blue;\n}\n');
  });

  it('constructs public Jess $for single, comma, and bracket bindings directly', () => {
    const source = '$for ($item of $items) { .single { value: $item; } }\n$for ($item, $key, $counter of $items) { .comma { value: $item; key: $key; counter: $counter; } }\n$for ([$key, $value] of $collection) { .bracket { key: $key; value: $value; } }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          binding: { kind: 'single', name: 'item' },
          iterable: { type: 'VariableReference', name: 'items', lookup: 'live' },
          rules: [{
            type: 'Ruleset',
            selector: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: '.single', interp: null }] },
            rules: [{ type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'item', lookup: 'live' }, merge: null, important: false }]
          }]
        },
        {
          type: 'For',
          binding: { kind: 'comma', names: ['item', 'key', 'counter'] },
          iterable: { type: 'VariableReference', name: 'items', lookup: 'live' },
          rules: [{
            type: 'Ruleset',
            selector: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: '.comma', interp: null }] },
            rules: [
              { type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'item', lookup: 'live' }, merge: null, important: false },
              { type: 'Declaration', name: 'key', value: { type: 'VariableReference', name: 'key', lookup: 'live' }, merge: null, important: false },
              { type: 'Declaration', name: 'counter', value: { type: 'VariableReference', name: 'counter', lookup: 'live' }, merge: null, important: false }
            ]
          }]
        },
        {
          type: 'For',
          binding: { kind: 'bracket', names: ['key', 'value'] },
          iterable: { type: 'VariableReference', name: 'collection', lookup: 'live' },
          rules: [{
            type: 'Ruleset',
            selector: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: '.bracket', interp: null }] },
            rules: [
              { type: 'Declaration', name: 'key', value: { type: 'VariableReference', name: 'key', lookup: 'live' }, merge: null, important: false },
              { type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'value', lookup: 'live' }, merge: null, important: false }
            ]
          }]
        }
      ]
    });
  });

  it('recognizes a documented $for loop as one direct grammar production', () => {
    const source = '$for ($item of $items) { .item { value: $item; } }';
    const result = run(jessAstGrammar.For, source, { trivia: jessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'For',
      binding: { kind: 'single', name: 'item' },
      iterable: { type: 'VariableReference', name: 'items', lookup: 'live' },
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'value' }] }]
    });
  });

  it('constructs typed Jess $for ranges, including an exclusive end', () => {
    const source = '$for ($i of 1 to 3) { .inclusive { value: $i; } }\n$for ($i of 1 to <3) { .exclusive { value: $i; } }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For', binding: { kind: 'single', name: 'i' },
          iterable: { type: 'Range', start: { type: 'Dimension', number: 1 }, end: { type: 'Dimension', number: 3 }, step: null, includeStart: true, includeEnd: true }
        },
        {
          type: 'For', binding: { kind: 'single', name: 'i' },
          iterable: { type: 'Range', start: { type: 'Dimension', number: 1 }, end: { type: 'Dimension', number: 3 }, step: null, includeStart: true, includeEnd: false }
        }
      ]
    });
  });

  it('keeps the documented source-dependent $for list and range behavior on the public Stylesheet route', () => {
    const listDocument = parse('$sections: header, sidebar, footer; $for ($section, $i of $sections) { .box-${section} { padding-left: $($i * 20px); } }');
    expect(serialize(listDocument, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.box-header {\n  padding-left: 20px;\n}\n.box-sidebar {\n  padding-left: 40px;\n}\n.box-footer {\n  padding-left: 60px;\n}\n'
    );

    const rangeDocument = parse('$for ($i of 1 to <3) { .box-${i} { value: $i; } }');
    expect(serialize(rangeDocument, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.box-1 {\n  value: 1;\n}\n.box-2 {\n  value: 2;\n}\n'
    );
  });

  it('constructs a documented Jess collection RHS for public bracket $for rendering', () => {
    const source = '$collection: { header: red; footer: blue; }; $for ([$key, $value] of $collection) { .box-${key} { color: $value; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toEqual(direct.value);
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'collection',
          value: {
            type: 'Collection',
            entries: [
              { type: 'CollectionEntry', key: { type: 'Keyword', src: 'header' }, value: { type: 'Keyword', src: 'red' } },
              { type: 'CollectionEntry', key: { type: 'Keyword', src: 'footer' }, value: { type: 'Keyword', src: 'blue' } }
            ]
          }
        },
        { type: 'For', binding: { kind: 'bracket', names: ['key', 'value'] } }
      ]
    });
    expect(serialize(parse(source)).css).toBe(
      '.box-header {\n  color: red;\n}\n.box-footer {\n  color: blue;\n}\n'
    );
    expect(parse('$collection: { slot: @{ color: red; }; };')).toMatchObject({
      rules: [{
        value: {
          type: 'Collection',
          entries: [{
            type: 'CollectionEntry',
            key: { type: 'Keyword', src: 'slot' },
            value: { type: 'AnonymousMixin', rules: [{ type: 'Declaration', name: 'color' }] }
          }]
        }
      }]
    });
  });

  it('preserves public variable range bounds, exclusions, steps, and descending order as typed Range fields', () => {
    const source = '$start: 9; $end: 1; $step: 2; $for ($i of >$start to <$end step $step) { .item { value: $i; } }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'start' },
        { type: 'VariableDeclaration', name: 'end' },
        { type: 'VariableDeclaration', name: 'step' },
        {
          type: 'For',
          binding: { kind: 'single', name: 'i' },
          iterable: {
            type: 'Range',
            start: { type: 'VariableReference', name: 'start' },
            end: { type: 'VariableReference', name: 'end' },
            step: { type: 'VariableReference', name: 'step' },
            includeStart: false,
            includeEnd: false
          }
        }
      ]
    });
  });

  it('constructs public Jess mixin definitions, defaults, calls, and namespace chains directly', () => {
    const source = 'button-base($bg: #1a73e8, $pad: 1rem) { color: $bg; padding: $pad; }\n#ns() { .inner() { color: blue; } }\n.button { $ > button-base(); $ > #ns > .inner(); }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition', name: 'button-base',
          params: [
            { name: 'bg', default: { type: 'Color', src: '#1a73e8' } },
            { name: 'pad', default: { type: 'Dimension', number: 1, unit: 'rem', src: '1rem' } }
          ],
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'bg', lookup: 'live' }, merge: null, important: false },
            { type: 'Declaration', name: 'padding', value: { type: 'VariableReference', name: 'pad', lookup: 'live' }, merge: null, important: false }
          ]
        },
        {
          type: 'MixinDefinition', name: '#ns', params: [], rules: [
            { type: 'MixinDefinition', name: '.inner', params: [], rules: [
              { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' }, merge: null, important: false }
            ] }
          ]
        },
        {
          type: 'Ruleset',
          selector: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: '.button', interp: null }] },
          rules: [
            { type: 'MixinCall', name: 'button-base', args: [], path: [], important: false },
            { type: 'MixinCall', name: '.inner', args: [], path: [{ combinator: '>', selector: '#ns' }], important: false }
          ]
        }
      ]
    });
  });

  it('constructs named Jess mixin arguments as canonical CallArg facts and evaluates defaults', () => {
    const source = 'button-base($bg: #1a73e8, $pad: 1rem) { color: $bg; padding: $pad; } .button { $ > button-base($pad: 0.25rem); }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'MixinDefinition' }, {
        type: 'Ruleset', rules: [{
          type: 'MixinCall', name: 'button-base', args: [{
            name: 'pad', value: { type: 'Dimension', number: 0.25, unit: 'rem', src: '0.25rem' }
          }]
        }]
      }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe('.button {\n  color: #1a73e8;\n  padding: 0.25rem;\n}\n');
  });

  it('keeps named mixin arguments source-ordered and variable-valued arguments positional', () => {
    const source = '.button { $ > button-base($pad: 2px, $bg: red); $ > button-base($tone); }';
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({ rules: [{
      type: 'Ruleset', rules: [
        { type: 'MixinCall', args: [
          { name: 'pad', value: { type: 'Dimension', number: 2, unit: 'px' } },
          { name: 'bg', value: { type: 'Keyword', src: 'red' } }
        ] },
        { type: 'MixinCall', args: [{ value: { type: 'VariableReference', name: 'tone', lookup: 'live' } }] }
      ]
    }] });
  });

  it('constructs zero-argument variable-held callable statements as final Reference calls', () => {
    const source = '$my-mixin: @{ color: red; }; .box { $my-mixin(); }';
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'my-mixin', value: { type: 'AnonymousMixin' } },
        { type: 'Ruleset', rules: [{ type: 'Reference', base: { type: 'VariableReference', name: 'my-mixin', lookup: 'live' }, steps: [{ type: 'Call', args: [] }], raw: '$my-mixin()' }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.box {\n  color: red;\n}\n'
    );
    expect(() => parse('.box { $my-mixin(red); }')).toThrow(SyntaxError);
  });

  it('constructs static Jess mixin guards directly, retains the CST guard route, and exposes them through public parse', () => {
    const source = 'match($value) when (($value = true) and not(false)) { color: red; } fallback($value) when (default()) { color: blue; } either() when (false or true) { color: green; } numeric($value) when ($type.isnumber($value)) { color: purple; } unit($value) when ($type.isunit($value, px)) { color: orange; } .yes { $ > match(true); } .no { $ > fallback(false); } .or { $ > either(); } .number { $ > numeric(2px); } .word { $ > numeric(word); } .unit { $ > unit(3px); }';
    const cst = parseJessCst('match($value) when ($value = true) {}');
    const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(hasCstGrammar(cst.tree, 'MixinDefinition')).toBe(true);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({ type: 'Stylesheet' });
    expect(stylesheet(direct.value).rules.slice(0, 5)).toMatchObject([
      {
        type: 'MixinDefinition', name: 'match',
        guard: {
          g: 'and',
          left: { g: 'cmp', op: '=' },
          right: { g: 'not', inner: { g: 'truth' } }
        }
      },
      { type: 'MixinDefinition', name: 'fallback', guard: { g: 'default' } },
      { type: 'MixinDefinition', name: 'either', guard: { g: 'or', left: { g: 'truth' }, right: { g: 'truth' } } },
      { type: 'MixinDefinition', name: 'numeric', guard: { g: 'call', name: 'isnumber', args: [{ type: 'VariableReference', name: 'value' }] } },
      { type: 'MixinDefinition', name: 'unit', guard: { g: 'call', name: 'isunit', args: [{ type: 'VariableReference', name: 'value' }, { type: 'Keyword', src: 'px' }] } }
    ]);
    expect(parse(source)).toEqual(direct.value);
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.yes {\n  color: red;\n}\n.no {\n  color: blue;\n}\n.or {\n  color: green;\n}\n.number {\n  color: purple;\n}\n.unit {\n  color: orange;\n}\n'
    );

    for (const invalid of [
      'm() WHEN (true) {}',
      'm($value) when ($value = true and $value = false) {}',
      'm() when ((true) and (false) or (true)) {}',
      'm() when (default(1)) {}',
      'm($value) when ($type.unknown($value)) {}',
      'm($value) when ($type.isnumber()) {}',
      'm($value) when ($type.isnumber($value, px)) {}',
      'm($value) when ($type.isunit($value, px, extra)) {}'
    ]) {
      const directInvalid = run(jessAstGrammar.Stylesheet, invalid, { trivia: jessAstGrammar.whitespace });
      expect(directInvalid.ok && directInvalid.unconsumedFrom === null, invalid).toBe(false);
    }
  });

  it('keeps malformed Jess mixin argument lists out of the direct route instead of treating them as text', () => {
    for (const source of [
      '.button { $ > mixin(1,); }',
      '.button { $ > mixin($a:); }',
      '.button { $ > mixin(a: red); }',
      '.button { $ > mixin($$a: red); }',
      '.button { $ > mixin($a?: red); }',
      '.button { $ > mixin($a := red); }',
      '.button { $ > mixin($[a]: red); }'
    ]) {
      const direct = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
  });

  it('matches public rejection of malformed Jess interpolation without a text fallback', () => {
    for (const source of ['$key: $[];', '$key: $[tone;', '$key: $ [tone];', '$key: $[ tone];', '$key: $[tone ];', '$key: $(1 + );', '$key: "tone-$[tone";']) {
      const legacy = parseJessCst(source);
      const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(legacy.errors.length + Number(legacy.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs documented $[…] declaration-name interpolation through public parse', () => {
    const source = '$radius: top-right; $property: accent; .card { border-${radius}-radius: 12px; ${property}: blue; }';
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'radius' },
        { type: 'VariableDeclaration', name: 'property' },
        { type: 'Ruleset', rules: [
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'border-' }, { ref: { type: 'VariableReference', name: 'radius', lookup: 'live' }, unquote: true }, { lit: '-radius' }] } },
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'property', lookup: 'live' }, unquote: true }] } }
        ] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '.card {\n  border-top-right-radius: 12px;\n  accent: blue;\n}\n'
    );

    for (const invalid of [
      '.card { $[]: blue; }',
      '.card { $[property: blue; }',
      '.card { $[ property]: blue; }',
      '.card { $(property): blue; }',
      '.card { $theme.foo: blue; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  /*
   * `${…}` is THE interpolation form for every name, selector, and string
   * position. `$[…]` is a value-position LOOKUP and is rejected here; `$(…)` is
   * a value-position expression. One form per position, no overlap.
   */
  it('constructs ${…} name interpolation in every name, selector, and string position', () => {
    const evaluator = buildEvaluator(makeLessRegistry());
    const source = [
      '$radius: top-right; $property: accent; $side: left; $tone: primary; $family: serif;',
      '.card-${side} { border-${radius}-radius: 12px; ${property}: blue; --${side}-pad: 4px;',
      '  content: "font-${family}"; background: url(${family}.woff);',
      '  &-${tone} { color: red; } }'
    ].join('\n');
    expect(serialize(parse(source), { evaluator }).css).toBe(
      '.card-left {\n'
      + '  border-top-right-radius: 12px;\n'
      + '  accent: blue;\n'
      + '  --left-pad: 4px;\n'
      + '  content: "font-serif";\n'
      + '  background: url(serif.woff);\n'
      + '}\n'
      + '.card-left-primary {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  /*
   * Inside `${…}`, BARE-vs-BRACKETED selects the namespace — the same rule `[…]`
   * follows everywhere else in the language. Quoting selects nothing: `[foo]` and
   * `["foo"]` are the same plain-string key, so quotes appear only when the
   * string is not a valid identifier.
   */
  it('splits the ${…} namespace on bare-vs-bracketed, never on quoting', () => {
    /*
     * The first simple selector's interpolation, minus its leading literal — the
     * one part whose `ref` carries the namespace this test is about.
     */
    const parts = (source: string): InterpPart => {
      const rule = parse(source).rules[0];
      if (rule?.type !== 'Ruleset') {
        throw new TypeError('Expected a Ruleset');
      }
      const term = firstSelectorTerm(rule.selector.selectors[0]);
      const simple = term?.type === 'CompoundSelector' ? term.value[0] : term;
      const interp = simple?.interp;
      const part = interp?.parts[1];
      if (part === undefined) {
        throw new TypeError('Expected an interpolated simple selector');
      }
      return part;
    };

    expect(parts('.w-${side} { a: b; }')).toMatchObject({
      ref: { type: 'VariableReference', name: 'side', lookup: 'live' }
    });
    expect(parts('.w-${[tone]} { a: b; }')).toMatchObject({
      ref: { type: 'PropertyReference', name: 'tone', raw: '${[tone]}' }
    });

    // Quotes are escaping only — `a b` is not a valid identifier.
    expect(parts('.w-${["a b"]} { a: b; }')).toMatchObject({
      ref: { type: 'PropertyReference', name: 'a b' }
    });

    // A computed key stays the two-step indirection.
    expect(parts('.w-${[$k]} { a: b; }')).toMatchObject({
      ref: { type: 'VarIndirect', nameRef: { type: 'VariableReference', name: 'k' } }
    });
  });

  /*
   * One form per position. Each of these is the RIGHT spelling in some other
   * position, which is exactly why it must fail here rather than degrade.
   */
  it('rejects each $ form outside the position it belongs to', () => {
    for (const invalid of [
      // `${…}` is not a value form — `$name` / `$[…]` / `$(…)` are.
      '.card { color: ${tone}; }',
      '.card { color: ${[tone]}; }',

      // `$[…]` is not an identifier or string form.
      '.card-$[side] { a: b; }',
      '.card { border-$[radius]-radius: 12px; }',
      '.card { --$[side]-pad: 4px; }',
      '.a { &-$[tone] { color: red; } }',
      '.card { content: "font-$[family]"; }',
      '.card { content: ~"font-$[family]"; }',

      // Malformed bodies must be positioned errors, never raw bytes.
      '.card { ${}: blue; }',
      '.card { ${ property}: blue; }',
      '.card { ${$property}: blue; }',
      '.card { ${m.key}: blue; }',
      '.card { ${property: blue; }',
      '.card { ${[tone}: blue; }',
      '.card-${[]} { a: b; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  /*
   * css-syntax-3 §5.4.7 "consume a list of declarations": `;` SEPARATES
   * declarations, it does not terminate them. The last declaration in a block
   * needs no `;`, and an empty declaration between two separators is skipped
   * rather than being an error. Replicated as a matrix in
   * `conditional-at-rule-value.test.ts` for every dialect.
   */
  it('treats `;` as a declaration-list separator, not a required terminator', () => {
    const evaluator = buildEvaluator(makeLessRegistry());
    for (const source of [
      'a { color: red }',
      'a { color: red; }',
      'a { color: red;; }',
      'a { ; color: red }',
      'a { color: red; background: blue }',
      'a { color: red !important }',
      'a { --x: 1px }',
      'a { color: red; b { x: 1 } }',
      'a { color: red; @media all { x: 1 } }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }
    expect(serialize(parse('a { ; color: red;; background: blue }'), { evaluator }).css).toBe(
      'a {\n  color: red;\n  background: blue;\n}\n'
    );
  });

  /*
   * A function is an anonymous mixin that yields one value: `@(params)` is the
   * parameter list a named mixin declares and `>` is the "yield one value"
   * marker. It reduces to the SAME `AnonymousMixin` an SCSS `@function` lowers
   * to, so one binder and one `result:` convention serve both dialects.
   */
  it('constructs a stylesheet-defined function as a params-carrying AnonymousMixin', () => {
    expect(parse('$foo: @($arg1, $arg2) > {\n  result: bar;\n}\n\n.box {\n  output: $foo(1, 2);\n}')).toMatchObject({
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'foo',
          value: {
            type: 'AnonymousMixin',
            params: [{ name: 'arg1' }, { name: 'arg2' }],
            rules: [{ type: 'Declaration', name: 'result', value: { type: 'Keyword', src: 'bar' } }]
          }
        },
        {
          type: 'Ruleset',
          rules: [{
            type: 'Declaration',
            name: 'output',
            value: {
              type: 'Reference',
              base: { type: 'VariableReference', name: 'foo' },
              steps: [{ type: 'Call', args: [{ value: { src: '1' } }, { value: { src: '2' } }] }]
            }
          }]
        }
      ]
    });

    /*
     * The single-expression body is sugar for a body whose only statement is
     * `result: <expr>`, so evaluation never sees which spelling was authored.
     */
    expect(parse('$f: @() > some-val;')).toMatchObject({
      rules: [{ value: { type: 'AnonymousMixin', rules: [{ type: 'Declaration', name: 'result', value: { src: 'some-val' } }] } }]
    });
  });

  it('admits calls as `$(…)` expression atoms and nests them to any depth', () => {
    /*
     * A call is a value, so it is an arithmetic atom. Both spellings work, in
     * any position an atom may appear, nested arbitrarily.
     */
    for (const source of [
      '$d: @($n) > $($n * 2);\n$quad: @($n) > $($d($d($n)));\n.box { width: $quad(2); }',
      '.box { width: $($d($d($d(2)))); }',
      '.box { width: $($d(2) * 2); }',
      '.box { width: $(2 * $d(2)); }',
      '.box { width: $($d(1) + $d(3)); }',
      '.box { width: $($map.entry($n)); }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }

    /*
     * A BARE-name call stays out of the expression atom: this atom is shared
     * with `$if`/`when`, whose conditions must keep rejecting mixin-only
     * `default()`. Dispatch is spelled `$fn(…)`.
     */
    expect(() => parse('.box { width: $(max(1, 2)); }')).toThrow(SyntaxError);

    /*
     * The call reduces to the same typed fact `$d(2)` already produces in value
     * position — a Reference carrying a Call step — not to opaque text.
     */
    expect(parse('.box { width: $($d($d(2))); }')).toMatchObject({
      rules: [{
        rules: [{
          type: 'Declaration',
          name: 'width',
          value: {
            type: 'Interpolation',
            parts: [{
              ref: {
                type: 'Block',
                value: {
                  type: 'Reference',
                  base: { type: 'VariableReference', name: 'd' },
                  steps: [{
                    type: 'Call',
                    args: [{
                      value: {
                        type: 'Reference',
                        base: { type: 'VariableReference', name: 'd' },
                        steps: [{ type: 'Call', args: [{ value: { src: '2' } }] }]
                      }
                    }]
                  }]
                }
              }
            }]
          }
        }]
      }]
    });

    // A plain reference is still a plain reference — no empty call step.
    expect(parse('.box { width: $($n); }')).toMatchObject({
      rules: [{ rules: [{ value: { parts: [{ ref: { value: { type: 'VariableReference', name: 'n' } } }] } }] }]
    });
  });

  it('evaluates a nested call', () => {
    const source = '$d: @($n) > $($n * 2);\n.box {\n  width: $d($d(2px));\n}';
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css)
      .toBe('.box {\n  width: 8px;\n}\n');
  });

  /*
   * The `$( … )` block is a math BOUNDARY, not an authored paren group: its
   * delimiters are the `$(`/`)` of the spelling itself. It must open the
   * parens-division context without ever emitting a paren, however its inner
   * folds — a call result and a bare keyword both reach it as plain bytes, and
   * used to come back wrapped in parens nobody wrote.
   */
  it('never emits the `$( … )` delimiters, whatever the boundary wraps', () => {
    const evaluator = { evaluator: buildEvaluator(makeLessRegistry()) };
    const render = (source: string) => serialize(parse(source), evaluator).css;
    const double = '$d: @($n) > $($n * 2);\n';

    // A call — directly, and as the sole value of another function's body.
    expect(render(`${double}.box { width: $($d(2px)); }`)).toBe('.box {\n  width: 4px;\n}\n');
    expect(render(`${double}$q: @($n) > $($d($d($n)));\n.box { width: $q(2px); }`))
      .toBe('.box {\n  width: 8px;\n}\n');

    // Values that never materialize to a typed object reach the boundary as bytes.
    expect(render('.box { width: $(foo); }')).toBe('.box {\n  width: foo;\n}\n');
    expect(render('.box { color: $(red); }')).toBe('.box {\n  color: red;\n}\n');
    expect(render('.box { content: "x$(foo)y"; }')).toBe('.box {\n  content: "xfooy";\n}\n');

    // An AUTHORED group inside the boundary is a real paren group and stays.
    expect(render('.box { width: $((foo)); }')).toBe('.box {\n  width: (foo);\n}\n');

    // The boundary still opens the math context it exists to mark.
    expect(render('.box { width: $(4px / 2); }')).toBe('.box {\n  width: 2px;\n}\n');
  });

  /*
   * Before emitting a declaration, the serializer probes whether its value is a
   * detached ruleset by walking the binding chain. Each hop lands in the scope
   * that OWNS it — a call yields its `result:` in the activation frame holding
   * the params — so the walk has to keep resolving there. Restarting every hop
   * in the frame the walk began in loses the params, and a `result:` that calls
   * on through died with `Name not found` on its own argument.
   */
  it('keeps a chained call in its own frame while probing a declaration value', () => {
    const evaluator = { evaluator: buildEvaluator(makeLessRegistry()) };
    const render = (source: string) => serialize(parse(source), evaluator).css;
    const double = '$double: @($n) > $($n * 2);\n';

    // A block body calling an OUTER stylesheet function, passing its own param.
    expect(render(`${double}$q: @($v) > { result: $double($v); }\n.box { width: $q(2px); }`))
      .toBe('.box {\n  width: 4px;\n}\n');
    expect(render(`${double}$q: @($v) > { result: $double($double($v)); }\n.box { width: $q(2px); }`))
      .toBe('.box {\n  width: 8px;\n}\n');

    // The documented higher-order shape (06-functions.mdx), function by param.
    expect(render(`${double}$twice: @($fn, $v) > { result: $fn($fn($v)); }\n.box { value: $twice($double, 3); }`))
      .toBe('.box {\n  value: 12;\n}\n');

    /*
     * A Jess `{ ... }` value is collection data, not a detached ruleset. It can
     * be assigned, aliased, and serialized as a declaration value.
     */
    expect(render('$dr: { color: red; }\n.box { width: $dr; }'))
      .toBe('.box {\n  width: { color: red };\n}\n');
    expect(render('$dr: { color: red; }\n$a: $dr;\n.box { width: $a; }'))
      .toBe('.box {\n  width: { color: red };\n}\n');

    /*
     * The probe still does its job for the explicit anonymous-mixin spelling: a
     * ruleset on a property is rejected, direct or through an alias hop.
     */
    expect(() => render('$dr: @{ color: red; }\n.box { width: $dr; }'))
      .toThrow(/Rulesets cannot be evaluated on a property/);
    expect(() => render('$dr: @{ color: red; }\n$a: $dr;\n.box { width: $a; }'))
      .toThrow(/Rulesets cannot be evaluated on a property/);
  });

  /*
   * A block-valued assignment auto-terminates at its closing brace; the block
   * must be the WHOLE value, since a value preceding it would have no
   * unambiguous end. Less has the same rule for a detached ruleset.
   */
  it('auto-terminates a block-valued assignment and rejects a value before the block', () => {
    for (const source of [
      '$foo: { }', '$foo: @{}', '$foo: @() > { }',
      '$foo: { };', '$foo: @{};', '$foo: @() > { };'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }

    // Whatever follows the closing brace begins a NEW statement.
    expect(parse('$foo: {} $bar: 1;')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'foo', value: { type: 'Collection' } },
        { type: 'VariableDeclaration', name: 'bar' }
      ]
    });

    /*
     * Nothing may precede the block — with OR without a `;`. Compose instead:
     * `$foo: {}` then `$bar: $foo bar;`.
     */
    for (const source of ['$foo: bar { }', '$foo: bar @() > { }', '$foo: bar @() > { };', '$foo: bar { };']) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }

    /*
     * `;` SEPARATES declarations, so a non-block value that is last in its run
     * needs no terminator either — the block exception is about a `;` staying
     * optional when more declarations FOLLOW, not about non-blocks requiring one.
     */
    expect(() => parse('$foo: @() > some-val')).not.toThrow();
  });

  it('separates declarations with `;` rather than terminating them', () => {
    /*
     * `;` is a SEPARATOR (css-syntax-3 §5.4.7). A declaration that is last in
     * its run — before `}`, before EOF, or before something that is not another
     * declaration — needs no `;`. A variable assignment IS a declaration, so
     * every case below holds identically for `$c:` and for `color:`.
     */
    for (const source of [
      '.a { color: red }',
      '.a { color: red; background: blue }',
      '$c: red',
      '$c: red\n.a { color: $c; }',
      '$c: red\n@media screen { .a { color: $c; } }',
      '.a { $c: red }',
      '$c: red;\n$d: blue',

      /*
       * The block exception: a variable declaration whose SOLE value is a curly
       * block auto-terminates at `}`, so its `;` is optional. (A CSS property
       * declaration takes no block value, so the exception cannot arise there.)
       */
      '$m: { family: serif; }\n.a { color: red; }',
      '$mx: @() { color: red; }\n.a { $mx(); }',

      // A trailing separator is allowed and an empty declaration is skipped.
      '.a { color: red; }',
      '.a { color: red;; }',
      '.a { ; }',
      '.a { ; color: red }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }

    /*
     * An unterminated declaration before a NESTED RULE stays invalid — `{`
     * makes the value's end ambiguous. This holds for `$c:` exactly as it does
     * for `color:`; it is the one shape a missing separator must not buy.
     */
    for (const source of ['a { color: red b { x: 1 } }', 'a { $c: red b { x: 1 } }']) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }

    // Two declarations still need the separator BETWEEN them.
    for (const source of ['.a { color: red background: blue }', '.a { $c: red $d: blue }']) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }

    /*
     * Making the separator optional must NOT buy the dropped permissive form:
     * a value may never precede the block, with OR without a `;`.
     */
    for (const source of ['$foo: bar { }', '$foo: bar { };', '$foo: bar @() > { }', '$foo: bar @() > { };']) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('does not widen the closed direct declaration/value subset', () => {
    for (const source of [
      'color: red;',
      '$tone: $;',
      '$tone: 17px-1px;',
      '$\\66 oo: blue;',
      '$tone: rgb(1,);',
      '$tone: #12345;',
      '$tone: #123456789;',

      /*
       * `--` alone is reserved by css-variables-1 §2, so it is not a custom
       * property name in any dialect. (`--$[property]` IS one, and is asserted
       * in custom-property.test.ts alongside the less/scss equivalents.)
       */
      '.card { --: blue; }'
    ]) {
      const result = run(jessAstGrammar.Stylesheet, source, { trivia: jessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });
});
