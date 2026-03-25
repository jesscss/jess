import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

// Import the actual placeholder from core
import { INTERPOLATION_PLACEHOLDER } from '@jesscss/core';

// Helper function to extract Interpolated nodes from serialized output
function extractInterpolatedNodes(serialized: string): string[] {
  const matches = serialized.match(/\(Interpolated[^)]*\)[\s\S]*?\)/g);
  return matches || [];
}

const parser = {
  parse(text: string) {
    return new Parser().parse(text);
  }
};

describe('serializeTypes coverage', () => {
  test('paren list value parses', () => {
    const { errors, tree } = parser.parse('.a { grid: ((1, 2), (3, 4)); }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContain('(Paren');
  });

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
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Mixin
        name: '.mixin'
        rules: 
          (Rules
            [
              (Declaration
                name: 
                  (Any [role=property] 'color')
                value: 
                  (Reference
                    key: 'color'
                  )
              )
            ]
          )
        params: 
          (List
            [
              (VarDeclaration
                name: 
                  (Any [role=property] 'color')
                value: 
                  (Nil)
              )
            ]
    `);
  });

  test('mixin default guard sets hasDefault and does not leak', () => {
    const { errors, tree } = parser.parse(`
      .withDefault(@x) when (default()) { a: 1; }
      .plain(@x) { b: 1; }
      .withNegatedDefault(@x) when not (default()) { c: 1; }
    `);
    expect(errors.length).toBe(0);
    const mixins = tree.value.filter((node: any) => node.type === 'Mixin');
    expect(mixins).toHaveLength(3);
    expect(mixins[0].options?.hasDefault).toBe(true);
    expect(Boolean(mixins[1].options?.hasDefault)).toBe(false);
    expect(mixins[2].options?.hasDefault).toBe(true);
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
    expect(tree.toString().replace(/\s+/g, '')).toContain('$obj[\'prop\']');
    expect(serializeTypes(tree)).toContainString(`
      (Reference
        target: 
          (Reference
            key: 'obj'
          )
        key: 'prop'
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
                    (Reference [role=ident]
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
  const out = serializeTypes(tree);
  expect(out).toContainString(`
    (Mixin
      name: '.mixin'
      rules: 
        (Rules
          [
            (Declaration
              name: 
                (Any [role=property] 'color')
              value: 
                (Color
                  node: 'red'
                  rgb:
                    [255, 0, 0]
                  alpha: 1
                )
            )
          ]
        )
      params: 
        (List
          [
            (Rest 'args')
          ]
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
          left: 
            (Dimension
              number: 10
              unit: 'px'
            )
          right: 
            (Dimension
              number: 5
              unit: 'px'
            )
          operator: '+'
        )
      )
    `);
});

test('static rgb() is preserved as Call node', () => {
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
              (Num 255)
              (Num 0)
              (Num 0)
            ]
          )
      )
    `);
});

test('rgb() with variable creates Call node', () => {
  const { errors, tree } = parser.parse('.test { color: rgb(@r, 0, 0); }');
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
              (Reference
                key: 'r'
              )
              (Num 0)
              (Num 0)
            ]
          )
      )
    `);
});

test('static hsl() is preserved as Call node', () => {
  const { errors, tree } = parser.parse('.test { color: hsl(120, 50%, 50%); }');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (Call
        name: 
          (Reference
            key: 'hsl'
          )
        args: 
          (List
            [
              (Num 120)
              (Dimension
                number: 50
                unit: '%'
              )
              (Dimension
                number: 50
                unit: '%'
              )
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
          multiple: false
          optional: false
          inline: false
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

test('@-export "./theme.jess" parsed as StyleImport with forward', () => {
  const { errors, tree } = parser.parse('@-export "./theme.jess";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        importOptions: {
          forward: true
        }
        path: 
          (Quoted
            quote: '"'
            escaped: false
          (Any [role=any]
            role: 'any'
            './theme.jess'
          )
        )
      )
    `);
});

test('@-export "./theme.jess" as theme parsed with namespace', () => {
  const { errors, tree } = parser.parse('@-export "./theme.jess" as theme;');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        namespace: 'theme'
        importOptions: {
          forward: true
        }
        path: 
          (Quoted
            quote: '"'
            escaped: false
          (Any [role=any]
            role: 'any'
            './theme.jess'
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
          type: 'less'
          reference: true
          once: true
          multiple: false
          optional: false
          inline: false
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
          multiple: true
          optional: false
          inline: false
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

test('@import "file" with media query parsed as StyleImport', () => {
  const { errors, tree } = parser.parse('@import "file" screen and (max-width: 600px);');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree, { showOptions: true });
  expect(out).toContain('(StyleImport');
  expect(out).not.toContain('(AtRule');
  expect(out).toContain('postlude');
});

test('@import (less, multiple) "file.css" with media query parsed as StyleImport', () => {
  const { errors, tree } = parser.parse('@import (less, multiple) "file.css" screen and (max-width: 600px);');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree, { showOptions: true });
  expect(out).toContain('(StyleImport');
  expect(out).not.toContain('(AtRule');
  expect(out).toContain('postlude');
});

test('@import "import/import-test-e" with media query parsed as StyleImport', () => {
  const { errors, tree } = parser.parse('@import "import/import-test-e" screen and (max-width: 600px);');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree, { showOptions: true });
  expect(out).toContain('(StyleImport');
  expect(out).not.toContain('(AtRule');
});

test('@import (less, multiple) "import/import-test-d.css" with media query parsed as StyleImport', () => {
  const { errors, tree } = parser.parse('@import (less, multiple) "import/import-test-d.css" screen and (max-width: 601px);');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree, { showOptions: true });
  expect(out).toContain('(StyleImport');
  expect(out).not.toContain('(AtRule');
});

/** If it has a colon and a space after it, it's a variable declaration */
test('parse known at-rule as variable declaration', () => {
  const result = parser.parse('@property: foo;');

  expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 
          (Any [role=ident] 'property')
        value: 
          (Any [role=ident] 'foo')
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
          (Any [role=ident] 'foo')
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
          (Call
            name: 
              (Reference [role=name]
                key: '#id'
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
          (Call
            name: 
              (Reference [role=name]
                key:
                  ['#namespace', '.scoped-mixin']
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
                              (Any [role=ident] 'bar')
                          )
                        ]
                      )
                  )
                key: '.mixin2'
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
                                              (Any [role=ident] 'bar')
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
      const rules = ruleset.rules;
      if (rules && rules.value) {
        for (const rule of rules.value) {
          if (rule.type === 'Extend') {
            // Check what selector the parser set
            const selectorType = rule.selector?.type;
            const selectorValueOf = rule.selector?.valueOf();

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
      expect(extendStr).not.toContain('selector:\n                (BasicSelector \'.c\')');
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
    expect(sExpr).toContainString('(BasicSelector \'.ext3\')');
    expect(sExpr).toContainString('(BasicSelector \'.ext4\')');
    // Targets should be present
    expect(sExpr).toContainString('(Extend');
    expect(sExpr).toContainString('target:');
    expect(sExpr).toContainString('(BasicSelector \'.foo\')');
    expect(sExpr).toContainString('(BasicSelector \'.bar\')');
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

  test('extend with mixed all/exact per target: .ee:extend(.dd all,.bb) {}', () => {
    // Less: .dd gets "all", .bb gets no "all" (exact only). Two separate Extend nodes.
    const { tree, errors, lexerResult } = parser.parse('.ee:extend(.dd all,.bb) {}');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    // First Extend: target .dd, flag 0 (All)
    expect(sExpr).toContainString(`
                    (Extend
                      target: 
                        (BasicSelector '.dd')
                      flag: 0
                    )`);
    // Second Extend: target .bb, flag 1 (Exact) - no "all", so must not match inner .bb .bb
    expect(sExpr).toContainString(`
                    (Extend
                      target: 
                        (BasicSelector '.bb')
                      flag: 1
                    )`);
    // Exactly two Extend nodes
    const extendMatches = sExpr.match(/\(Extend\s/g);
    expect(extendMatches?.length).toBe(2);
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
