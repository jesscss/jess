import { CssParser } from '../src';
import { serializeTypes } from '@jesscss/core';

const cssParser = new CssParser();

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
        [
          (Ruleset
            selector: 
              (BasicSelector 'a')
            rules: 
              (Rules
                [
                  (Declaration
                    name: 
                      (Any [role=property] 'b')
                    value: 
                      (Any 'c')
                  )
                ]
              )
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
          [
            (BasicSelector 'a')
            (Combinator '+')
            (BasicSelector 'b')
          ]
        )
    `);
  });

  test('attribute selector with modifier flag', () => {
    const { tree } = cssParser.parse('[foo=\'bar\' i] { a: b }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      selector:
        (AttributeSelector
          name: 'foo'
          op: '='
          value:
            (Quoted
              (Any [role=any] 'bar')
            )
          mod: 'i'
        )
    `);
  });

  test('pseudo with arguments', () => {
    const { tree } = cssParser.parse('a:is(b, c) { d: e }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      selector:
        (CompoundSelector
          [
            (BasicSelector 'a')
            (PseudoSelector
              name: ':is'
              arg:
                (SelectorList
                  [
                    (BasicSelector 'b')
                    (BasicSelector 'c')
                  ]
                )
            )
          ]
        )
    `);
  });

  test('url function is modeled as Call with UrlValue/Quoted inner', () => {
    const { tree } = cssParser.parse('a{ background:url(foo) }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Url
        (Any [role=urlvalue] 'foo')
      )
    `);
  });

  test('numbers and dimensions', () => {
    const { tree } = cssParser.parse('a{ w: 10px; z: 2 }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'w')
        value:
          (Dimension
            number: 10
            unit: 'px'
          )
    `);
    expect(out).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'z')
        value:
          (Number 2)
    `);
  });

  test('lists and sequences in values', () => {
    const { tree } = cssParser.parse('a{ m: 1, 2, 3; n: 1 2 3 }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'm')
        value:
          (List
            [
              (Number 1)
              (Number 2)
              (Number 3)
            ]
          )
    `);
    expect(out).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'n')
        value:
          (Sequence
            [
              (Number 1)
              (Number 2)
              (Number 3)
            ]
          )
    `);
  });

  test('at-rule name uses AtKeyword', () => {
    const { tree } = cssParser.parse('@media screen { a{b:c} }');
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (AtRule
        name:
          (Any [role=atkeyword] '@media')
    `);
  });
});
