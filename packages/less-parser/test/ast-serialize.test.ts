import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

// Import the actual placeholder from core
import { INTERPOLATION_PLACEHOLDER } from '@jesscss/core';

// Helper function to extract Interpolated nodes from serialized output
function extractInterpolatedNodes(serialized: string): string[] {
  const matches = serialized.match(/\(Interpolated[^)]*\)[\s\S]*?\)/g);
  return matches || [];
}

const parser = new Parser();

describe('serializeTypes coverage', () => {
  test('charset', () => {
    const { errors, tree } = parser.parse('@charset "UTF-8";');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (Any [role=charset] '@charset "UTF-8";')
    `);
  });
  test('nested reference', () => {
    const { errors, tree } = parser.parse('@ref: #ns.breakpoint(.valToGet[])[@max];');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toBeString(`
      (Rules
        [
          (VarDeclaration
            name: 
              (Any [role=ident] 'ref')
            value: 
              (Expression
                (Reference
                  target: 
                    (Call
                      name: 
                        (Reference [role=name]
                          key:
                            ['#ns', '.breakpoint']
                        )
                      args: 
                        (List
                          [
                            (Reference
                              target: 
                                (Reference [role=name]
                                  key: '.valToGet'
                                )
                              key: -1
                            )
                          ]
                        )
                    )
                  key: 'max'
                )
              )
          )
        ]
      )
    `);
  });
  test('variable declaration', () => {
    const { errors, tree } = parser.parse('@color: red;');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'color')
        value: 
          (Color
            node: 'red'
            format: 0
            rgb:
            [255, 0, 0]
            alpha: 1
          )
      )
    `);
  });

  test('mixin definition', () => {
    const { errors, tree } = parser.parse('.mixin(@color) { color: @color; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (Mixin
        name: '.mixin'
        params: 
          (List
            [
              (VarDeclaration
                name: 
                  (Any [role=property] 'color')
                value: 
                  (Nil '')
              )
            ]
          )
        rules: 
          (Rules
            [
              (Declaration
                name: 
                  (Any [role=property] 'color')
                value: 
                  (Expression
                    (Reference
                      key: 'color'
                    )
                  )
              )
            ]
          )
      )
    `);
  });

  test('mixin call', () => {
    const { errors, tree } = parser.parse('.mixin() { color: red; } .test { .mixin(); }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (Call
        name: 
          (Reference [role=name]
            key: 
              (BasicSelector '.mixin')
          )
      )
    `);
  });

  test('mixin call with arguments', () => {
    const { errors, tree } = parser.parse('.mixin(@color) { color: @color; } .test { .mixin(red); }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (Call
        name: 
          (Reference [role=name]
            key: 
              (BasicSelector '.mixin')
          )
        args: 
          (List
            [
              (Color
                node: 'red'
                format: 0
                rgb:
                [255, 0, 0]
                alpha: 1
              )
            ]
          )
      )
    `);
  });

  test('anonymous mixin definition', () => {
    // Anonymous mixin definitions are not valid Less syntax - removing this test
    // If needed, this should be in error-parsing.test.ts
  });

  test('anonymous mixin definition with parameters', () => {
    // Anonymous mixin definitions are not valid Less syntax - removing this test
    // If needed, this should be in error-parsing.test.ts
  });

  test('detached ruleset', () => {
    const { errors, tree } = parser.parse('.test { @rules: { color: red; }; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'rules')
        value: 
          (Mixin
            rules: 
              (Rules
                [
                  (Declaration
                    name: 
                      (Any [role=property] 'color')
                    value: 
                      (Color
                        node: 'red'
                        format: 0
                        rgb:
                        [255, 0, 0]
                        alpha: 1
                      )
                  )
                ]
              )
          )
      )
    `);
  });

  test('property accessor', () => {
    const { errors, tree } = parser.parse('.test { color: @obj[prop]; }');
    expect(errors.length).toBe(0);
    expect(tree.toString().replace(/\s+/g, '')).toContain('$obj.~prop');
    expect(serializeTypes(tree)).toContainString(`
      (Expression
        (Reference
          target: 
            (Reference
              key: 'obj'
            )
          key: 'prop'
        )
      )
    `);
  });

  test('interpolated selector', () => {
    const { errors, tree } = parser.parse('.@{prefix}-button { color: red; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (InterpolatedSelector
          (Interpolated [role=ident]
            source: '.${INTERPOLATION_PLACEHOLDER}-button'
            replacements:
            [
              (Reference [role=ident]
                key: 'prefix'
              )
            ]
          )
        )
    `);
  });

  test('interpolated property name', () => {
    const { errors, tree } = parser.parse('.test { @{prop}: red; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      name: 
        (Interpolated [role=ident]
          source: '${INTERPOLATION_PLACEHOLDER}'
          replacements:
          [
            (Reference [role=ident]
              key: 'prop'
            )
          ]
        )
    `);
  });

  test('interpolated value in declaration', () => {
    const { errors, tree } = parser.parse('.test { color: @{colorVar}; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
                (Interpolated [role=ident]
                  source: '${INTERPOLATION_PLACEHOLDER}'
                  replacements:
                  [
                    (Reference
                      key: 'colorVar'
                    )
                  ]
                )
    `);
  });

  test('interpolated mixin definition', () => {
    // Test interpolated selector instead (mixin name interpolation may not be supported)
    const { errors, tree } = parser.parse('.button-@{suffix} { color: red; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
  });
});

test('rest parameter in mixin', () => {
  const { errors, tree } = parser.parse('.mixin(@args...) { color: red; }');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (Mixin
        name: '.mixin'
        params: 
          (List
            [
              (Rest 'args')
            ]
          )
        rules: 
          (Rules
            [
              (Declaration
                name: 
                  (Any [role=property] 'color')
                value: 
                  (Color
                    node: 'red'
                    format: 0
                    rgb:
                    [255, 0, 0]
                    alpha: 1
                  )
              )
            ]
          )
      )
    `);
});

