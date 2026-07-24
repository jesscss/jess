import { run } from 'parseman';
import { sourceSpanOf, type Stylesheet, type Rule, type SimpleToken } from '@jesscss/core/ast';
import { JessError } from '@jesscss/core';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../core/src/ast/evaluator.js';
import { serialize } from '../../core/src/ast/serialize.js';
import { parseJessCst } from '../src/cst.js';
import { parse } from '../src/index.js';
import { jessAstGrammar } from '../src/ast/grammar.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

function stylesheet(value: unknown): Stylesheet {
  if (!isStylesheet(value)) {
    throw new TypeError('Expected the Jess grammar to produce a Stylesheet');
  }
  return value;
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
  return 'children' in node && Array.isArray(node.children)
    && node.children.some(child => hasCstGrammar(child, grammarType));
}

describe('Jess AST grammar facts', () => {
  it('keeps ordinary adjacency as a raw value array and reserves List for explicit separators', () => {
    const direct = run(
      jessAstGrammar.JessAstDocument,
      '$space: red blue; $comma: red, blue; $w: 1; .x { slash: $w / 2; }',
      { trivia: jessAstGrammar.whitespace }
    );
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(stylesheet(direct.value).children).toMatchObject([
      { type: 'VariableDeclaration', name: 'space', value: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }] },
      { type: 'VariableDeclaration', name: 'comma', value: { type: 'List', sep: ',' } },
      { type: 'VariableDeclaration', name: 'w' },
      { type: 'Rule', body: [{ type: 'Declaration', name: 'slash', value: { type: 'List', sep: '/' } }] }
    ]);
    expectExplicitListSeparators(direct.value);
  });

  it('constructs ordered $if / $else if / $else branches directly and renders only the selected branch', () => {
    const source = '$theme: "dark"; $if ($theme = "light") { .card { color: black; } } $else if ($theme = "dark") { .card { color: white; } } $else { .card { color: gray; } }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'theme' },
        {
          type: 'If',
          branches: [
            { guard: { g: 'cmp', op: '=' }, body: [{ type: 'Rule' }] },
            { guard: { g: 'cmp', op: '=' }, body: [{ type: 'Rule' }] },
            { guard: null, body: [{ type: 'Rule' }] }
          ]
        }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.card {\n  color: white;\n}\n');
  });

  it('constructs strict logical $if guard trees directly and evaluates their selected branch', () => {
    const source = '$enabled: true; $disabled: false; $if ((($enabled=true) and not($disabled)) or false) { .card { color: green; } } $else { .card { color: red; } }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
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
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.card {\n  color: green;\n}\n');
  });

  it('retains CST-admitted adjacent $if comparison operators through public parse and render', () => {
    const source = '$size: 6; $if ($size>5) { .card { color: green; } } $else { .card { color: red; } }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      children: [{ type: 'VariableDeclaration', name: 'size' }, {
        type: 'If', branches: [{ guard: { g: 'cmp', op: '>' } }, { guard: null }]
      }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.card {\n  color: green;\n}\n');
  });

  it('rejects mixin-only and ungrouped logical forms in direct $if conditions', () => {
    for (const source of [
      '$if ($a = true and $b = false) { color: red; }',
      '$if (true and false or true) { color: red; }',
      '$if (default()) { color: red; }',
      '$if ($type.iscolor(red)) { color: red; }',
      '$if (not true) { color: red; }'
    ]) {
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('publishes selected branch declarations into the containing live and scoped stores', () => {
    const source = '$tone: gray; $if (true) { $tone := blue; $$tone := navy; $if (true) { $nested: green; } } .after { live: $tone; scoped: $$tone; nested: $$nested; }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'tone', write: { mode: 'declare' } },
        {
          type: 'If',
          branches: [{
            body: [
              { type: 'VariableDeclaration', name: 'tone', write: { mode: 'reassign', lookup: 'live' } },
              { type: 'VariableDeclaration', name: 'tone', write: { mode: 'reassign', lookup: 'scoped' } },
              { type: 'If', branches: [{ body: [{ type: 'VariableDeclaration', name: 'nested', write: { mode: 'declare' } }] }] }
            ]
          }]
        },
        { type: 'Rule' }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.after {\n  live: blue;\n  scoped: navy;\n  nested: green;\n}\n'
    );
  });

  it('keeps unselected branch declarations isolated and publishes the selected else arm', () => {
    const source = '$tone: gray; $if (false) { $tone := red; $$tone := maroon; } $else { $tone := blue; $$tone := navy; } .after { live: $tone; scoped: $$tone; }';

    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.after {\n  live: blue;\n  scoped: navy;\n}\n'
    );
  });

  it('makes a selected $if mixin definition available only after its reached statement', () => {
    const source = '$if (true) { paint() { color: blue; } .after { $ > paint(); } }';

    expect(parse(source)).toMatchObject({
      children: [{
        type: 'If',
        branches: [{ body: [
          { type: 'MixinDef', name: 'paint' },
          { type: 'Rule', selector: { type: 'SelectorList' } }
        ] }]
      }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.after {\n  color: blue;\n}\n'
    );

    const beforeDefinition = '$if (true) { .before { $ > paint(); } paint() { color: blue; } }';
    expect(() => serialize(parse(beforeDefinition), { evaluator: buildEvaluator(makeBuiltinRegistry()) }))
      .toThrow(/Name not found/);
  });

  it('keeps false-arm mixins invisible and preserves A/$if(B)/C definition order', () => {
    const ordered = 'paint() { color: a; } $if (true) { paint() { color: b; } } paint() { color: c; } .after { $ > paint(); }';
    const falseArm = '$if (false) { paint() { color: wrong; } } .after { $ > paint(); }';

    expect(serialize(parse(ordered), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.after {\n  color: a;\n  color: b;\n  color: c;\n}\n'
    );
    expect(() => serialize(parse(falseArm), { evaluator: buildEvaluator(makeBuiltinRegistry()) }))
      .toThrow(/Name not found/);
  });

  it('keeps selected $if mixin definitions in their parameterized activation closure', () => {
    const source = 'outer($tone) { $if (true) { paint() { color: $tone; } } .inside { $ > paint(); } } .one { $ > outer(red); } .two { $ > outer(blue); }';

    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.one .inside {\n  color: red;\n}\n.two .inside {\n  color: blue;\n}\n'
    );

    const outsideActivation = `${source} .after { $ > paint(); }`;
    expect(() => serialize(parse(outsideActivation), { evaluator: buildEvaluator(makeBuiltinRegistry()) }))
      .toThrow(/Name not found/);
  });

  it('admits existing callable and loop statements inside selected direct $if bodies', () => {
    const source = 'paint() { color: red; } $held: { background: blue; }; $items: one, two; .host { $if (true) { $ > paint(); $held(); $apply paint; $for ($item of $items) { .item-$[item] { order: $item; } } } }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'MixinDef' },
        { type: 'VariableDeclaration' },
        { type: 'VariableDeclaration' },
        { type: 'Rule', body: [{ type: 'If', branches: [{ body: [
          { type: 'MixinCall', name: 'paint' },
          { type: 'Reference', base: { type: 'VariableReference', name: 'held', lookup: 'live' }, steps: [{ type: 'Call', args: [] }], raw: '$held()' },
          { type: 'Apply', selectors: [{ type: 'CompoundSelector' }] },
          { type: 'For', binding: { kind: 'single', name: 'item' } }
        ] }] }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.host {\n  color: red;\n  background: blue;\n}\n.host .item-one {\n  order: one;\n}\n.host .item-two {\n  order: two;\n}\n'
    );
  });

  it('does not execute any newly admitted statement form from a false $if arm', () => {
    const source = 'paint() { color: red; } $held: { background: blue; }; $items: one, two; .host { $if (false) { $ > paint(); $held(); $apply paint; $for ($item of $items) { .item-$[item] { order: $item; } } } }';
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('');
  });

  it('keeps imports held inside direct $if bodies', () => {
    for (const source of [
      '$if (true) { @-compose "./theme.jess"; }',
      '$if (true) { @-use "sass:math"; }'
    ]) {
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('constructs a first-class ruleset-only Apply fact and rejects dynamic targets', () => {
    const source = '$apply .rounded, #theme, button[data-x]:hover;';
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ children: [{
      type: 'Apply', selectors: [
        { type: 'CompoundSelector' },
        { type: 'CompoundSelector' },
        { type: 'CompoundSelector' }
      ]
    }] });
    for (const invalid of ['$apply $[.rounded];', '$apply .rounded-$[tone];', '$apply &;']) {
      const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null).toBe(false);
    }

    expect(serialize(parse('.rounded { border: solid; } .card { $apply .rounded; }')).css).toBe(
      '.rounded {\n  border: solid;\n}\n.card {\n  border: solid;\n}\n'
    );
  });

  it('keeps $apply first-class inside mixin and $for bodies', () => {
    const source = '.paint { color: red; } wrapper() { $apply .paint; } $items: one, two; .host { $ > wrapper(); $for ($item of $items) { $apply .paint; } }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'Rule' },
        { type: 'MixinDef', name: 'wrapper', body: [{ type: 'Apply', selectors: [{ type: 'CompoundSelector' }] }] },
        { type: 'VariableDeclaration', name: 'items' },
        { type: 'Rule', body: [{ type: 'MixinCall', name: 'wrapper' }, { type: 'For', rules: [{ type: 'Apply', selectors: [{ type: 'CompoundSelector' }] }] }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.paint {\n  color: red;\n}\n.host {\n  color: red;\n  color: red;\n  color: red;\n}\n'
    );
    expect(() => parse('wrapper() { $apply $[paint]; }')).toThrow(SyntaxError);
  });

  it('hoists rule-body static $extend targets while rejecting unrepresentable root and dynamic forms', () => {
    const source = '.target { color: red; } .source { $extend .target, .other !exact; }';
    const cst = parseJessCst(source);
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'Rule', selector: { type: 'SelectorList' } },
        {
          type: 'Rule', extendInstructions: [
            { target: { type: 'SelectorList' }, partial: false },
            { target: { type: 'SelectorList' }, partial: false }
          ]
        }
      ]
    });
    expect(serialize(parse('.target { color: red; } .source { $extend .target; }')).css).toBe(
      '.target,\n.source {\n  color: red;\n}\n'
    );

    for (const invalid of ['$extend .target;', '.source { $extend .target-$[tone]; }', '.source { $extend $type; }', '.source { $extend &; }']) {
      const direct = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, invalid).toBe(false);
    }
  });
  it('exposes the direct Stylesheet route as the package public parse API', () => {
    expect(parse('$tone: blue; .card { color: $tone; }')).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'tone' },
        { type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone' } }] }
      ]
    });
    expect(parse('.card:hover { color: blue; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
    });
  });

  it('constructs documented Jess member and index references as one typed value chain', () => {
    const source = '.card { member: $theme.colors.primary; last: $sizes[-1]; dynamic: $theme[$key]; }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'member', value: {
          type: 'Reference', base: { type: 'VariableReference', name: 'theme', lookup: 'live' },
          steps: [{ type: 'DotLookup', name: 'colors' }, { type: 'DotLookup', name: 'primary' }], raw: '$theme.colors.primary'
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
    expect(parse('.card { name: $[key]; }').children[0]).toMatchObject({
      type: 'Rule', body: [{ type: 'Declaration', value: { type: 'Interpolation' } }]
    });
  });

  it('lowers Jess live/scoped references and lookup-bearing writes directly', () => {
    const source = '$live: one; $$scoped: two; $live?: three; $$scoped?: four; $live := five; $$scoped := six; .card { live: $live; scoped: $$scoped; }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { name: 'live', write: { mode: 'declare' } },
        { name: 'scoped', write: { mode: 'declare' } },
        { name: 'live', write: { mode: 'if-absent', lookup: 'live' } },
        { name: 'scoped', write: { mode: 'if-absent', lookup: 'scoped' } },
        { name: 'live', write: { mode: 'reassign', lookup: 'live' } },
        { name: 'scoped', write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Rule', body: [
          { value: { type: 'VariableReference', name: 'live', lookup: 'live' } },
          { value: { type: 'VariableReference', name: 'scoped', lookup: 'scoped' } }
        ] }
      ]
    });
    expect(parse(source)).toMatchObject({
      children: [
        { write: { mode: 'declare' } }, { write: { mode: 'declare' } },
        { write: { mode: 'if-absent', lookup: 'live' } }, { write: { mode: 'if-absent', lookup: 'scoped' } },
        { write: { mode: 'reassign', lookup: 'live' } }, { write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Rule' }
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
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'double', value: { type: 'Quoted', src: '~"theme"', value: 'theme', quote: '"', escaped: true } },
        { type: 'Declaration', name: 'single', value: { type: 'Quoted', src: '~\'tone\'', value: 'tone', quote: '\'', escaped: true } }
      ] }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.asset {\n  double: theme;\n  single: tone;\n}\n'
    );

    // Escaped interpolation needs its own AST fact; this static reduction must not claim it.
    for (const invalid of ['.asset { value: ~"$[theme]"; }', '.asset { value: ~\'$(theme)\'; }']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps ordinary CSS declaration priority as a typed Declaration field', () => {
    for (const source of [
      '.card { color: red !IMPORTANT; }',
      '.card { color: red /* before */ ! /* between */ IMPORTANT /* after */; }',
      '.card { color: red // before marker\n !important; background: blue; }',
      '.card { color: red ! // between marker and name\n IMPORTANT; background: blue; }',
      '.card { color: red !important // after name\n; background: blue; }'
    ]) {
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok, source).toBe(true);
      expect(direct.unconsumedFrom, source).toBeNull();
      const document = parse(source);
      expect(document).toMatchObject({ type: 'Stylesheet', children: [{ type: 'Rule' }] });
      const rule = document.children[0];
      if (rule?.type !== 'Rule') {
        throw new Error('expected a rule containing the important declaration');
      }
      expect(rule.body[0]).toMatchObject(
        { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' }, important: true }
      );
      expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toContain(
        '  color: red !important;\n'
      );
    }

    for (const source of [
      '.outer { .inner { color: red // before marker\n !important // after priority\n; background: blue; } }',
      '@media screen { color: red // before marker\n !important // after priority\n; background: blue; }'
    ]) {
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok, source).toBe(true);
      expect(direct.unconsumedFrom, source).toBeNull();
      expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css, source).toContain(
        'color: red !important;\n'
      );
    }

    for (const source of [
      '.card { color: red !; }',
      '.card { color: red !important-extra; }',
      '.card { color: red !important blue; }',
      // A `//` comment owns the rest of its line, including a same-line `;`.
      // The priority must therefore end on a following line before its terminator.
      '.card { color: red !important // consumes terminator; }'
    ]) {
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs documented unwrapped variable-led arithmetic directly, while keeping slash a structured value boundary', () => {
    const source = '$w: 2px; $h: 3; .card { plus: $w + 1px; product: $w * 2 + $h; signed: $w -1; slash: $w / 2; wrapped: $($w / 2); }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'w' },
        { type: 'VariableDeclaration', name: 'h' },
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'plus', value: { type: 'Operation', operator: '+', left: { type: 'VariableReference', name: 'w' }, right: { type: 'Dimension', src: '1px' } } },
          { type: 'Declaration', name: 'product', value: { type: 'Operation', operator: '+', left: { type: 'Operation', operator: '*' }, right: { type: 'VariableReference', name: 'h' } } },
          { type: 'Declaration', name: 'signed', value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '-1' }] },
          { type: 'Declaration', name: 'slash', value: { type: 'List', sep: '/', value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '2' }] } },
          { type: 'Declaration', name: 'wrapped', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '/' } }, unquote: true }] } }
        ] }
      ]
    });
    expect(parse(source)).toMatchObject({
      children: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'Rule', body: [
        { value: { type: 'Operation', operator: '+' } },
        { value: { type: 'Operation', operator: '+' } },
        { value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '-1' }] },
        { value: { type: 'List', sep: '/' } },
        { value: { type: 'Interpolation' } }
      ] }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  plus: 3px;\n  product: 7px;\n  signed: 2px -1;\n  slash: 2px / 2;\n  wrapped: 1px;\n}\n'
    );
    // Standalone operators are syntax, not a later string heuristic. The
    // right-side product binds first; glued signs remain ordinary value items.
    expect(parse('$w: 2; .card { precedence: $w + 1 * 2; glued-plus: $w +1; }')).toMatchObject({
      children: [
        { type: 'VariableDeclaration' },
        { type: 'Rule', body: [
          { name: 'precedence', value: { type: 'Operation', operator: '+', right: { type: 'Operation', operator: '*' } } },
          { name: 'glued-plus', value: [{ type: 'VariableReference', name: 'w' }, { type: 'Dimension', src: '+1' }] }
        ] }
      ]
    });
    for (const invalid of ['$w: 2px; .card { x: $w / 2 + 1; }', '$w: 2px; .card { x: $w % 2; }']) {
      const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('parses a static selector list between *[…] delimiters and rejects dynamic selector content', () => {
    const source = '$targets: *[.notice, main > .card:not(.muted, .disabled):nth-child(2n+1 of .item), .tail:nth-child(-n+2)];';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(hasCstGrammar(cst.tree, 'SelectorCapture')).toBe(true);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
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
      children: [{ value: { type: 'SelectorCapture', branches: ['.notice', 'main > .card:not(.muted, .disabled):nth-child(2n+1 of .item)', '.tail:nth-child(-n+2)'] } }]
    });

    for (const invalid of ['$targets: * [.notice];', '$targets: *[$[selector]];', '$targets: *[.card-$[tone]];', '$targets: *[.card:not($[tone])];', '$targets: *[.card:nth-child(2n+1of .item)];']) {
      const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
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
      const captured = run(jessAstGrammar.DirectJessStaticSelector, source, { trivia: jessAstGrammar.whitespace });
      const ordinary = run(jessAstGrammar.DirectJessSelector, source, { trivia: jessAstGrammar.whitespace });
      expect(captured.ok && captured.unconsumedFrom === null, source).toBe(true);
      expect(ordinary.ok && ordinary.unconsumedFrom === null, source).toBe(true);
      expect(captured.value).toEqual(ordinary.value);
    }
  });

  it('retains whitelisted selector-function pseudo arguments as structure, not baked text', () => {
    const secondSimple = (source: string): SimpleToken => {
      const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      const rule = stylesheet(result.value).children.find((child): child is Rule => isRecord(child) && child.type === 'Rule');
      expect(rule, source).toBeDefined();
      return rule!.selector.selectors[0]!.head.simples[1]!;
    };

    // `:is` keeps the parsed `SelectorList` as `args` (structure), forces `text`
    // to null (core serialization owns the join), and is crossable.
    const isPseudo = secondSimple('.x:is(.a, .b) { c: d; }');
    expect(isPseudo).toMatchObject({
      type: 'PseudoSelector',
      name: ':is',
      text: null,
      crossable: true,
      args: { type: 'SelectorList', selectors: [{ head: {} }, { head: {} }] }
    });

    // Parser stores STRUCTURE only: the inner complex `_canon` memo is never
    // populated at parse (the earlier baked-text approach set it eagerly).
    expect(isPseudo.type).toBe('PseudoSelector');
    if (isPseudo.type === 'PseudoSelector') {
      expect(isPseudo.args).not.toBeNull();
      for (const complex of isPseudo.args!.selectors) {
        expect(complex._canon).toBeUndefined();
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

    // Core owns the inline `:is(a, b)` join, so authored spacing is normalized
    // identically whether or not the source had a space after the comma.
    for (const source of ['.x:is(.a,.b) { c: d; }', '.x:is(.a, .b) { c: d; }']) {
      const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(serialize(stylesheet(result.value)).css).toBe('.x:is(.a, .b) {\n  c: d;\n}\n');
    }

    // An `$[…]`-interpolated pseudo argument is NOT a static `SelectorList`, so it
    // never reaches the structured path: it stays opaque exactly as before (the
    // Jess selector chain has no typed interpolation for pseudo args yet, so the
    // rule does not fully parse).
    for (const interpolated of ['.x:not(.a-$[t]) { c: d; }', '.x:is(.card-$[t]) { c: d; }']) {
      const rejected = run(jessAstGrammar.JessAstDocument, interpolated, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, interpolated).toBe(false);
    }
  });

  it('rejects paren-less nth pseudo names at the identifier boundary (cross-dialect divergence unification)', () => {
    // A bare, paren-less nth name is not a keyword pseudo — it must reach the
    // structured nth arms with an immediate `(` or be rejected, matching Less's
    // identifier-boundary guard (design §7). Jess is already selector-only for
    // `:not`, so `:not(2n+1)` already rejects; this closes the remaining bare-nth
    // divergence with css/less.
    for (const source of [
      '.x:nth-child { color: red; }',
      '.x:nth-of-type { color: red; }',
      '.x:nth-last-child { color: red; }',
      '.x:nth-last-of-type { color: red; }',
      '.x:not(2n+1) { color: red; }'
    ]) {
      const rejected = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, source).toBe(false);
    }

    for (const source of [
      '.x:nth-child(2n+1) { color: red; }',
      '.x:nth-of-type(2n) { color: red; }',
      '.x:not(.a) { color: red; }',
      '.x:is(.a, .b) { color: red; }',
      '.x:lang(en) { color: red; }'
    ]) {
      const accepted = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(accepted.ok && accepted.unconsumedFrom === null, source).toBe(true);
    }
  });

  it('accepts An+B and selector pseudo whitespace as valid CSS, normalizing surrounding argument space', () => {
    // Valid CSS is valid .jess: Selectors-4 §6.6.2 permits OPTIONAL whitespace
    // around the `+`/`-` sign, and CSS permits insignificant whitespace
    // surrounding any functional pseudo's argument inside the parens
    // (https://www.w3.org/TR/selectors-4/#anb-microsyntax). Sign whitespace is
    // preserved verbatim; surrounding paren whitespace is normalized away exactly
    // as the canonical CSS grammar and the other dialects do.
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
    // `of S` is defined ONLY for `:nth-child()`/`:nth-last-child()`; the
    // type-index families take a bare `<An+B>`. Mirroring the CSS reference, the
    // nth name now dispatches child vs of-type, so an `of` tail on the of-type
    // families fails to parse rather than being captured as opaque selector text.
    for (const invalid of [
      'a:nth-of-type(2n of .a) { color: red; }',
      'a:nth-of-type(n of .a) { color: red; }',
      'a:nth-last-of-type(-n+3 of .a) { color: red; }',
      'a:nth-last-of-type(even of .a) { color: red; }'
    ]) {
      const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
    // `of S` on the child index and a bare `<An+B>` on the of-type index stay
    // accepted, serialized byte-identically to the authored argument.
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
      children: [
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
    for (const invalid of ['@-compose $[path];', '@-use "./x.ts" as **;', '@-from "./x.ts" import *;', '@-from "./x.ts" import foo, bar;']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('constructs static CSS at-rule facts directly, including nested documented media blocks', () => {
    const staticQuery = run(jessAstGrammar.DirectJessStaticAtQuery, '(min-width: 48rem)', { trivia: jessAstGrammar.whitespace });
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
      const staticResult = run(jessAstGrammar.JessAstDocument, staticSource, { trivia: jessAstGrammar.whitespace });
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
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(hasCstGrammar(cst.tree, 'QueryAtRuleBlock')).toBe(true);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'AtRuleStatement', name: '@charset', prelude: { type: 'Quoted', value: 'UTF-8' } },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'Quoted', value: 'theme.css' } },
        {
          type: 'Rule',
          body: [
            { type: 'Declaration', name: 'padding' },
            {
              type: 'AtRuleBlock', name: '@media',
              prelude: { type: 'List', sep: ',' },
              body: [
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
    const compilerBeforeLiteralDirect = run(jessAstGrammar.JessAstDocument, compilerBeforeLiteral, { trivia: jessAstGrammar.whitespace });
    expect(compilerBeforeLiteralDirect.ok).toBe(true);
    expect(compilerBeforeLiteralDirect.unconsumedFrom).toBeNull();
    expect(parse(compilerBeforeLiteral)).toMatchObject({
      children: [
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
      const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
    expect(parse('.card { color: blue; } @-import "legacy.less";')).toMatchObject({
      children: [{ type: 'Rule' }, { type: 'StyleImport', mode: 'import', path: { value: 'legacy.less' } }]
    });
  });

  it('constructs static unknown CSS blocks as terminal opaque grammar facts', () => {
    const source = '@vendor-rule screen /* header */ {\n  raw: fn("}", nested({ value: 1; }));\n  // } stays in the raw body\n  @nested { value: "{ }"; }\n}';
    const document = parse(source);

    expect(document.children[0]).toMatchObject({
      type: 'OpaqueAtRuleBlock',
      name: '@vendor-rule',
      prelude: 'screen /* header */',
      rawBody: '\n  raw: fn("}", nested({ value: 1; }));\n  // } stays in the raw body\n  @nested { value: "{ }"; }\n'
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(`${source}\n`);

    for (const invalid of [
      '@vendor-rule $[name] { raw: 1; }',
      '@vendor-rule $(name) { raw: 1; }',
      '@media { .card { color: red; } }',
      '@-future raw { value: 1; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps a lone Jess expression as a typed dynamic @media prelude', () => {
    const source = '$type: screen; @media $(type) { .card { color: red; } }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
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
      '$type: screen; @media $(type) screen { .card { color: red; } }',
      '$type: screen; @media $($type) { .card { color: red; } }',
      '$type: screen; @media $(type);',
      '$type: screen; @container $(type) { .card { color: red; } }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('uses `only` only before a static media type', () => {
    expect(parse('@media only screen and (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' } }]
    });
    const invalid = '@media only (min-width: 1px) { .card { color: red; } }';
    const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
    expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
    expect(() => parse('@container only screen { .card { color: red; } }')).toThrow(SyntaxError);
    expect(parse('@media not (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@media' }]
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
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
      expect(parse(source).children[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: source.startsWith('@media')
          ? { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator } }
          : { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'sidebar' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator } }] }
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
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
      expect(parse(source).children[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator, right: ratio } }
      });
    }

    expect(parse('@media (16/9 < aspect-ratio < 2/1) { .card { color: blue; } }').children[0]).toMatchObject({
      type: 'AtRuleBlock',
      prelude: { type: 'Block', delimiter: 'paren', inner: {
        type: 'Operation', operator: '<',
        left: { type: 'Operation', operator: '<', left: ratio, right: { type: 'Keyword', src: 'aspect-ratio' } },
        right: { type: 'Operation', operator: '/', left: { type: 'Dimension', src: '2' }, right: { type: 'Dimension', src: '1' } }
      } }
    });

    expect(serialize(parse('@media (aspect-ratio: 16/9) { .card { color: blue; } }'))).toEqual({
      css: '@media (aspect-ratio: 16 / 9) {\n  .card {\n    color: blue;\n  }\n}\n'
    });

    // A single `<number>` is a whole ratio, so the slash tail stays optional.
    expect(parse('@media (aspect-ratio: 1) { .card { color: blue; } }').children[0]).toMatchObject({
      prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', right: { type: 'Dimension', src: '1' } } }
    });
  });

  it('constructs static URL-bearing CSS at-rule preludes without widening generic headers', () => {
    const source = '@namespace svg url("http://www.w3.org/2000/svg"); @document url(site.css) { .icon { color: blue; } }';
    const root = parse(source);

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'AtRuleStatement', name: '@namespace', prelude: { type: 'SpacedValue', parts: [
          { type: 'Keyword', src: 'svg' }, { type: 'Url', value: { type: 'Quoted', value: 'http://www.w3.org/2000/svg' } }
        ] } },
        { type: 'AtRuleBlock', name: '@document', prelude: { type: 'Url', value: { type: 'Any', src: 'site.css' } }, body: [{ type: 'Rule' }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
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
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' },
        body: [{ type: 'Declaration', name: 'syntax' }, { type: 'Declaration', name: 'inherits' }, { type: 'Declaration', name: 'initial-value' }]
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

    expect(root.children).toMatchObject([
      {
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--offset' },
        body: [{ type: 'Declaration', name: 'syntax' }, { type: 'Declaration', name: 'inherits' }, {
          type: 'Declaration', name: 'initial-value', value: [{ type: 'Dimension', src: '1px' }, { type: 'Dimension', src: '2px' }]
        }]
      },
      {
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' },
        body: [{ type: 'Declaration', name: 'syntax', value: { type: 'Quoted', escaped: false } }, { type: 'Declaration', name: 'inherits' }, {
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
      '@property --accent { syntax: "<color>"; initial-value: var(--theme); }',
      '@property --accent { syntax: "<color>"; initial-value: var (--theme); }',
      '@property --accent { syntax: "<color>"; initial-value: env(theme); }',
      '@property --accent { syntax: "<color>"; initial-value: $(rgb)(1 2 3); }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('retains Jess @supports general-enclosed bodies as structural interpolation templates', () => {
    const source = '@supports selector(.card-$[tone]:has([data-x="$[state]"])) { .card { color: blue; } }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet', children: [{
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

  it('constructs typed static @supports conditions without a generic at-rule or raw-function fallback', () => {
    const source = '@supports not ((display: grid) and (color)) { .card { color: blue; } }';
    const root = parse(source);

    expect(root.children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      prelude: {
        type: 'SpacedValue',
        parts: [
          { type: 'Keyword', src: 'not' },
          { type: 'Block', delimiter: 'paren', inner: { type: 'SpacedValue' } }
        ]
      },
      body: [{ type: 'Rule' }]
    });
    expect(parse('@supports (display: grid) or (width: 1px) { .card { color: blue; } }').children[0]).toMatchObject({
      type: 'AtRuleBlock',
      prelude: { type: 'SpacedValue', parts: [{ type: 'Block', delimiter: 'paren' }, { type: 'Keyword', src: 'or' }, { type: 'Block', delimiter: 'paren' }] }
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
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
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'AtRuleBlock', name: '@KEYFRAMES', prelude: { type: 'Keyword', src: 'fade' },
          body: [{ type: 'Rule', selector: { type: 'SelectorList', selectors: [{ head: { simples: [{ text: 'from' }] } }, { head: { simples: [{ text: '50%' }] } }] } }, { type: 'Rule' }]
        },
        { type: 'AtRuleBlock', name: '@-MOZ-KEYFRAMES', prelude: { type: 'Quoted', value: 'zoom' }, body: [{ type: 'Rule' }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
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

  it('preserves public Jess line and block comments as canonical statements', () => {
    const source = '// root\n$theme: blue; /* between */ .card { // inside\n color: $theme; /* tail */ }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Comment', text: '// root' },
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'Comment', text: '/* between */' },
        {
          type: 'Rule',
          body: [
            { type: 'Comment', text: '// inside' },
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'theme' } },
            { type: 'Comment', text: '/* tail */' }
          ]
        }
      ]
    });
  });

  it('constructs declarations, static rules, quoted, keyword, numeric, color, call, and variable-reference facts directly', () => {
    const source = '$base: "dark";\n$tone: $base;\n$accent: blue;\n$hex: #0a1B2c;\n$gap: -1.5e2rem;\n$ratio: .5;\n$percent: 50%;\n$shade: rgb(0, 10%, mix(blue, $percent));\n.card { color: $tone; margin: 1rem; filter: blur(2px); }';
    const legacy = parseJessCst(source);
    const result = run(
      jessAstGrammar.JessAstDocument,
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
      children: [
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
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card', interp: null }] }, tail: [] }]
          },
          body: [
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
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'quoted', value: { type: 'Url', value: { type: 'Quoted', value: 'images/icon.svg' } } },
        { type: 'Declaration', name: 'raw', value: { type: 'Url', value: { type: 'Any', src: 'images/icon.svg' } } },
        { type: 'Declaration', name: 'empty', value: { type: 'Url', value: { type: 'Any', src: '' } } }
      ] }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.asset {\n  quoted: url("images/icon.svg");\n  raw: url(images/icon.svg);\n  empty: url();\n}\n'
    );
  });

  it('constructs modern CSS slash-separated function components while retaining existing variable-led call expressions', () => {
    const source = '.card { box-shadow: rgb(15 23 42 / 0.22); }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [{
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

    const variableCall = parse('$channel: 15; .card { color: rgb($channel + 8 23 42 / 0.22); }');
    expect(variableCall.children[1]).toMatchObject({
      type: 'Rule', body: [{
        type: 'Declaration', value: {
          type: 'FunctionCall', args: [{
            type: 'List', sep: '/', value: [[{ type: 'Operation', operator: '+', left: { type: 'VariableReference', name: 'channel' }, right: { type: 'Dimension', src: '8' } }, { type: 'Dimension', src: '23' }, { type: 'Dimension', src: '42' }], { type: 'Dimension', src: '0.22' }]
          }]
        }
      }]
    });

    for (const invalid of [
      '.card { color: rgb(/ 0.22); }',
      '.card { color: rgb(15 23 42 /); }',
      '.card { color: rgb(15 23 42 / 0.22 / 1); }'
    ]) {
      const legacy = parseJessCst(invalid);
      const rejected = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
      expect(legacy.errors, invalid).toHaveLength(0);
      expect(legacy.unconsumedFrom, invalid).toBeNull();
      expect(rejected.ok && rejected.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('constructs structured Jess interpolation in ordinary and CSS-import url targets', () => {
    const source = '$path: "images/icon.svg"; $file: "hero"; @import url($[path]) print; @import url(styles/$[file].css); .asset { direct: url($[path]); joined: url(images/$[file].svg); quoted: url("assets/$[file].svg"); }';
    const cst = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'path' },
        { type: 'VariableDeclaration', name: 'file' },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'SpacedValue', parts: [{ type: 'Url', value: { type: 'Interpolation' } }, { type: 'Keyword', src: 'print' }] } },
        { type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: 'styles/' }, { ref: { type: 'VariableReference', name: 'file' }, unquote: true }, { lit: '.css' }] } } },
        { type: 'Rule', body: [
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
      void serialize(parse('@import url($[path]); $path: "images/icon.svg";'));
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
      children: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { type: 'Any', src: '' } } }]
    });
  });

  it('constructs and evaluates a live dynamic variable name without changing existing bracket interpolation', () => {
    const source = '$name: color; $color: navy; $color := blue; .card { dynamic: $[$name]; existing: $[color]; color: red; property: $[color]; }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    const publicDocument = parse(source);
    expect(publicDocument.children[2]).toMatchObject({
      type: 'VariableDeclaration', name: 'color', write: { mode: 'reassign', lookup: 'live' }
    });
    const publicRule = publicDocument.children[3];
    expect(publicRule).toMatchObject({ type: 'Rule' });
    if (publicRule?.type !== 'Rule') {
      throw new TypeError('Expected the dynamic-reference rule.');
    }
    expect(publicRule.body[0]).toMatchObject({
      type: 'Declaration', name: 'dynamic', value: { type: 'Interpolation', parts: [{ ref: { type: 'VarIndirect', lookup: 'live', nameRef: { type: 'VariableReference', name: 'name', lookup: 'live' } }, unquote: true }] }
    });
    expect(publicRule.body[1]).toMatchObject({
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
    // A url body is a value position (like a quote interior), so the $(…)
    // arithmetic/expression form is admitted there alongside the $[…] accessor —
    // unlike identifier-like slots (selectors, property names) which stay accessor-only.
    for (const source of ['.asset { image: url($(path)); }', '@import url($(path));']) {
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(true);
    }
    const rule = parse('.asset { image: url($(path)); }').children[0];
    expect(rule).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'Declaration', name: 'image',
        value: { type: 'Url', value: { type: 'Interpolation', parts: [
          { ref: { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'path' } }, unquote: true }
        ] } }
      }]
    });
  });

  it('constructs public static selector lists, compounds, combinators, and nested rules directly', () => {
    const source = '.card:hover > .title.active, #hero + button::before { color: blue; .icon ~ .label { color: red; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            {
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card' }, { type: 'SimpleSelector', text: ':hover' }] },
              tail: [{ comb: '>', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.title' }, { type: 'SimpleSelector', text: '.active' }] } }]
            },
            {
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '#hero' }] },
              tail: [{ comb: '+', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'button' }, { type: 'SimpleSelector', text: '::before' }] } }]
            }
          ]
        },
        body: [
          { type: 'Declaration', name: 'color' },
          {
            type: 'Rule',
            selector: {
              type: 'SelectorList',
              selectors: [{
                type: 'ComplexSelector',
                head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.icon' }] },
                tail: [{ comb: '~', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.label' }] } }]
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
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '[role]' }] } },
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '[data-kind="primary"i]' }] } },
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '[lang|=en]' }] } }
          ]
        }
      }]
    });
  });

  it('keeps selector forms without a faithful direct template reduction out of the route', () => {
    // A bare parent selector has no valid document-level production route, but
    // Jess accepts it inside a rule. This direct selector route owns ordinary
    // nested rules; parent-selector templates stay out until they have a
    // dedicated semantic reduction rather than being treated as static text.
    const nestedParent = '.parent { & { color: blue; } }';
    const legacy = parseJessCst(nestedParent);
    const direct = run(jessAstGrammar.JessAstDocument, nestedParent, { trivia: jessAstGrammar.whitespace });
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value)).toBe(false);
  });

  it('constructs public $[…] selector templates as Interp-backed SimpleSelector atoms', () => {
    const source = '$side: left; .widget-$[side]-$["tone"] { tone: dark; color: blue; }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'side' },
        {
          type: 'Rule',
          selector: {
            selectors: [{
              head: {
                simples: [{
                  type: 'SimpleSelector', text: null,
                  interp: {
                    type: 'Interpolation',
                    parts: [
                      { lit: '.widget-' },
                      { ref: { type: 'VariableReference', name: 'side' }, unquote: true },
                      { lit: '-' },
                      { ref: { type: 'PropertyReference', name: 'tone', raw: '$["tone"]' }, unquote: true }
                    ]
                  }
                }]
              }
            }]
          }
        }
      ]
    });
  });

  it('evaluates parsed bare and quoted selector templates in their nesting scope', () => {
    const document = parse('$side: left; .shell { tone: dark; .widget-$[side]-$["tone"] { color: blue; } }');

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
    const parsed = parse('$side: bare; .scope { tone: quoted; .target { color: blue; } .bare-$[side] {} .quoted-$["tone"] {} }');
    const scope = parsed.children[1];
    if (scope?.type !== 'Rule') {
      throw new TypeError('Expected parsed scope rule.');
    }
    const target = scope.body[1];
    const bare = scope.body[2];
    const quoted = scope.body[3];
    if (target?.type !== 'Rule' || bare?.type !== 'Rule' || quoted?.type !== 'Rule') {
      throw new TypeError('Expected parsed nested rules.');
    }
    const extend = (candidate: Rule): Rule => ({
      ...candidate,
      extendInstructions: [{ target: target.selector, partial: true }]
    });
    const document: Stylesheet = {
      ...parsed,
      children: [
        parsed.children[0]!,
        { ...scope, body: [scope.body[0]!, target, extend(bare), extend(quoted)] }
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
    const source = '$tone: blue; $gap: 2px; $key: $[tone]; $quoted-key: $["theme"]; $math: $(1 + 2 * $gap); $compare: $(1  +  2 = 3); $quoted-compare: $("a-$[tone]" = foo); .card { content: "tone-$[tone]-$(1 + 2)"; color: rgb($[tone], $(1 + 2), blue); }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'tone' },
        { type: 'VariableDeclaration', name: 'gap' },
        { type: 'VariableDeclaration', name: 'key', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'tone' }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'quoted-key', value: { type: 'Interpolation', parts: [{ ref: { type: 'PropertyReference', name: 'theme', raw: '$["theme"]' }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'math', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '+' } }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'compare', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', inner: { type: 'Condition', guard: { g: 'cmp', op: '=' }, src: '1  +  2 = 3' } }, unquote: true }] } },
        { type: 'VariableDeclaration', name: 'quoted-compare', value: { type: 'Interpolation', parts: [{ ref: { type: 'Block', delimiter: 'paren', inner: { type: 'Condition', guard: { g: 'cmp', op: '=' }, src: '"a-$[tone]" = foo' } }, unquote: true }] } },
        { type: 'Rule', body: [{ type: 'Declaration', name: 'content', value: { type: 'Interpolation' } }, { type: 'Declaration', name: 'color', value: { type: 'FunctionCall', args: [{ type: 'Interpolation' }, { type: 'Interpolation' }, { type: 'Keyword', src: 'blue' }] } }] }
      ]
    });
  });

  it('keeps bare and quoted key interpolation as distinct direct-AST lookups through render', () => {
    const document = parse('$tone: teal; .card { color: blue; bare: $[tone]; quoted: $["color"]; }');

    expect(document).toMatchObject({
      children: [
        { type: 'VariableDeclaration', name: 'tone' },
        {
          type: 'Rule',
          body: [
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
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        {
          type: 'For',
          binding: { kind: 'single', name: 'item' },
          iterable: { type: 'VariableReference', name: 'items', lookup: 'live' },
          rules: [{
            type: 'Rule',
            selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.single', interp: null }] }, tail: [] }] },
            body: [{ type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'item', lookup: 'live' }, merge: null, important: false }]
          }]
        },
        {
          type: 'For',
          binding: { kind: 'comma', names: ['item', 'key', 'counter'] },
          iterable: { type: 'VariableReference', name: 'items', lookup: 'live' },
          rules: [{
            type: 'Rule',
            selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.comma', interp: null }] }, tail: [] }] },
            body: [
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
            type: 'Rule',
            selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.bracket', interp: null }] }, tail: [] }] },
            body: [
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
    const result = run(jessAstGrammar.DirectJessFor, source, { trivia: jessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'For',
      binding: { kind: 'single', name: 'item' },
      iterable: { type: 'VariableReference', name: 'items', lookup: 'live' },
      rules: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'value' }] }]
    });
  });

  it('constructs typed Jess $for ranges, including an exclusive end', () => {
    const source = '$for ($i of 1 to 3) { .inclusive { value: $i; } }\n$for ($i of 1 to <3) { .exclusive { value: $i; } }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
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
    const listDocument = parse('$sections: header, sidebar, footer; $for ($section, $i of $sections) { .box-$[section] { padding-left: $($i * 20px); } }');
    expect(serialize(listDocument, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.box-header {\n  padding-left: 20px;\n}\n.box-sidebar {\n  padding-left: 40px;\n}\n.box-footer {\n  padding-left: 60px;\n}\n'
    );

    const rangeDocument = parse('$for ($i of 1 to <3) { .box-$[i] { value: $i; } }');
    expect(serialize(rangeDocument, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.box-1 {\n  value: 1;\n}\n.box-2 {\n  value: 2;\n}\n'
    );
  });

  it('constructs a documented Jess collection RHS for public bracket $for rendering', () => {
    const source = '$collection: { header: red; footer: blue; }; $for ([$key, $value] of $collection) { .box-$[key] { color: $value; } }';
    const legacy = parseJessCst(source);
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(parse(source)).toEqual(direct.value);
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'VariableDeclaration',
          name: 'collection',
          value: {
            type: 'Collection',
            entries: [
              { type: 'Declaration', name: 'header', value: { type: 'Keyword', src: 'red' } },
              { type: 'Declaration', name: 'footer', value: { type: 'Keyword', src: 'blue' } }
            ]
          }
        },
        { type: 'For', binding: { kind: 'bracket', names: ['key', 'value'] } }
      ]
    });
    expect(serialize(parse(source)).css).toBe(
      '.box-header {\n  color: red;\n}\n.box-footer {\n  color: blue;\n}\n'
    );
  });

  it('preserves public variable range bounds, exclusions, steps, and descending order as typed Range fields', () => {
    const source = '$start: 9; $end: 1; $step: 2; $for ($i of >$start to <$end step $step) { .item { value: $i; } }';
    const legacy = parseJessCst(source);
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
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
    const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        {
          type: 'MixinDef', name: 'button-base',
          params: [
            { name: 'bg', default: { type: 'Color', src: '#1a73e8' } },
            { name: 'pad', default: { type: 'Dimension', number: 1, unit: 'rem', src: '1rem' } }
          ],
          body: [
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'bg', lookup: 'live' }, merge: null, important: false },
            { type: 'Declaration', name: 'padding', value: { type: 'VariableReference', name: 'pad', lookup: 'live' }, merge: null, important: false }
          ]
        },
        {
          type: 'MixinDef', name: '#ns', params: [], body: [
            { type: 'MixinDef', name: '.inner', params: [], body: [
              { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' }, merge: null, important: false }
            ] }
          ]
        },
        {
          type: 'Rule',
          selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.button', interp: null }] }, tail: [] }] },
          body: [
            { type: 'MixinCall', name: 'button-base', args: [], path: [], important: false },
            { type: 'MixinCall', name: '.inner', args: [], path: [{ comb: '>', sel: '#ns' }], important: false }
          ]
        }
      ]
    });
  });

  it('constructs named Jess mixin arguments as canonical CallArg facts and evaluates defaults', () => {
    const source = 'button-base($bg: #1a73e8, $pad: 1rem) { color: $bg; padding: $pad; } .button { $ > button-base($pad: 0.25rem); }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'MixinDef' }, {
        type: 'Rule', body: [{
          type: 'MixinCall', name: 'button-base', args: [{
            name: 'pad', value: { type: 'Dimension', number: 0.25, unit: 'rem', src: '0.25rem' }
          }]
        }]
      }]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.button {\n  color: #1a73e8;\n  padding: 0.25rem;\n}\n');
  });

  it('keeps named mixin arguments source-ordered and variable-valued arguments positional', () => {
    const source = '.button { $ > button-base($pad: 2px, $bg: red); $ > button-base($tone); }';
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({ children: [{
      type: 'Rule', body: [
        { type: 'MixinCall', args: [
          { name: 'pad', value: { type: 'Dimension', number: 2, unit: 'px' } },
          { name: 'bg', value: { type: 'Keyword', src: 'red' } }
        ] },
        { type: 'MixinCall', args: [{ value: { type: 'VariableReference', name: 'tone', lookup: 'live' } }] }
      ]
    }] });
  });

  it('constructs zero-argument variable-held callable statements as final Reference calls', () => {
    const source = '$my-mixin: { color: red; }; .box { $my-mixin(); }';
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'my-mixin', value: { type: 'Collection' } },
        { type: 'Rule', body: [{ type: 'Reference', base: { type: 'VariableReference', name: 'my-mixin', lookup: 'live' }, steps: [{ type: 'Call', args: [] }], raw: '$my-mixin()' }] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.box {\n  color: red;\n}\n'
    );
    expect(() => parse('.box { $my-mixin(red); }')).toThrow(SyntaxError);
  });

  it('constructs static Jess mixin guards directly, retains the CST guard route, and exposes them through public parse', () => {
    const source = 'match($value) when (($value = true) and not(false)) { color: red; } fallback($value) when (default()) { color: blue; } either() when (false or true) { color: green; } numeric($value) when ($type.isnumber($value)) { color: purple; } unit($value) when ($type.isunit($value, px)) { color: orange; } .yes { $ > match(true); } .no { $ > fallback(false); } .or { $ > either(); } .number { $ > numeric(2px); } .word { $ > numeric(word); } .unit { $ > unit(3px); }';
    const cst = parseJessCst('match($value) when ($value = true) {}');
    const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(hasCstGrammar(cst.tree, 'Mixin')).toBe(true);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({ type: 'Stylesheet' });
    expect(stylesheet(direct.value).children.slice(0, 5)).toMatchObject([
      {
        type: 'MixinDef', name: 'match',
        guard: {
          g: 'and',
          left: { g: 'cmp', op: '=' },
          right: { g: 'not', inner: { g: 'truth' } }
        }
      },
      { type: 'MixinDef', name: 'fallback', guard: { g: 'default' } },
      { type: 'MixinDef', name: 'either', guard: { g: 'or', left: { g: 'truth' }, right: { g: 'truth' } } },
      { type: 'MixinDef', name: 'numeric', guard: { g: 'call', name: 'isnumber', args: [{ type: 'VariableReference', name: 'value' }] } },
      { type: 'MixinDef', name: 'unit', guard: { g: 'call', name: 'isunit', args: [{ type: 'VariableReference', name: 'value' }, { type: 'Keyword', src: 'px' }] } }
    ]);
    expect(parse(source)).toEqual(direct.value);
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.yes {\n  color: red;\n}\n.no {\n  color: blue;\n}\n.or {\n  color: green;\n}\n.number {\n  color: purple;\n}\n.unit {\n  color: orange;\n}\n'
    );

    for (const invalid of [
      'm($value) when ($value = true and $value = false) {}',
      'm() when ((true) and (false) or (true)) {}',
      'm() when (default(1)) {}',
      'm($value) when ($type.unknown($value)) {}',
      'm($value) when ($type.isnumber()) {}',
      'm($value) when ($type.isnumber($value, px)) {}',
      'm($value) when ($type.isunit($value, px, extra)) {}'
    ]) {
      const directInvalid = run(jessAstGrammar.JessAstDocument, invalid, { trivia: jessAstGrammar.whitespace });
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
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
  });

  it('matches public rejection of malformed Jess interpolation without a text fallback', () => {
    for (const source of ['$key: $[];', '$key: $[tone;', '$key: $ [tone];', '$key: $[ tone];', '$key: $[tone ];', '$key: $(1 + );', '$key: "tone-$[tone";']) {
      const legacy = parseJessCst(source);
      const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(legacy.errors.length + Number(legacy.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs documented $[…] declaration-name interpolation through public parse', () => {
    const source = '$radius: top-right; $property: accent; .card { border-$[radius]-radius: 12px; $[property]: blue; }';
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'radius' },
        { type: 'VariableDeclaration', name: 'property' },
        { type: 'Rule', body: [
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'border-' }, { ref: { type: 'VariableReference', name: 'radius', lookup: 'live' }, unquote: true }, { lit: '-radius' }] } },
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'property', lookup: 'live' }, unquote: true }] } }
        ] }
      ]
    });
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
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

  it('does not widen the closed direct declaration/value subset', () => {
    for (const source of [
      'color: red;',
      '$tone: red',
      '$tone: $;',
      '$tone: 17px-1px;',
      '$\\66 oo: blue;',
      '$tone: rgb(1,);',
      '$tone: #12345;',
      '$tone: #123456789;',
      '.card { color: blue }',
      // `--` alone is reserved by css-variables-1 §2, so it is not a custom
      // property name in any dialect. (`--$[property]` IS one, and is asserted
      // in custom-property.test.ts alongside the less/scss equivalents.)
      '.card { --: blue; }'
    ]) {
      const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });
});
