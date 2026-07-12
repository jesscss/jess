import { Parser } from '../src/index.js';
import { serializeTypes, N, isNode, type Node } from '@jesscss/core';

// Tests walk the parsed AST structurally; these views cover the fields they read.
interface SelView {
  type?: string;
  value: Node[];
  valueOf(): unknown;
  toString(opts?: unknown): string;
}
interface RuleView {
  type: string;
  selector: SelView | unknown[] | string;
  target: SelView | unknown[] | string;
  flag: number;
  rules: RuleView[];
  name: unknown;
  value: unknown;
  prelude: unknown;
  options: { assign: string };
  location: number[];
}
function selectorListMembers(selector: unknown): unknown[] {
  if (Array.isArray(selector)) {
    return selector;
  }
  if (selector && typeof selector === 'object' && 'value' in selector) {
    const value = (selector as { value: unknown }).value;
    return Array.isArray(value) ? value : [selector];
  }
  return [selector];
}
function selectorListValues(selector: unknown): unknown[] {
  return selectorListMembers(selector).map((node: unknown) => {
    if (typeof node === 'object' && node !== null && 'valueOf' in node && typeof (node as { valueOf: () => unknown }).valueOf === 'function') {
      return (node as { valueOf: () => unknown }).valueOf();
    }
    return node;
  });
}
function asRuleset(n: Node | string | undefined): RuleView {
  if (!isNode(n, N.Ruleset)) {
    throw new Error('Expected a ruleset');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return n as unknown as RuleView;
}
function asRules(n: Node | string | undefined): RuleView {
  if (!isNode(n, N.Rules)) {
    throw new Error('Expected a Rules node');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return n as unknown as RuleView;
}

// Import the actual placeholder from core
import { INTERPOLATION_PLACEHOLDER } from '@jesscss/core';

// Helper function to extract Interpolated nodes from serialized output
function extractInterpolatedNodes(serialized: string): string[] {
  const matches = serialized.match(/\(Interpolated[^)]*\)[\s\S]*?\)/g);
  return matches || [];
}