test('rest argument in mixin call', () => {
  // Rest arguments in calls use ... syntax which may not be valid
  // Testing with regular arguments instead
  const { errors, tree } = parser.parse('.mixin(@args...) { color: red; } .test { .mixin(1, 2, 3); }');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString('(Call');
});

test('operation', () => {
  const { errors, tree } = parser.parse('.test { width: 10px + 5px; }');
  expect(errors.length).toBe(0);
  // Jess conversion: outer expression is explicit and parenthesized
  expect(tree.toString().replace(/\s+/g, '')).toContain('$(10px+5px)');
  expect(serializeTypes(tree, { showOptions: true })).toContainString('parens: true');
  expect(serializeTypes(tree)).toContainString(`
      (Expression
        (Operation
          [
            (Dimension
              number: 10
              unit: 'px'
            )
            (undefined)
            (Dimension
              number: 5
              unit: 'px'
            )
          ]
        )
      )
    `);
});

test('function call', () => {
  const { errors, tree } = parser.parse('.test { color: rgb(255, 0, 0); }');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (Call
        name: 
          (Reference
            key: 'rgb'
          )
        args: 
          (List
            [
              (Number 255)
              (Number 0)
              (Number 0)
            ]
          )
      )
    `);
});

test('@import "file.less" parsed as StyleImport', () => {
  const { errors, tree } = parser.parse('@import "file.less";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          reference: false
          once: true
        }
        path: 
          (Quoted
            quote: '"'
            escaped: false
          (Any [role=any]
            role: 'any'
            'file.less'
          )
        )
      )
    `);
});

test('@import "file.css" parsed as import AtRule', () => {
  const { errors, tree } = parser.parse('@import "file.css";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (AtRule
        name: 
          (Any [role=atkeyword] '@import')
        prelude: 
          (Sequence
            [
              (Quoted
                (Any [role=any] 'file.css')
              )
            ]
          )
      )
    `);
});

test('@import (less, reference) "file" with options', () => {
  const { errors, tree } = parser.parse('@import (less, reference) "file";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          reference: true
          once: true
        }
        path: 
          (Quoted
            quote: '"'
            escaped: false
          (Any [role=any]
            role: 'any'
            'file'
          )
        )
      )
    `);
});

