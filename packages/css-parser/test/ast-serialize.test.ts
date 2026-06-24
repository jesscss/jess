import { CssParser } from '../src/index.js';
import { N, isNode, serializeTypes } from '@jesscss/core';
import { packedSpanStart, packedSpanEnd } from '@jesscss/parser';

const cssParser = new CssParser();

// Simple selectors, combinators, names, and plain values are plain strings (not
// nodes), so source provenance lives in the parent node's packed fieldSpans
// (by childKeys index) and valueSpans (by array-segment index).
function childIndex(node: any, key: string): number {
  return ((node.constructor.childKeys ?? []) as readonly string[]).indexOf(key);
}
function fieldStart(node: any, key: string): number {
  return packedSpanStart(node.fieldSpans, childIndex(node, key));
}
function fieldEnd(node: any, key: string): number {
  return packedSpanEnd(node.fieldSpans, childIndex(node, key));
}
function valueStart(node: any, index: number): number {
  return packedSpanStart(node.valueSpans, index);
}
function valueEnd(node: any, index: number): number {
  return packedSpanEnd(node.valueSpans, index);
}

describe('serializeTypes coverage', () => {
  test('charset', () => {
    const { tree } = cssParser.parse('@charset "UTF-8";');
    expect(serializeTypes(tree)).toContainString(`
      (Any [role=charset] '@charset "UTF-8";')
    `);
  });
  test('single rule with declaration', () => {
    const { tree } = cssParser.parse('a { b: c; }');
    expect(serializeTypes(tree)).toBeString(`
      (Rules
        rules:
          [
            (Ruleset
              selector: 'a'
              rules:
                [
                  (Declaration
                    name: 'b'
                    value: 'c'
                  )
                ]
            )
          ]
      )
    `);
  });

  test('complex selector with combinator', () => {
    const { tree } = cssParser.parse('a + b { c: d; }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      selector:
        (ComplexSelector
          value:
            [
              'a'
              '+'
              'b'
            ]
        )
    `);
  });

  test('descendant combinator pops one whitespace character from trivia map', () => {
    const { tree, trivia } = cssParser.parse('a /* gap */ b { c: d; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset)) {
      throw new Error('Expected first parsed rule to be a ruleset');
    }
    const selector = ruleset.selector;
    if (!isNode(selector, N.ComplexSelector)) {
      throw new Error('Expected parsed selector to be complex');
    }
    // The descendant combinator is a plain ' ' string between the two compounds.
    const combinator = selector.value[1];
    expect(combinator).toBe(' ');
    // The trivia preceding the second compound is recovered via valueSpans.
    expect(trivia.lookup(valueStart(selector, 2), 'before')?.map(token => token.image)).toEqual([
      ' ',
      '/* gap */',
      ' '
    ]);
  });

  test('attribute selector with modifier flag', () => {
    const { tree } = cssParser.parse('[foo=\'bar\' i] { a: b }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      selector: 
        (AttributeSelector
          name: 'foo'
          attributeValue:
            (Quoted
              value:
                'bar'
            )
        )
    `);
  });

  test('page selector names preserve authored casing', () => {
    const { errors, tree } = cssParser.parse('@page Test:first { margin: 1cm; }');
    expect(errors.length).toBe(0);

    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (AtRule
        name:
          '@page'
        prelude:
          (List
            value:
              [
                (Any [role=ident] 'Test:first')
              ]
          )
    `);
  });

  test('pseudo with arguments', () => {
    const { tree } = cssParser.parse('a:is(b, c) { d: e }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      selector:
        (CompoundSelector
          value:
            [
              'a'
              (PseudoSelector
                name: ':is'
                arg:
                  (SelectorList
                    value:
                      [
                        'b'
                        'c'
                      ]
                  )
              )
            ]
        )
    `);
  });

  test('host pseudo arguments are selector-shaped compounds', () => {
    const { errors, tree } = cssParser.parse(':host(.sel.a), :host-context(.sel.b) { type: shadow-dom; }');
    expect(errors.length).toBe(0);

    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (PseudoSelector
        name: ':host'
        arg:
          (CompoundSelector
            value:
              [
                '.sel'
                '.a'
              ]
          )
      )
    `);
    expect(out).toContainString(`
      (PseudoSelector
        name: ':host-context'
        arg:
          (CompoundSelector
            value:
              [
                '.sel'
                '.b'
              ]
          )
      )
    `);
  });

  test('unknown pseudo arguments preserve adjacent generic sequence nodes', () => {
    const { errors, tree, trivia } = cssParser.parse(':unknown(.sel.a) { color: red; }');
    expect(errors.length).toBe(0);

    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset)) {
      throw new Error('Expected first parsed rule to be a ruleset');
    }
    const selector = ruleset.selector;

    expect(selector.toString({ trivia })).toBe(':unknown(.sel.a)');
    expect(serializeTypes(selector)).toContainString(`
      (PseudoSelector
        name: ':unknown'
        arg:
          [
            '.sel'
            '.a'
          ]
      )
    `);
  });

  test('unknown pseudo generic sequence arguments preserve trivia spacing', () => {
    const cases = [
      [':unknown(.sel.a) { color: red; }', ':unknown(.sel.a)'],
      [':unknown(.sel .a) { color: red; }', ':unknown(.sel .a)'],
      [':unknown(.sel/*comment */.a) { color: red; }', ':unknown(.sel/*comment */.a)'],
      [':unknown(.sel /*comment */.a) { color: red; }', ':unknown(.sel /*comment */.a)'],
      [':unknown(.sel/*comment */ .a) { color: red; }', ':unknown(.sel/*comment */ .a)'],
      [':unknown(.sel /*comment */ .a) { color: red; }', ':unknown(.sel /*comment */ .a)']
    ] as const;

    for (const [source, expected] of cases) {
      const { errors, tree, trivia } = cssParser.parse(source);
      expect(errors.length).toBe(0);
      const ruleset = tree.rules[0];
      if (!isNode(ruleset, N.Ruleset)) {
        throw new Error('Expected first parsed rule to be a ruleset');
      }
      expect(ruleset.selector.toString({ trivia })).toBe(expected);
    }
  });

  test('host pseudo selector arguments preserve trivia spacing', () => {
    const cases = [
      [':host(.sel.a) { color: red; }', ':host(.sel.a)', '(CompoundSelector'],
      [':host(.sel .a) { color: red; }', ':host(.sel .a)', '(ComplexSelector'],
      [':host(.sel/*comment */.a) { color: red; }', ':host(.sel/*comment */.a)', '(CompoundSelector'],
      [':host(.sel /*comment */.a) { color: red; }', ':host(.sel /*comment */.a)', '(ComplexSelector'],
      [':host(.sel/*comment */ .a) { color: red; }', ':host(.sel/*comment */ .a)', '(ComplexSelector'],
      [':host(.sel /*comment */ .a) { color: red; }', ':host(.sel /*comment */ .a)', '(ComplexSelector']
    ] as const;

    for (const [source, expected, shape] of cases) {
      const { errors, tree, trivia } = cssParser.parse(source);
      expect(errors.length).toBe(0);
      const ruleset = tree.rules[0];
      if (!isNode(ruleset, N.Ruleset)) {
        throw new Error('Expected first parsed rule to be a ruleset');
      }
      const selector = ruleset.selector;
      expect(selector.toString({ trivia })).toBe(expected);
      expect(serializeTypes(selector)).toContainString(shape);
    }
  });

  test('url function is modeled as Call with UrlValue/Quoted inner', () => {
    const { tree } = cssParser.parse('a{ background:url(foo) }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Url
        node:
          'foo'
      )
    `);
  });

  test('numbers and dimensions', () => {
    const { tree } = cssParser.parse('a{ w: 10px; z: 2 }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Declaration
        name:
          'w'
        value:
          (Dimension
            number: 10
            unit: 'px'
          )
    `);
    expect(out).toContainString(`
      (Declaration
        name:
          'z'
        value:
          (Num 2)
    `);
  });

  test('plain identifier color function args normalize to Color nodes', () => {
    const { tree } = cssParser.parse('a { color: color(plum); }');
    const out = serializeTypes(tree);

    expect(out).toContainString(`
      (Call
        name: 'color'
        args:
          (List
            value:
              [
                (Color
                  node: 'plum'
    `);
  });

  test('function argument comments stay in trivia between list members and separator', () => {
    const { tree, trivia } = cssParser.parse('a { b: linear-gradient(#333 /*{comment}*/, #111); }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset)) {
      throw new Error('Expected first parsed rule to be a ruleset');
    }
    const declaration = ruleset.rules?.[0];
    if (!isNode(declaration, N.Declaration)) {
      throw new Error('Expected first rule to be a declaration');
    }
    const value = declaration.value;
    if (!isNode(value, N.Call) || !isNode(value.args, N.List)) {
      throw new Error('Expected declaration value to be a function call with list args');
    }
    const [firstArg, secondArg] = value.args.value;

    expect(isNode(firstArg, N.Color)).toBe(true);
    expect(isNode(secondArg, N.Color)).toBe(true);
    expect(trivia.lookup(firstArg!.location[3], 'after')?.map(token => token.image)).toEqual([
      ' ',
      '/*{comment}*/'
    ]);
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > firstArg!.location[3] && offset < secondArg!.location[0])
        .map(([, tokens]) => tokens.map(token => token.image))
    ).toEqual([[
      ' ',
      '/*{comment}*/'
    ]]);
  });

  test('selector list comments stay in trivia between selector members', () => {
    const { tree, trivia } = cssParser.parse('#a,\n/*x*//*y*/\n.b,/*z*/.c { d: e; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset) || !isNode(ruleset.selector, N.SelectorList)) {
      throw new Error('Expected first parsed rule to have a selector list');
    }
    const [first, second, third] = ruleset.selector.value;

    expect(first?.valueOf()).toBe('#a');
    expect(second?.valueOf()).toBe('.b');
    expect(third?.valueOf()).toBe('.c');
    expect(trivia.lookup(valueStart(ruleset.selector, 1), 'before')?.map(token => token.image)).toEqual([
      '\n',
      '/*x*/',
      '/*y*/',
      '\n'
    ]);
    expect(trivia.lookup(valueStart(ruleset.selector, 2), 'before')?.map(token => token.image)).toEqual([
      '/*z*/'
    ]);
  });

  test('selector list comments before separators stay in trivia after selector members', () => {
    const { tree, trivia } = cssParser.parse('#comments /* boo *//* boo again*/, .comments { color: red; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset) || !isNode(ruleset.selector, N.SelectorList)) {
      throw new Error('Expected first parsed rule to have a selector list');
    }
    const [first, second] = ruleset.selector.value;

    expect(first?.valueOf()).toBe('#comments');
    expect(second?.valueOf()).toBe('.comments');
    const firstEnd = valueEnd(ruleset.selector, 0);
    const secondStart = valueStart(ruleset.selector, 1);
    expect(trivia.lookup(firstEnd, 'after')?.map(token => token.image)).toEqual([
      ' ',
      '/* boo */',
      '/* boo again*/'
    ]);
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > firstEnd && offset < secondStart)
        .map(([, tokens]) => tokens.map(token => token.image))
    ).toEqual([[
      ' ',
      '/* boo */',
      '/* boo again*/'
    ]]);
  });

  test('same-line comments before nested selectors stay in selector trivia', () => {
    const { tree, trivia } = cssParser.parse('a { /*x*/ b { c: d; } }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset) || !ruleset.rules) {
      throw new Error('Expected first parsed rule to have nested rules');
    }
    const [nested] = ruleset.rules;
    if (!isNode(nested, N.Ruleset)) {
      throw new Error('Expected nested rule to be a ruleset');
    }

    // The nested selector is a bare string; its source offset comes from the
    // ruleset's packed selector fieldSpan. The leading trivia (' /*x*/ ') is
    // preserved in the trivia map before that offset.
    const selStart = fieldStart(nested, 'selector');
    expect(trivia.lookup(selStart, 'before')?.map(token => token.image)).toEqual([
      ' ',
      '/*x*/',
      ' '
    ]);
  });

  test('collapse nesting emits nested selector comments from trivia', () => {
    const sources = [
      'a {/*x*/ b { c: d; } }',
      'a { /*x*/ b { c: d; } }'
    ];

    for (const source of sources) {
      const { errors, tree, trivia } = cssParser.parse(source);
      expect(errors.length).toBe(0);
      const css = tree.toString({ collapseNesting: true, trivia });
      expect(css).toBeString(`
        a {
          /*x*/
        }
        a b {
          c: d;
        }`
      );
    }
  });

  test('declaration value comments stay in trivia before declaration terminators', () => {
    const { tree, trivia } = cssParser.parse('a { b: yes /* comment */; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset)) {
      throw new Error('Expected first parsed rule to be a ruleset');
    }
    const declaration = ruleset.rules?.[0];
    if (!isNode(declaration, N.Declaration)) {
      throw new Error('Expected first rule to be a declaration');
    }
    const value = declaration.value;

    expect(value.valueOf()).toBe('yes');
    const valueEndOff = fieldEnd(declaration, 'value');
    expect(trivia.lookup(valueEndOff, 'after')?.map(token => token.image)).toEqual([
      ' ',
      '/* comment */'
    ]);
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > valueEndOff)
        .map(([, tokens]) => tokens.map(token => token.image))[0]
    ).toEqual([
      ' ',
      '/* comment */'
    ]);
  });

  test('declaration name comments stay in trivia before declaration separators', () => {
    const { tree, trivia } = cssParser.parse('a { color/* survive */ /* me too */: grey; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset)) {
      throw new Error('Expected first parsed rule to be a ruleset');
    }
    const declaration = ruleset.rules?.[0];
    if (!isNode(declaration, N.Declaration)) {
      throw new Error('Expected first rule to be a declaration');
    }
    const { name } = declaration;

    expect(name.valueOf()).toBe('color');
    const nameEndOff = fieldEnd(declaration, 'name');
    expect(trivia.lookup(nameEndOff, 'after')?.map(token => token.image)).toEqual([
      '/* survive */',
      ' ',
      '/* me too */'
    ]);
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > nameEndOff)
        .map(([, tokens]) => tokens.map(token => token.image))[0]
    ).toEqual([
      '/* survive */',
      ' ',
      '/* me too */'
    ]);
  });

  test('at-rule prelude comments stay in trivia before rule blocks', () => {
    const { tree, trivia } = cssParser.parse('@-webkit-keyframes /* Safari */ hover /* and Chrome */ { 0% { color: red; } }');
    const atRule = tree.rules[0];
    if (!isNode(atRule, N.AtRule)) {
      throw new Error('Expected first parsed rule to be an at-rule');
    }
    const { name, prelude } = atRule;
    if (!prelude) {
      throw new Error('Expected at-rule prelude');
    }

    expect(name.valueOf()).toBe('@-webkit-keyframes');
    expect(prelude.valueOf()).toBe('hover');
    expect(trivia.lookup(prelude.location[0], 'before')?.map(token => token.image)).toEqual([
      ' ',
      '/* Safari */',
      ' '
    ]);
    expect(trivia.lookup(prelude.location[3], 'after')?.map(token => token.image)).toEqual([
      ' ',
      '/* and Chrome */',
      ' '
    ]);
  });

  test('lists and sequences in values', () => {
    const { tree } = cssParser.parse('a{ m: 1, 2, 3; n: 1 2 3 }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Declaration
        name:
          'm'
        value:
          (List
            value:
              [
                (Num 1)
                (Num 2)
                (Num 3)
              ]
          )
    `);
    // A space-separated sequence is a plain array (no operator semantics).
    expect(out).toContainString(`
      (Declaration
        name:
          'n'
        value:
          [
            (Num 1)
            (Num 2)
            (Num 3)
          ]
    `);
  });

  test('at-rule name uses AtKeyword', () => {
    const { tree } = cssParser.parse('@media screen { a{b:c} }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (AtRule
        name:
          '@media'
    `);
  });
});