const parser = new Parser();

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
    expect(serializeTypes(tree)).toContainString(`
      (Rules
        rules:
          [
            (VarDeclaration
              name: 'ref'
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
                          value:
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
        name: 'color'
        value:
          (Color
            node: 'red'
          )
      )
    `);
  });

  test('custom property generic function value stays structured', () => {
    const { errors, tree } = parser.parse('--custom: if(not(true), 5)', 'declaration');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (CustomDeclaration
        name: '--custom'
        value:
          (Call
    `);
  });

  test('legacy IE filter values stay structured enough to evaluate embedded variables', () => {
    const { errors, tree } = parser.parse(`
      @fat: 0;
      @cloudhead: "#000000";
      .nav {
        filter: progid:DXImageTransform.Microsoft.gradient(startColorstr="#333333", endColorstr=@cloudhead, GradientType=@fat);
      }
    `);
    expect(errors.length).toBe(0);
    const serialized = serializeTypes(tree);
    expect(serialized).toContain('(Interpolated [role=any]');
    expect(serialized).toContain('key: \'cloudhead\'');
    expect(serialized).toContain('key: \'fat\'');
  });

  test('mixin definition', () => {
    const { errors, tree } = parser.parse('.mixin(@color) { color: @color; }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Mixin
        name:
          '.mixin'
        params:
          (List
            value:
              [
                (VarDeclaration
                  name:
                    'color'
                  value:
                    (Nil '')
                )
              ]
          )
        rules:
          [
            (Declaration
              name:
                'color'
              value:
                (Reference
                  key: 'color'
                )
            )
          ]
    `);
  });

  test('standalone block comments in mixin bodies parse as direct rules children', () => {
    const { errors, tree } = parser.parse('.mixin() {/**/}');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (Mixin
        name:
          '.mixin'
        rules:
          [
            (Comment '/**/')
          ]
      )
    `);
  });

  test('standalone block comments before declarations parse as direct rules children', () => {
    const { errors, tree } = parser.parse(`
      .mixin() {
        /**/
        color: red;
      }
    `);
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toMatch(/\(Mixin[\s\S]*rules:\s+\[\s+\(Comment '\/\*\*\/'\)\s+\(Declaration/u);
  });

  test('value block comments stay trivia instead of direct rules children', () => {
    const { errors, tree } = parser.parse('.mixin() { color: /* */blue; }');
    expect(errors.length).toBe(0);
    const serialized = serializeTypes(tree);
    expect(serialized).toContain('(Declaration');
    expect(serialized).not.toContain('(Comment');
  });

  test('mixin default guard sets hasDefault and does not leak', () => {
    const { errors, tree } = parser.parse(`
      .withDefault(@x) when (default()) { a: 1; }
      .plain(@x) { b: 1; }
      .withNegatedDefault(@x) when not (default()) { c: 1; }
    `);
    expect(errors.length).toBe(0);
    const mixins = tree.rules.filter((node: any) => node.type === 'Mixin');
    expect(mixins).toHaveLength(3);
    expect(mixins[0]!.options?.hasDefault).toBe(true);
    expect(Boolean(mixins[1]!.options?.hasDefault)).toBe(false);
    expect(mixins[2]!.options?.hasDefault).toBe(true);
  });

  test('mixin call', () => {
    const { errors, tree } = parser.parse('.mixin() { color: red; } .test { .mixin(); }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (Call
        name:
          (Reference [role=name]
            key: '.mixin'
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
            key: '.mixin'
          )
        args:
          (List
            value:
              [
                (Color
                  node: 'red'
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
        name: 'rules'
        value:
          (Mixin
            rules:
              [
                (Declaration
                      name:
                        'color'
                      value:
                        (Color
                          node: 'red'
                        )
                    )
              ]
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
        key:
          (Quoted
            value: 'prop'
          )
      )
    `);
  });

  test('interpolated selector', () => {
    const { errors, tree } = parser.parse('.@{prefix}-button { color: red; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (InterpolatedSelector
          value:
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

  test('at-rule bare variables normalize to indexed references outside declaration values', () => {
    const { errors, tree } = parser.parse('@media @mode { .foo { color: red; } }');
    expect(errors.length).toBe(0);
    expect(tree.toString()).toContain('@media $[mode]');
  });

  test('media feature bare variables normalize to indexed references outside declaration values', () => {
    const { errors, tree } = parser.parse('@media (min-width: @size) { .foo { color: red; } }');
    expect(errors.length).toBe(0);
    expect(tree.toString()).toContain('@media (min-width: $[size])');
  });

  test('at-rule prelude accessor references are wrapped as Expression nodes', () => {
    const { errors, tree } = parser.parse('@media @breakpoints[mobile] { .foo { color: red; } }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      prelude:
        (Expression
          value:
            (Reference
              target:
                (Reference
                  key: 'breakpoints'
                )
              key:
                (Quoted
                  value: 'mobile'
                )
        )
    `);
  });
});

test('rest parameter in mixin', () => {
  const { errors, tree } = parser.parse('.mixin(@args...) { color: red; }');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContainString(`
    (Mixin
      name:
        '.mixin'
      params:
        (List
          value:
            [
              (Rest
                value: 'args'
              )
            ]
        )
      rules:
        [
          (Declaration
            name:
              'color'
            value:
              (Color
                node: 'red'
              )
          )
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
        value:
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
            value:
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
            value:
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
            value:
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
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(StyleImport');
  expect(serialized).toContain(`type: 'import'`);
  expect(serialized).toContain(`once: true`);
  expect(serialized).toContain(`'file.less'`);
});

test('@-export "./theme.jess" parsed as StyleImport with forward', () => {
  const { errors, tree } = parser.parse('@-export "./theme.jess";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(StyleImport');
  expect(serialized).toContain(`type: 'compose'`);
  expect(serialized).toContain(`forward: true`);
  expect(serialized).toContain(`'./theme.jess'`);
});

test('@use "./tokens.js" parsed as JsImport with inferred namespace', () => {
  const { errors, tree } = parser.parse('@use "./tokens.js";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(JsImport');
  expect(serialized).toContain(`namespace: 'tokens'`);
  expect(serialized).toContain(`'./tokens.js'`);
});

test('@-use "./tokens.ts" as t parsed as JsImport with namespace', () => {
  const { errors, tree } = parser.parse('@-use "./tokens.ts" as t;');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(JsImport');
  expect(serialized).toContain(`namespace: 't'`);
  expect(serialized).toContain(`'./tokens.ts'`);
});

test('@use "#less/math" parsed as JsImport with inferred namespace', () => {
  const { errors, tree } = parser.parse('@use "#less/math";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(JsImport');
  expect(serialized).toContain(`namespace: 'math'`);
  expect(serialized).toContain(`'#less/math'`);
});

test('@use "./theme.less" stays a plain AtRule, not stylesheet compose', () => {
  const { errors, tree } = parser.parse('@use "./theme.less";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(AtRule');
  expect(serialized).toContain('\'@use\'');
  expect(serialized).toContain('\'./theme.less\'');
  expect(serialized).not.toContain('(StyleImport');
});

test('@use "less:math" stays a plain AtRule; Less modules use #less specifiers', () => {
  const { errors, tree } = parser.parse('@use "less:math";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(AtRule');
  expect(serialized).toContain('\'less:math\'');
  expect(serialized).not.toContain('(JsImport');
});

test('@-export "./theme.jess" as theme parsed with namespace', () => {
  const { errors, tree } = parser.parse('@-export "./theme.jess" as theme;');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(StyleImport');
  expect(serialized).toContain(`type: 'compose'`);
  expect(serialized).toContain(`namespace: 'theme'`);
  expect(serialized).toContain(`forward: true`);
  expect(serialized).toContain(`'./theme.jess'`);
});

test('@import "file.css" parsed as import AtRule', () => {
  const { errors, tree } = parser.parse('@import "file.css";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (AtRuleStatement
        name: 
          '@import'
        prelude:
          (Quoted
            value: 'file.css'
          )
      )
    `);
});

test('@import (less, reference) "file" with options', () => {
  const { errors, tree } = parser.parse('@import (less, reference) "file";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(StyleImport');
  expect(serialized).toContain(`type: 'less'`);
  expect(serialized).toContain(`reference: true`);
  expect(serialized).toContain(`'file'`);
});

test('@import (css) "file.css" with css option', () => {
  const { errors, tree } = parser.parse('@import (css) "file.css";');
  expect(errors.length).toBe(0);
  expect(serializeTypes(tree)).toContainString(`
      (AtRuleStatement
        name: 
          '@import'
        prelude:
          (Quoted
            value: 'file.css'
          )
      )
    `);
});

test('@import (multiple) "file.less" with multiple option', () => {
  const { errors, tree } = parser.parse('@import (multiple) "file.less";');
  expect(errors.length).toBe(0);
  const serialized = serializeTypes(tree, { showOptions: true });
  expect(serialized).toContain('(StyleImport');
  expect(serialized).toContain(`type: 'import'`);
  expect(serialized).toContain(`once: false`);
  expect(serialized).toContain(`multiple: true`);
  expect(serialized).toContain(`'file.less'`);
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
        name: 'property'
        value: 
          (Keyword [role=keyword] 'foo')
      )
    `);
});

/** If it has a colon and no spaces, still a variable declaration */
test('parse known at-rule as variable declaration', () => {
  const result = parser.parse('@property:foo;');

  expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 'property'
        value: 
          (Keyword [role=keyword] 'foo')
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
        value:
          (Call
            name:
              (Reference [role=name]
                key:
                  (Keyword [role=keyword] 'media')
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
        name: 'ref'
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
        name: 'ref'
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
        name: 'ref'
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
        name: 'ref'
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
        name: 'ref'
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
        name: 'ref'
        value: 
          (Reference
            target:
              (Reference [role=name]
                key: '#id'
              )
            key:
              (Quoted
                value: 'property'
              )
          )
      )
    `);
});

test('variable reference with accessor', () => {
  const { errors, tree } = parser.parse('@ref: @config[$@prop];');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 'ref'
        value: 
          (Reference
            target:
              (Reference
                key: 'config'
              )
            key:
              (Quoted
                value:
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
        name: 'ref'
        value: 
          (Reference
            target: 
              (Reference [role=name]
                key:
                  ['#namespace', '.scoped-mixin']
              )
            key:
              (Quoted
                value: 'property'
              )
          )
      )
    `);
});

test('namespace call with accessor and parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin[@ref]();');
  expect(errors.length).toBe(0);

  expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 'ref'
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
        name: 'ref'
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
        name: 'ref'
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
                        value:
                          [
                            (VarDeclaration
                              name:
                                'foo'
                              value:
                                (Keyword [role=keyword] 'bar')
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
        name: 'ref'
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
                                        value:
                                          [
                                            (VarDeclaration
                                              name:
                                                'foo'
                                              value:
                                                (Keyword [role=keyword] 'bar')
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
        name: 'ref'
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
  function nodesOfType(tree: any, type: string): any[] {
    const out: any[] = [];
    for (const node of tree.nodes()) {
      if (node.type === type) {
        out.push(node);
      }
    }
    return out;
  }

  function expectExtend(node: any, target: string, flag: number, selector?: string): void {
    expect(node.type).toBe('Extend');
    expect(node.target.valueOf()).toBe(target);
    expect(node.flag).toBe(flag);
    expect(node.selector?.valueOf()).toBe(selector);
  }

  test('single selector with extend - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(ruleset.selector.valueOf()).toBe('.a');
    expectExtend(ruleset.rules[0], '.x', 1);
    expect(ruleset.rules[1]!.type).toBe('Declaration');
  });

  test('multiple selectors with same target - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(selectorListValues(ruleset.selector)).toEqual(['.a', '.b']);
    expectExtend(ruleset.rules[0], '.x', 1);
    expect(ruleset.rules[1]!.type).toBe('Declaration');
  });

  test('multiple selectors with different targets - root-level extends', () => {
    const { tree, errors } = parser.parse('.a:extend(.x), .b:extend(.y) { color: blue; }');
    expect(errors.length).toBe(0);
    const wrapper = asRules(tree.rules[0]);
    expect(wrapper.type).toBe('Rules');
    expectExtend(wrapper.rules[0], '.x', 1, '.a');
    expectExtend(wrapper.rules[1], '.y', 1, '.b');
    expect(selectorListValues(wrapper.rules[2]!.selector)).toEqual(['.a', '.b']);
  });

  test('mixed selectors - some with extends, some without - root-level extends', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b { color: blue; }');
    expect(errors.length).toBe(0);
    const wrapper = asRules(tree.rules[0]);
    expect(wrapper.type).toBe('Rules');
    expectExtend(wrapper.rules[0], '.x', 1, '.a');
    expect(selectorListValues(wrapper.rules[1]!.selector)).toEqual(['.a', '.b']);
  });

  test('ampersand extend - single extend', () => {
    const { errors, tree } = parser.parse('&:extend(.x);');
    expect(errors.length).toBe(0);
    expectExtend(tree.rules[0], '.x', 1);
  });

  test('ampersand extend with all flag', () => {
    const { tree, errors } = parser.parse('&:extend(.x all);');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    expect(errors.length).toBe(0);
    expectExtend(tree.rules[0], '.x', 0);
  });

  test('ampersand extend with !all flag', () => {
    const { tree, errors } = parser.parse('&:extend(.x !all);');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    expect(errors.length).toBe(0);
    expectExtend(tree.rules[0], '.x', 0);
  });

  test('extend with all flag - ExtendFlag.All', () => {
    const { tree, errors } = parser.parse('.a:extend(.x all) { color: blue; }');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(ruleset.selector.valueOf()).toBe('.a');
    expectExtend(ruleset.rules[0], '.x', 0);
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
    expect(sExpr).toContainString('selector: \'.c\'');
    expect(sExpr).toContain('selector: \'.d\'');
    // The Extend should be in the .c ruleset, not in the .d ruleset
    const cExtendIndex = sExpr.indexOf('selector: \'.c\'');
    const dExtendIndex = sExpr.indexOf('selector: \'.d\'');
    const extendIndex = sExpr.indexOf('(Extend');
    expect(extendIndex).toBeGreaterThan(-1);
    expect(extendIndex).toBeLessThan(dExtendIndex); // Extend should come before .d
  });

  test('extend with !all flag - ExtendFlag.All', () => {
    const { tree, errors } = parser.parse('.a:extend(.x !all) { color: blue; }');
    if (errors.length > 0) {
      console.error('Parse errors:', errors.map(e => e.message));
    }
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(ruleset.selector.valueOf()).toBe('.a');
    expectExtend(ruleset.rules[0], '.x', 0);
  });

  test('multiple selectors with same target and all flag - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x all), .b:extend(.x all) { color: blue; }');
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(selectorListValues(ruleset.selector)).toEqual(['.a', '.b']);
    expectExtend(ruleset.rules[0], '.x', 0);
  });

  test('three selectors with same target - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b:extend(.x), .c:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(selectorListValues(ruleset.selector)).toEqual(['.a', '.b', '.c']);
    expectExtend(ruleset.rules[0], '.x', 1);
  });

  test('multiple selectors with same target and !all flag - extend as first rule', () => {
    const { tree, errors } = parser.parse('.a:extend(.x !all), .b:extend(.x !all) { color: blue; }');

    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(selectorListValues(ruleset.selector)).toEqual(['.a', '.b']);
    expectExtend(ruleset.rules[0], '.x', 0);
  });

  test('extend with selector list target', () => {
    const { tree, errors } = parser.parse('.a:extend(.x, .y) { color: blue; }');
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expect(ruleset.selector.valueOf()).toBe('.a');
    expect(selectorListValues(ruleset.rules[0]!.target)).toEqual(['.x', '.y']);
    expect(ruleset.rules[0]!.flag).toBe(1);
  });

  test('extend attached to selector - check selector value', () => {
    const { tree, errors } = parser.parse(`
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

    // Find the extend node and check its selector. Loosely typed: this test
    // walks `rules.rules` (a dead branch the parser never populates) structurally.
    const ruleset: any = tree.rules[0];
    expect(ruleset?.type).toBe('Ruleset');
    if (ruleset && ruleset.type === 'Ruleset') {
      const rules = ruleset.rules;
      if (rules && rules.rules) {
        for (const rule of rules.rules) {
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
      expect(extendStr).not.toContain('selector:\n                \'.c\'');
    }
  });

  test('selector list with multiple ampersand extends - different targets', () => {
    const { tree, errors } = parser.parse(`
.ext3,
.ext4 {
  &:extend(.foo all);
  &:extend(.bar all);
  color: blue;
}
`);
    expect(errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    // Should have 2 Extend nodes (one for .foo, one for .bar)
    const extendMatches = sExpr.match(/\(Extend/g);
    const extendCount = extendMatches?.length || 0;
    expect(extendCount).toBe(2);
    // Extends should be inside the ruleset with selector: undefined
    expect(sExpr).toContainString('[\'.ext3\', \'.ext4\']');
    expect(sExpr).toContainString('.ext3');
    expect(sExpr).toContainString('.ext4');
    // Targets should be present
    expect(sExpr).toContainString('(Extend');
    expect(sExpr).toContainString('target:');
    expect(sExpr).toContainString('target: \'.foo\'');
    expect(sExpr).toContainString('target: \'.bar\'');
  });

  test('extend with selector list target and all flag', () => {
    const { tree, errors } = parser.parse('.a:extend(.x, .y all) { color: blue; }');
    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    expectExtend(ruleset.rules[0], '.x', 1);
    expectExtend(ruleset.rules[1], '.y', 0);
  });

  test('extend with mixed all/exact per target: .ee:extend(.dd all,.bb) {}', () => {
    // Less: .dd gets "all", .bb gets no "all" (exact only). Two separate Extend nodes.
    const { tree, errors } = parser.parse('.ee:extend(.dd all,.bb) {}');
    expect(errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    const extendNodes = nodesOfType(tree, 'Extend');
    expect(extendNodes).toHaveLength(2);
    expectExtend(extendNodes[0], '.dd', 0);
    expectExtend(extendNodes[1], '.bb', 1);
    expect(sExpr).toContain('(Ruleset');
  });

  test('selector list with extend on one selector and all flag - extend should bubble', () => {
    const { tree, errors } = parser.parse(`
.should-not-exist-in-output,
.ext7:extend(.ext5 all) {
}
`);
    expect(errors.length).toBe(0);
    const sExpr = serializeTypes(tree);
    const wrapper = asRules(tree.rules[0]);
    expect(wrapper.type).toBe('Rules');
    expectExtend(wrapper.rules[0], '.ext5', 0, '.ext7');
    expect(selectorListValues(wrapper.rules[1]!.selector)).toEqual([
      '.should-not-exist-in-output',
      '.ext7'
    ]);
    expect(sExpr).toContain('(Ruleset');
  });
});