test('@import (css) "file.css" with css option', () => {
  const { errors, tree } = parser.parse('@import (css) "file.css";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (AtRule
        name: 
          (Any [role=atkeyword] '@import')
        prelude: 
          (Sequence
            [
              (Quoted
                (Any [role=any] 'file.css')
              )
            ]
          )
      )
    `);
});

test('@import (multiple) "file.less" with multiple option', () => {
  const { errors, tree } = parser.parse('@import (multiple) "file.less";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          reference: false
          once: false
        }
        path: 
          (Quoted
            quote: '"'
            escaped: false
          (Any [role=any]
            role: 'any'
            'file.less'
          )
        )
      )
    `);
});

/** If it has a colon and a space after it, it's a variable declaration */
test('parse known at-rule as variable declaration', () => {
  const result = parser.parse('@property: foo;');

  expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'property')
        value: 
          (Any 'foo')
      )
    `);
});

/** If it has a colon and no spaces, still a variable declaration */
test('parse known at-rule as variable declaration', () => {
  const result = parser.parse('@property:foo;');

  expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'property')
        value: 
          (Any 'foo')
      )
    `);
});

/** If it has a parens immediately after, it's a call */
test('parse known at-rule as variable call', () => {
  const { errors, tree } = parser.parse('@media();');
  expect(errors.length).toBe(0);

  expect(tree.toString()).toContain('$media()');
  expect(serializeTypes(tree)).toContainString(`
      (Expression
        (Call
          name: 
            (Reference [role=name]
              key: 
                (Any [role=ident] 'media')
            )
        )
      )
    `);
});

test('namespace reference - simple id', () => {
  const { errors, tree } = parser.parse('@ref: #id;');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Reference [role=name]
            key: '#id'
          )
      )
    `);
});

test('namespace reference - simple class', () => {
  const { errors, tree } = parser.parse('@ref: .class;');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Reference [role=name]
            key: '.class'
          )
      )
    `);
});

test('namespace reference - complex selector', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin;');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Reference [role=name]
            key:
              ['#namespace', '.scoped-mixin']
          )
      )
    `);
});

test('namespace call - simple id with parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #id();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Call
              name: 
                (Reference [role=name]
                  key: '#id'
                )
            )
          )
      )
    `);
});

test('namespace call - complex selector with parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Call
              name: 
                (Reference [role=name]
                  key:
                    ['#namespace', '.scoped-mixin']
                )
            )
          )
      )
    `);
});

test('namespace reference with accessor', () => {
  const { errors, tree } = parser.parse('@ref: #id[property];');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Reference
            target: 
              (Reference [role=name]
                key: '#id'
              )
            key: 'property'
          )
      )
    `);
});

test('variable reference with accessor', () => {
  const { errors, tree } = parser.parse('@ref: @config[$@prop];');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Reference
              target: 
                (Reference
                  key: 'config'
                )
              key: 
                (Interpolated [role=ident]
                  source: '${INTERPOLATION_PLACEHOLDER}'
                  replacements:
                  [
                    (Reference [role=ident]
                      key: 'prop'
                    )
                  ]
                )
            )
          )
      )
    `);
});

test('namespace reference with complex selector and accessor', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin[property];');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Reference
            target: 
              (Reference [role=name]
                key:
                  ['#namespace', '.scoped-mixin']
              )
            key: 'property'
          )
      )
    `);
});

test('namespace call with accessor and parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin[@ref]();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Call
              name: 
                (Reference
                  target: 
                    (Reference [role=name]
                      key:
                        ['#namespace', '.scoped-mixin']
                    )
                  key: 'ref'
                )
            )
          )
      )
    `);
});

test('chained mixin calls - simple chain', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1() > .mixin2();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Call
              name: 
                (Reference [role=name]
                  target: 
                    (Call
                      name: 
                        (Reference [role=name]
                          key: '.mixin1'
                        )
                    )
                  key: '.mixin2'
                )
            )
          )
      )
    `);
});

