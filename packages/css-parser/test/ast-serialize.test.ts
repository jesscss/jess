import { parseCssFn } from '../src/functional-parser.js';
import { N, isNode, serializeTypes, type Trivia, sourceSpanOf } from '@jesscss/core';

const cssParser = { parse: (input: string) => parseCssFn(input) };

// Trivia is now a single source-range run; its text is the source slice.
const triviaText = (t: Trivia | undefined): string | undefined =>
  t ? t.src.slice(t.start, t.end) : undefined;

// Simple selectors, combinators, names, and plain values are plain strings (not
// nodes) that carry no own span. Per-sub-component span arrays are no longer
// stored on nodes; the parser still records comment runs in the trivia map, so
// these tests look them up by their known literal source offsets.
function selectorListMembers(selector: unknown): unknown[] {
  if (Array.isArray(selector)) {
    return selector;
  }
  if (isNode(selector, N.SelectorList)) {
    return selector.value;
  }
  return [selector];
}
function selectorMemberValueOf(item: unknown): string {
  if (typeof item === 'string') {
    return item;
  }
  if (item && typeof item === 'object' && 'valueOf' in item && typeof item.valueOf === 'function') {
    return String(item.valueOf());
  }
  return String(item);
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
                    value:
                      (Keyword [role=keyword] 'c')
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
    const selector = ruleset.selector!;
    if (!isNode(selector, N.ComplexSelector)) {
      throw new Error('Expected parsed selector to be complex');
    }
    // The descendant combinator is a plain ' ' string between the two compounds.
    const combinator = selector.value[1];
    expect(combinator).toBe(' ');
    // Per-component spans are no longer stored; the comment authored in the
    // combinator gap round-trips via the selector's node-span comment scan (the
    // run carries its own spacing verbatim).
    expect(selector.toString({ trivia })).toBe('a /* gap */ b');
  });

  test('attribute selector with modifier flag', () => {
    const { tree } = cssParser.parse('[foo=\'bar\' i] { a: b }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      selector:
        (AttributeSelector
          value: {
            name: 'foo'
            op: '='
            value:
              (Quoted
                value: 'bar'
              )
            mod: 'i'
          }
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
                  [
                    'b'
                    'c'
                  ]
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
    const selector = ruleset.selector!;

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
      expect(ruleset.selector!.toString({ trivia })).toBe(expected);
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
      const selector = ruleset.selector!;
      expect(selector.toString({ trivia })).toBe(expected);
      expect(serializeTypes(selector)).toContainString(shape);
    }
  });

  test('url function is modeled as Call with UrlValue/Quoted inner', () => {
    const { tree } = cssParser.parse('a{ background:url(foo) }');
    const out = serializeTypes(tree);
    // Url.value is a Node: a bare inner leaf normalizes to Any (a quoted inner to
    // Quoted). Storing a raw string here silently drops it from the render buffer.
    expect(out).toContainString(`
      (Url
        value:
          (Any 'foo')
      )
    `);
  });

  test('quoted url inner is modeled as a Quoted node, not a raw string', () => {
    const { tree } = cssParser.parse('a{ background:url("foo.css") }');
    const out = serializeTypes(tree);
    // A raw string here renders as empty `url()` because a string never writes
    // into the render buffer (see less @import url(...) serialization).
    expect(out).toContainString(`
      (Url
        value:
          (Quoted
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
    expect(triviaText(trivia.lookup(sourceSpanOf(firstArg!)?.end, 'after'))).toBe(' /*{comment}*/');
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > sourceSpanOf(firstArg!)?.end! && offset < sourceSpanOf(secondArg!)?.start!)
        .map(([, t]) => triviaText(t))
    ).toEqual([' /*{comment}*/']);
  });

  test('selector list comments stay in trivia between selector members', () => {
    const { tree, trivia } = cssParser.parse('#a,\n/*x*//*y*/\n.b,/*z*/.c { d: e; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset) || !Array.isArray(ruleset.selector)) {
      throw new Error('Expected first parsed rule to have an array selector list');
    }
    const [first, second, third] = selectorListMembers(ruleset.selector);

    expect(selectorMemberValueOf(first)).toBe('#a');
    expect(selectorMemberValueOf(second)).toBe('.b');
    expect(selectorMemberValueOf(third)).toBe('.c');
    // Per-member spans are no longer stored, but the parser still records the
    // comment runs in the trivia map. `.b` begins after the first comment run
    // (source offset 15), `.c` after the second (offset 23).
    expect(triviaText(trivia.lookup(15, 'before'))).toBe('\n/*x*//*y*/\n');
    expect(triviaText(trivia.lookup(23, 'before'))).toBe('/*z*/');
  });

  test('selector list comments before separators stay in trivia after selector members', () => {
    const { tree, trivia } = cssParser.parse('#comments /* boo *//* boo again*/, .comments { color: red; }');
    const ruleset = tree.rules[0];
    if (!isNode(ruleset, N.Ruleset) || !Array.isArray(ruleset.selector)) {
      throw new Error('Expected first parsed rule to have an array selector list');
    }
    const [first, second] = selectorListMembers(ruleset.selector);

    expect(selectorMemberValueOf(first)).toBe('#comments');
    expect(selectorMemberValueOf(second)).toBe('.comments');
    // Per-member spans are no longer stored, but the parser still records the
    // comment run after the first member. `#comments` ends at source offset 9;
    // the comment run keyed there, and the same run keyed `before` the `,`.
    const firstEnd = 9;
    expect(triviaText(trivia.lookup(firstEnd, 'after'))).toBe(' /* boo *//* boo again*/');
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > firstEnd)
        .map(([, t]) => triviaText(t))
        .filter((t): t is string => t !== undefined && t.includes('/*'))
    ).toEqual([' /* boo *//* boo again*/']);
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

    // The nested selector `b` is a bare string at source offset 10 (per-slot
    // spans are no longer stored). The parser still records its leading trivia
    // run (' /*x*/ ') keyed `before` that offset.
    void nested;
    expect(triviaText(trivia.lookup(10, 'before'))).toBe(' /*x*/ ');
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
    // Per-slot spans are no longer stored; the value `yes` ends at source offset
    // 10 and the parser still keys its trailing comment run there.
    const valueEndOff = 10;
    expect(triviaText(trivia.lookup(valueEndOff, 'after'))).toBe(' /* comment */');
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > valueEndOff)
        .map(([, t]) => triviaText(t))[0]
    ).toBe(' /* comment */');
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
    // Per-slot spans are no longer stored; the name `color` ends at source
    // offset 9 and the parser still keys its trailing comment run there.
    const nameEndOff = 9;
    expect(triviaText(trivia.lookup(nameEndOff, 'after'))).toBe('/* survive */ /* me too */');
    expect(
      [...trivia.entries('before')]
        .filter(([offset]) => offset > nameEndOff)
        .map(([, t]) => triviaText(t))[0]
    ).toBe('/* survive */ /* me too */');
  });

  test('at-rule prelude comments stay in trivia before rule blocks', () => {
    const { tree, trivia } = cssParser.parse('@-webkit-keyframes /* Safari */ hover /* and Chrome */ { 0% { color: red; } }');
    const atRule = tree.rules[0];
    if (!isNode(atRule, N.AtRule)) {
      throw new Error('Expected first parsed rule to be an at-rule');
    }
    const { name, prelude } = atRule;
    if (!prelude || typeof prelude === 'string') {
      throw new Error('Expected at-rule prelude node');
    }

    expect(name.valueOf()).toBe('@-webkit-keyframes');
    expect(prelude.valueOf()).toBe('hover');
    expect(triviaText(trivia.lookup(sourceSpanOf(prelude)?.start, 'before'))).toBe(' /* Safari */ ');
    expect(triviaText(trivia.lookup(sourceSpanOf(prelude)?.end, 'after'))).toBe(' /* and Chrome */ ');
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

  test('calc folds its body into Operation nodes', () => {
    const { tree } = cssParser.parse('a{ b: calc((100% + 10vw) * 14px); c: calc(100px / 4); d: min(1px, 2px) }');
    const out = serializeTypes(tree);
    // calc(...) → Call whose single List arg is a precedence-climbed Operation;
    // the inner `(100% + 10vw)` is a Paren(Operation), and `/` divides in calc.
    expect(out).toContainString(`
      (Call
        name: 'calc'
        args:
          (List
            value:
              [
                (Operation
                  left:
                    (Paren
                      value:
                        (Operation
                          left:
                            (Dimension
                              number: 100
                              unit: '%'
                            )
                          right:
                            (Dimension
                              number: 10
                              unit: 'vw'
                            )
                        )
                    )
                  right:
                    (Dimension
                      number: 14
                      unit: 'px'
                    )
                )
              ]
          )
      )
    `);
    // calc(100px / 4): slash divides (both operands division-like).
    expect(out).toContainString(`
      (Operation
        left:
          (Dimension
            number: 100
            unit: 'px'
          )
        right:
          (Num 4)
      )
    `);
    // min(...) is NOT a math context — its args stay a flat value list.
    expect(out).toContainString(`
      (Call
        name: 'min'
        args:
          (List
            value:
              [
                (Dimension
                  number: 1
                  unit: 'px'
                )
                (Dimension
                  number: 2
                  unit: 'px'
                )
              ]
          )
      )
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

// A combinator is only valid BETWEEN two compound selectors. Leading, trailing,
// and adjacent-multiple combinators are "bogus" — Sass emits empty CSS + a
// [bogus-combinators] deprecation and Dart Sass 2.0 makes them an error — so the
// grammar rejects them, along with a combinator-only run and an empty selector.
describe('combinators are valid only between compound selectors', () => {
  test.each([
    ['single child', 'a > b { c: d }'],
    ['single sibling', 'a ~ b { c: d }'],
    ['descendant', 'a b { c: d }'],
    ['chained', 'a > b + c { d: e }']
  ])('accepts %s: %s', (_name, src) => {
    const { errors } = cssParser.parse(src);
    expect(errors.map(e => e.message)).toEqual([]);
  });

  test.each([
    ['leading', '> > a { b: c }'],
    ['leading (single)', '> a { b: c }'],
    ['trailing (child)', 'a > { b: c }'],
    ['trailing multiple', 'a > > { b: c }'],
    ['adjacent-multiple', 'a > + b { c: d }'],
    ['adjacent-multiple (no whitespace)', 'a~>b { c: d }'],
    ['combinator-only (single)', '+ { b: c }'],
    ['combinator-only (multiple)', '> > > { b: c }'],
    ['empty selector', '{ b: c }']
  ])('rejects %s: %s', (_name, src) => {
    const { errors } = cssParser.parse(src);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test('a valid complex selector yields the joined component sequence', () => {
    const { tree } = cssParser.parse('a > b { c: d; }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (ComplexSelector
        value:
          [
            'a'
            '>'
            'b'
          ]
      )
    `);
  });
});

// Attribute-selector modifier: only `i`/`s` are defined, but any single ASCII
// LETTER is accepted for forwards-compatibility (`[a=b c]`). A digit, underscore,
// or multi-character modifier is rejected.
describe('attribute selector modifier accepts a single ASCII letter', () => {
  test.each([
    '[a=b i] { d: e }',
    '[a=b s] { d: e }',
    '[a=b c] { d: e }'
  ])('accepts %s', (src) => {
    const { errors } = cssParser.parse(src);
    expect(errors.map(e => e.message)).toEqual([]);
  });

  test.each([
    ['digit', '[a=b 2] { d: e }'],
    ['underscore', '[a=b _] { d: e }'],
    ['two characters', '[a=b cd] { d: e }']
  ])('rejects %s: %s', (_name, src) => {
    const { errors } = cssParser.parse(src);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