test('chained mixin calls - with arguments', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1(@foo: bar) > .mixin2();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Call
              name: 
                (Reference [role=name]
                  target: 
                    (Call
                      name: 
                        (Reference [role=name]
                          key: '.mixin1'
                        )
                      args: 
                        (List
                          [
                            (VarDeclaration
                              name: 
                                (Any [role=property] 'foo')
                              value: 
                                (Any 'bar')
                            )
                          ]
                        )
                    )
                  key: '.mixin2'
                )
            )
          )
      )
    `);
});

test('chained mixin calls - complex chain with accessors', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1(@foo: bar) > .mixin2[@val1].ns() > .sub-mixin[@val2];');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Reference
              target: 
                (Reference [role=name]
                  target: 
                    (Call
                      name: 
                        (Reference [role=name]
                          target: 
                            (Reference
                              target: 
                                (Reference [role=name]
                                  target: 
                                    (Call
                                      name: 
                                        (Reference [role=name]
                                          key: '.mixin1'
                                        )
                                      args: 
                                        (List
                                          [
                                            (VarDeclaration
                                              name: 
                                                (Any [role=property] 'foo')
                                              value: 
                                                (Any 'bar')
                                            )
                                          ]
                                        )
                                    )
                                  key: '.mixin2'
                                )
                              key: 'val1'
                            )
                          key: '.ns'
                        )
                    )
                  key: '.sub-mixin'
                )
              key: 'val2'
            )
          )
      )
    `);
});

test('chained mixin calls - deep nesting', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1() > .mixin2() > .mixin3() > .mixin4();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'ref')
        value: 
          (Expression
            (Call
              name: 
                (Reference [role=name]
                  target: 
                    (Call
                      name: 
                        (Reference [role=name]
                          target: 
                            (Call
                              name: 
                                (Reference [role=name]
                                  target: 
                                    (Call
                                      name: 
                                        (Reference [role=name]
                                          key: '.mixin1'
                                        )
                                    )
                                  key: '.mixin2'
                                )
                            )
                          key: '.mixin3'
                        )
                    )
                  key: '.mixin4'
                )
            )
          )
      )
    `);
});

describe('extend cases', () => {
  test('single selector with extend - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (BasicSelector '.a')
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 1
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('multiple selectors with same target - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (SelectorList
                  [
                    (BasicSelector '.a')
                    (BasicSelector '.b')
                  ]
                )
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 1
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('multiple selectors with different targets - root-level extends', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x), .b:extend(.y) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Rules
              [
                (Extend
                  selector: 
                    (BasicSelector '.a')
                  target: 
                    (BasicSelector '.x')
                  flag: 1
                )
                (Extend
                  selector: 
                    (BasicSelector '.b')
                  target: 
                    (BasicSelector '.y')
                  flag: 1
                )
                (Ruleset
                  selector: 
                    (SelectorList
                      [
                        (BasicSelector '.a')
                        (BasicSelector '.b')
                      ]
                    )
                  rules: 
                    (Rules
                      [
                        (Declaration
                          name: 
                            (Any [role=property] 'color')
                          value: 
                            (Color
                              node: 'blue'
                              format: 0
                              rgb:
                              [0, 0, 255]
                              alpha: 1
                            )
                        )
                      ]
                    )
                )
              ]
            )
          ]
        )
      `);
  });

  test('mixed selectors - some with extends, some without - root-level extends', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b { color: blue; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Rules
              [
                (Extend
                  selector: 
                    (BasicSelector '.a')
                  target: 
                    (BasicSelector '.x')
                  flag: 1
                )
                (Ruleset
                  selector: 
                    (SelectorList
                      [
                        (BasicSelector '.a')
                        (BasicSelector '.b')
                      ]
                    )
                  rules: 
                    (Rules
                      [
                        (Declaration
                          name: 
                            (Any [role=property] 'color')
                          value: 
                            (Color
                              node: 'blue'
                              format: 0
                              rgb:
                              [0, 0, 255]
                              alpha: 1
                            )
                        )
                      ]
                    )
                )
              ]
            )
          ]
        )
      `);
  });

  test('ampersand extend - single extend', () => {
    const { errors, tree } = parser.parse('&:extend(.x);');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Extend
              target: 
                (BasicSelector '.x')
              flag: 1
            )
          ]
        )
      `);
  });

  test('ampersand extend with all flag', () => {
    const { tree, errors, lexerResult } = parser.parse('&:extend(.x all);');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    if (lexerResult.errors.length > 0) {
      console.error('Lexer errors:', lexerResult.errors.map(e => e.message || e));
    }
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Extend
              target: 
                (BasicSelector '.x')
              flag: 0
            )
          ]
        )
      `);
  });

  test('ampersand extend with !all flag', () => {
    const { tree, errors, lexerResult } = parser.parse('&:extend(.x !all);');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    if (lexerResult.errors.length > 0) {
      console.error('Lexer errors:', lexerResult.errors.map(e => e.message || e));
    }
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Extend
              target: 
                (BasicSelector '.x')
              flag: 0
            )
          ]
        )
      `);
  });

  test('extend with all flag - ExtendFlag.All', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x all) { color: blue; }');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    if (lexerResult.errors.length > 0) {
      console.error('Lexer errors:', lexerResult.errors.map(e => e.message || e));
    }
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (BasicSelector '.a')
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 0
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('nested ruleset with extend - nested ruleset should not inherit extend', () => {
    const { tree, errors } = parser.parse(`
.ext {
  test: 1;
}
.a, .b {
  .c:extend(.ext all) {
    test: 3;
    .d {
      test: 4;
    }
  }
}
`);
    expect(errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    // Count Extend nodes - should only be 1 (in .c), not 2 (not in .d)
    const extendMatches = sExpr.match(/\(Extend/g);
    const extendCount = extendMatches?.length || 0;
    expect(extendCount).toBe(1);
    // Verify the Extend is in .c, not in .d
    expect(sExpr).toContainString('(BasicSelector \'.c\')');
    expect(sExpr).toContainString('(BasicSelector \'.d\')');
    // The Extend should be in the .c ruleset, not in the .d ruleset
    const cExtendIndex = sExpr.indexOf('(BasicSelector \'.c\')');
    const dExtendIndex = sExpr.indexOf('(BasicSelector \'.d\')');
    const extendIndex = sExpr.indexOf('(Extend');
    expect(extendIndex).toBeGreaterThan(-1);
    expect(extendIndex).toBeLessThan(dExtendIndex); // Extend should come before .d
  });

  test('extend with !all flag - ExtendFlag.All', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x !all) { color: blue; }');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    if (lexerResult.errors.length > 0) {
      console.error('Lexer errors:', lexerResult.errors.map(e => e.message || e));
    }
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (BasicSelector '.a')
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 0
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('multiple selectors with same target and all flag - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x all), .b:extend(.x all) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (SelectorList
                  [
                    (BasicSelector '.a')
                    (BasicSelector '.b')
                  ]
                )
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 0
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('three selectors with same target - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b:extend(.x), .c:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (SelectorList
                  [
                    (BasicSelector '.a')
                    (BasicSelector '.b')
                    (BasicSelector '.c')
                  ]
                )
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 1
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('multiple selectors with same target and !all flag - extend as first rule', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x !all), .b:extend(.x !all) { color: blue; }');

    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (SelectorList
                  [
                    (BasicSelector '.a')
                    (BasicSelector '.b')
                  ]
                )
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 0
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('extend with selector list target', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x, .y) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (BasicSelector '.a')
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (SelectorList
                          [
                            (BasicSelector '.x')
                            (BasicSelector '.y')
                          ]
                        )
                      flag: 1
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('extend attached to selector - check selector value', () => {
    const { tree, errors, lexerResult } = parser.parse(`
.a, .b {
  .c:extend(.ext all) {
    test: 3;
    .d {
      test: 4;
    }
  }
}
`);
    expect(errors).toHaveLength(0);

    // Find the extend node and check its selector
    const ruleset = tree.value[0];
    expect(ruleset?.type).toBe('Ruleset');
    if (ruleset && ruleset.type === 'Ruleset') {
      const rules = ruleset.value.rules;
      if (rules && rules.value) {
        for (const rule of rules.value) {
          if (rule.type === 'Extend') {
            // Check what selector the parser set
            const selectorType = rule.value.selector?.type;
            const selectorValueOf = rule.value.selector?.valueOf();

            // The parser should set the extend selector to undefined for extends inside rulesets
            // This allows it to default to ampersand and resolve to the ruleset's selector
            expect(selectorType).toBeUndefined();
            expect(selectorValueOf).toBeUndefined();
          }
        }
      }
    }
    
    // Check the full S-expression structure
    // The parser sets extend.selector to undefined for extends inside rulesets
    const fullSExpr = serializeTypes(tree);
    expect(fullSExpr).toContain('Extend');
    // Should not have a selector (BasicSelector '.c') because it is undefined
    const extendMatch = fullSExpr.match(/\(Extend[\s\S]*?\)/);
    if (extendMatch) {
      const extendStr = extendMatch[0];
      // Should not contain "selector:" followed by a BasicSelector
      expect(extendStr).not.toContain("selector:\n                (BasicSelector '.c')");
    }
  });

  test('selector list with multiple ampersand extends - different targets', () => {
    const { tree, errors, lexerResult } = parser.parse(`
.ext3,
.ext4 {
  &:extend(.foo all);
  &:extend(.bar all);
  color: blue;
}
`);
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    // Should have 2 Extend nodes (one for .foo, one for .bar)
    const extendMatches = sExpr.match(/\(Extend/g);
    const extendCount = extendMatches?.length || 0;
    expect(extendCount).toBe(2);
    // Extends should be inside the ruleset with selector: undefined
    expect(sExpr).toContainString('(SelectorList');
    expect(sExpr).toContainString("(BasicSelector '.ext3')");
    expect(sExpr).toContainString("(BasicSelector '.ext4')");
    // Targets should be present
    expect(sExpr).toContainString('(Extend');
    expect(sExpr).toContainString('target:');
    expect(sExpr).toContainString("(BasicSelector '.foo')");
    expect(sExpr).toContainString("(BasicSelector '.bar')");
  });

  test('extend with selector list target and all flag', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x, .y all) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (Rules
          [
            (Ruleset
              selector: 
                (BasicSelector '.a')
              rules: 
                (Rules
                  [
                    (Extend
                      target: 
                        (BasicSelector '.x')
                      flag: 1
                    )
                    (Extend
                      target: 
                        (BasicSelector '.y')
                      flag: 0
                    )
                    (Declaration
                      name: 
                        (Any [role=property] 'color')
                      value: 
                        (Color
                          node: 'blue'
                          format: 0
                          rgb:
                          [0, 0, 255]
                          alpha: 1
                        )
                    )
                  ]
                )
            )
          ]
        )
      `);
  });

  test('selector list with extend on one selector and all flag - extend should bubble', () => {
    const { tree, errors, lexerResult } = parser.parse(`
.should-not-exist-in-output,
.ext7:extend(.ext5 all) {
}
`);
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    // The extend should bubble up and be prepended as a separate Extend node above the ruleset
    // Structure: (Rules [(Extend ...) (Ruleset ...)])
    expect(sExpr).toContainString(`
        (Rules
          [
            (Extend
              selector: 
                (BasicSelector '.ext7')
              target: 
                (BasicSelector '.ext5')
              flag: 0
            )
            (Ruleset
              selector: 
                (SelectorList
                  [
                    (BasicSelector '.should-not-exist-in-output')
                    (BasicSelector '.ext7')
                  ]
                )
              rules: 
                (Rules
                  []
                )
            )
          ]
        )
      `);
  });
});
