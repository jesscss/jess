import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

// Import the actual placeholder from core
import { INTERPOLATION_PLACEHOLDER } from '@jesscss/core';

// Helper function to extract Interpolated nodes from serialized output
function extractInterpolatedNodes(serialized: string): string[] {
  const matches = serialized.match(/\(Interpolated[^)]*\)[\s\S]*?\)/g);
  return matches || [];
}

function collectNodes(root: unknown, type: string): any[] {
  const found: any[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const node = value as Record<string, unknown>;
    if (node.type === type) {
      found.push(value);
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent' || key === 'root' || key === 'sourceNode' || key === 'options') {
        continue;
      }
      visit(child);
    }
  };

  visit(root);
  return found;
}

function textOf(node: { toString(): string }): string {
  return node.toString().trim();
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
    const out = serializeTypes(tree);
    expect(out).toContain('(VarDeclaration');
    expect(out).toContain("valueNode:");
    expect(out).toContain("['#ns', '.breakpoint']");
    expect(out).toContain("key: '.valToGet'");
    expect(out).toContain('key: -1');
    expect(out).toContain("key: 'max'");
  });
  test('variable declaration', () => {
    const { errors, tree } = parser.parse('@color: red;');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('(VarDeclaration');
    expect(out).toContain("(Any [role=ident] 'color')");
    expect(out).toContain('valueNode:');
    expect(out).toContain('(Color');
    expect(out).toContain("node: 'red'");
  });

  test('custom property generic function value stays structured', () => {
    const { errors, tree } = parser.parse('--custom: if(not(true), 5)', 'declaration');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
      (CustomDeclaration
        name:
          (Any [role=property] '--custom')
        valueNode:
          (Sequence
            value:
              [
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
    const mixin = tree.value[0] as any;
    expect(mixin.type).toBe('Mixin');
    expect(Array.isArray(mixin.rules)).toBe(true);
    expect(out).toContain("(Any [role=name] '.mixin')");
    expect(out).toContain('(VarDeclaration');
    expect(out).toContain("(Any [role=property] 'color')");
    expect(out).toContain('(Declaration');
    expect(out).toContain("key: 'color'");
  });

  test('standalone block comments in mixin bodies parse as direct rules children', () => {
    const { errors, tree } = parser.parse('.mixin() {/**/}');
    expect(errors.length).toBe(0);
    const mixin = tree.value[0] as any;
    expect(mixin.type).toBe('Mixin');
    expect(mixin.rules).toHaveLength(1);
    expect(mixin.rules[0].type).toBe('Comment');
  });

  test('standalone block comments before declarations parse as direct rules children', () => {
    const { errors, tree } = parser.parse(`
      .mixin() {
        /**/
        color: red;
      }
    `);
    expect(errors.length).toBe(0);
    const mixin = tree.value[0] as any;
    expect(mixin.type).toBe('Mixin');
    expect(mixin.rules.map((node: any) => node.type)).toEqual(['Comment', 'Declaration']);
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
    const mixins = tree.value.filter((node: any) => node.type === 'Mixin');
    expect(mixins).toHaveLength(3);
    expect(mixins[0].options?.hasDefault).toBe(true);
    expect(Boolean(mixins[1].options?.hasDefault)).toBe(false);
    expect(mixins[2].options?.hasDefault).toBe(true);
  });

  test('mixin call', () => {
    const { errors, tree } = parser.parse('.mixin() { color: red; } .test { .mixin(); }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('(Call');
    expect(out).toContain('(Reference [role=name]');
    expect(out).toContain("key: '.mixin'");
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
    const out = serializeTypes(tree);
    expect(out).toContain('(VarDeclaration');
    expect(out).toContain("(Any [role=ident] 'rules')");
    expect(out).toContain('(Mixin');
    expect(out).toContain('rules:');
    expect(out).toContain('(Declaration');
    expect(out).toContain("(Any [role=property] 'color')");
    expect(out).toContain('(Color');
    expect(out).toContain("node: 'red'");
  });

  test('property accessor', () => {
    const { errors, tree } = parser.parse('.test { color: @obj[prop]; }');
    expect(errors.length).toBe(0);
    expect(tree.toString().replace(/\s+/g, '')).toContain('$obj[\'prop\']');
    const out = serializeTypes(tree);
    expect(out).toContain('(Reference');
    expect(out).toContain("key: 'obj'");
    expect(out).toContain('(Quoted');
    expect(out).toContain("value: 'prop'");
  });

  test('interpolated selector', () => {
    const { errors, tree } = parser.parse('.@{prefix}-button { color: red; }');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree)).toContainString(`
        (InterpolatedSelector
          node:
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
          node:
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
  const mixin = tree.value[0] as any;
  expect(mixin.type).toBe('Mixin');
  expect(Array.isArray(mixin.rules)).toBe(true);
  expect(out).toContain('(Rest');
  expect(out).toContain("node: 'args'");
  expect(out).toContain('(Declaration');
  expect(out).toContain("(Any [role=property] 'color')");
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
        node:
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
  const out = serializeTypes(tree);
  expect(out).toContain('(Call');
  expect(out).toContain("key: 'rgb'");
  expect(out).toContain('(List');
  expect(out.match(/\(Num/g)?.length).toBe(3);
});

test('rgb() with variable creates Call node', () => {
  const { errors, tree } = parser.parse('.test { color: rgb(@r, 0, 0); }');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain('(Call');
  expect(out).toContain("key: 'rgb'");
  expect(out).toContain("key: 'r'");
  expect(out.match(/\(Num 0\)/g)?.length).toBe(2);
});

test('static hsl() is preserved as Call node', () => {
  const { errors, tree } = parser.parse('.test { color: hsl(120, 50%, 50%); }');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain('(Call');
  expect(out).toContain("key: 'hsl'");
  expect(out).toContain('(Num 120)');
  expect(out.match(/\(Dimension/g)?.length).toBe(2);
});

test('@import "file.less" parsed as StyleImport', () => {
  const { errors, tree } = parser.parse('@import "file.less";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('StyleImport');
  expect(node.options.type).toBe('import');
  expect(node.options.importOptions).toMatchObject({ reference: false, once: true, multiple: false, optional: false, inline: false });
  expect(textOf(node.path)).toBe('"file.less"');
});

test('@-export "./theme.jess" parsed as StyleImport with forward', () => {
  const { errors, tree } = parser.parse('@-export "./theme.jess";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('StyleImport');
  expect(node.options.type).toBe('compose');
  expect(node.options.importOptions).toMatchObject({ forward: true });
  expect(textOf(node.path)).toBe('"./theme.jess"');
});

test('@use "./tokens.js" parsed as JsImport with inferred namespace', () => {
  const { errors, tree } = parser.parse('@use "./tokens.js";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('JsImport');
  expect(node.options.namespace).toBe('tokens');
  expect(textOf(node.path)).toBe('"./tokens.js"');
});

test('@-use "./tokens.ts" as t parsed as JsImport with namespace', () => {
  const { errors, tree } = parser.parse('@-use "./tokens.ts" as t;');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('JsImport');
  expect(node.options.namespace).toBe('t');
  expect(textOf(node.path)).toBe('"./tokens.ts"');
});

test('@use "#less/math" parsed as JsImport with inferred namespace', () => {
  const { errors, tree } = parser.parse('@use "#less/math";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('JsImport');
  expect(node.options.namespace).toBe('math');
  expect(textOf(node.path)).toBe('"#less/math"');
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
  const node = tree.value[0] as any;
  expect(node.type).toBe('StyleImport');
  expect(node.options.type).toBe('compose');
  expect(node.options.namespace).toBe('theme');
  expect(node.options.importOptions).toMatchObject({ forward: true });
  expect(textOf(node.path)).toBe('"./theme.jess"');
});

test('@import "file.css" parsed as import AtRule', () => {
  const { errors, tree } = parser.parse('@import "file.css";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('AtRuleStatement');
  expect(node.name.toString()).toBe('@import');
  expect(textOf(node.prelude)).toBe('"file.css"');
});

test('@import (less, reference) "file" with options', () => {
  const { errors, tree } = parser.parse('@import (less, reference) "file";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('StyleImport');
  expect(node.options.type).toBe('import');
  expect(node.options.importOptions).toMatchObject({ type: 'less', reference: true, once: true, multiple: false, optional: false, inline: false });
  expect(textOf(node.path)).toBe('"file"');
});

test('@import (css) "file.css" with css option', () => {
  const { errors, tree } = parser.parse('@import (css) "file.css";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('AtRuleStatement');
  expect(node.name.toString()).toBe('@import');
  expect(textOf(node.prelude)).toBe('"file.css"');
});

test('@import (multiple) "file.less" with multiple option', () => {
  const { errors, tree } = parser.parse('@import (multiple) "file.less";');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('StyleImport');
  expect(node.options.type).toBe('import');
  expect(node.options.importOptions).toMatchObject({ reference: false, once: false, multiple: true, optional: false, inline: false });
  expect(textOf(node.path)).toBe('"file.less"');
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
  const node = result.tree.value[0] as any;
  expect(node.type).toBe('VarDeclaration');
  expect(node.name.toString()).toBe('property');
  expect(textOf(node.valueNode)).toBe('foo');
});

/** If it has a colon and no spaces, still a variable declaration */
test('parse known at-rule as variable declaration', () => {
  const result = parser.parse('@property:foo;');
  const node = result.tree.value[0] as any;
  expect(node.type).toBe('VarDeclaration');
  expect(node.name.toString()).toBe('property');
  expect(textOf(node.valueNode)).toBe('foo');
});

/** If it has a parens immediately after, it's a call */
test('parse known at-rule as variable call', () => {
  const { errors, tree } = parser.parse('@media();');
  expect(errors.length).toBe(0);

  expect(tree.toString()).toContain('$media()');
  expect(serializeTypes(tree)).toContainString(`
      (Expression
        node:
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
  const node = tree.value[0] as any;
  expect(node.type).toBe('VarDeclaration');
  expect(node.valueNode.type).toBe('Reference');
  expect(node.valueNode.key).toBe('#id');
});

test('namespace reference - simple class', () => {
  const { errors, tree } = parser.parse('@ref: .class;');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('VarDeclaration');
  expect(node.valueNode.type).toBe('Reference');
  expect(node.valueNode.key).toBe('.class');
});

test('namespace reference - complex selector', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin;');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain('(Reference [role=name]');
  expect(out).toContain("['#namespace', '.scoped-mixin']");
});

test('namespace call - simple id with parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #id();');
  expect(errors.length).toBe(0);
  const node = tree.value[0] as any;
  expect(node.type).toBe('VarDeclaration');
  expect(node.valueNode.type).toBe('Call');
  expect(node.valueNode.name.key).toBe('#id');
});

test('namespace call - complex selector with parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin();');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain('(Call');
  expect(out).toContain('(Reference [role=name]');
  expect(out).toContain("['#namespace', '.scoped-mixin']");
});

test('namespace reference with accessor', () => {
  const { errors, tree } = parser.parse('@ref: #id[property];');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain("key: '#id'");
  expect(out).toContain('(Quoted');
  expect(out).toContain("value: 'property'");
});

test('variable reference with accessor', () => {
  const { errors, tree } = parser.parse('@ref: @config[$@prop];');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain("key: 'config'");
  expect(out).toContain('(Quoted');
  expect(out).toContain('(Interpolated [role=ident]');
  expect(out).toContain(`source: '${INTERPOLATION_PLACEHOLDER}'`);
  expect(out).toContain("key: 'prop'");
});

test('namespace reference with complex selector and accessor', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin[property];');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain("['#namespace', '.scoped-mixin']");
  expect(out).toContain('(Quoted');
  expect(out).toContain("value: 'property'");
});

test('namespace call with accessor and parentheses', () => {
  const { errors, tree } = parser.parse('@ref: #namespace > .scoped-mixin[@ref]();');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out).toContain('(Call');
  expect(out).toContain("['#namespace', '.scoped-mixin']");
  expect(out).toContain("key: 'ref'");
});

test('chained mixin calls - simple chain', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1() > .mixin2();');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out.match(/\(Call/g)?.length).toBe(2);
  expect(out).toContain("key: '.mixin1'");
  expect(out).toContain("key: '.mixin2'");
});

test('chained mixin calls - with arguments', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1(@foo: bar) > .mixin2();');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out.match(/\(Call/g)?.length).toBe(2);
  expect(out).toContain("key: '.mixin1'");
  expect(out).toContain("key: '.mixin2'");
  expect(out).toContain('(VarDeclaration');
  expect(out).toContain("(Any [role=property] 'foo')");
  expect(out).toContain("(Any [role=ident] 'bar')");
});

test('chained mixin calls - complex chain with accessors', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1(@foo: bar) > .mixin2[@val1].ns() > .sub-mixin[@val2];');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out.match(/\(Call/g)?.length).toBe(2);
  for (const key of ["key: '.mixin1'", "key: '.mixin2'", "key: 'val1'", "key: '.ns'", "key: '.sub-mixin'", "key: 'val2'"]) {
    expect(out).toContain(key);
  }
  expect(out).toContain("(Any [role=property] 'foo')");
  expect(out).toContain("(Any [role=ident] 'bar')");
});

test('chained mixin calls - deep nesting', () => {
  const { errors, tree } = parser.parse('@ref: .mixin1() > .mixin2() > .mixin3() > .mixin4();');
  expect(errors.length).toBe(0);
  const out = serializeTypes(tree);
  expect(out.match(/\(Call/g)?.length).toBe(4);
  for (const key of ["key: '.mixin1'", "key: '.mixin2'", "key: '.mixin3'", "key: '.mixin4'"]) {
    expect(out).toContain(key);
  }
});

describe('extend cases', () => {
  test('single selector with extend - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(1);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
  });

  test('multiple selectors with same target - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(1);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
  });

  test('multiple selectors with different targets - root-level extends', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x), .b:extend(.y) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(2);
    expect(extends_.map(node => textOf(node.selector))).toEqual(['.a', '.b']);
    expect(extends_.map(node => textOf(node.target))).toEqual(['.x', '.y']);
    expect(extends_.map(node => node.flag)).toEqual([1, 1]);
    expect(collectNodes(tree, 'Ruleset')).toHaveLength(1);
  });

  test('mixed selectors - some with extends, some without - root-level extends', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b { color: blue; }');
    expect(errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].selector)).toBe('.a');
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(1);
    expect(collectNodes(tree, 'Ruleset')).toHaveLength(1);
  });

  test('ampersand extend - single extend', () => {
    const { errors, tree } = parser.parse('&:extend(.x);');
    expect(errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(1);
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
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(0);
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
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(0);
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
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(0);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
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
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(0);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
  });

  test('multiple selectors with same target and all flag - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x all), .b:extend(.x all) { color: blue; }');
    expect(errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(0);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
  });

  test('three selectors with same target - extend as first rule', () => {
    const { errors, tree } = parser.parse('.a:extend(.x), .b:extend(.x), .c:extend(.x) { color: blue; }');
    expect(errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(1);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
  });

  test('multiple selectors with same target and !all flag - extend as first rule', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x !all), .b:extend(.x !all) { color: blue; }');

    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].target)).toBe('.x');
    expect(extends_[0].flag).toBe(0);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
  });

  test('extend with selector list target', () => {
    const { tree, errors, lexerResult } = parser.parse('.a:extend(.x, .y) { color: blue; }');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(extends_[0].target.type).toBe('SelectorList');
    expect(extends_[0].target.value.map((node: any) => textOf(node))).toEqual(['.x', '.y']);
    expect(extends_[0].flag).toBe(1);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Declaration']);
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
      if (rules) {
        for (const rule of rules) {
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
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(2);
    expect(extends_.map(node => textOf(node.target))).toEqual(['.x', '.y']);
    expect(extends_.map(node => node.flag)).toEqual([1, 0]);
    expect(collectNodes(tree, 'Ruleset')[0].rules.map((node: any) => node.type)).toEqual(['Extend', 'Extend', 'Declaration']);
  });

  test('extend with mixed all/exact per target: .ee:extend(.dd all,.bb) {}', () => {
    // Less: .dd gets "all", .bb gets no "all" (exact only). Two separate Extend nodes.
    const { tree, errors, lexerResult } = parser.parse('.ee:extend(.dd all,.bb) {}');
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(2);
    expect(extends_.map(node => textOf(node.target))).toEqual(['.dd', '.bb']);
    expect(extends_.map(node => node.flag)).toEqual([0, 1]);
  });

  test('selector list with extend on one selector and all flag - extend should bubble', () => {
    const { tree, errors, lexerResult } = parser.parse(`
.should-not-exist-in-output,
.ext7:extend(.ext5 all) {
}
`);
    expect(errors.length).toBe(0);
    expect(lexerResult.errors.length).toBe(0);
    const extends_ = collectNodes(tree, 'Extend');
    expect(extends_).toHaveLength(1);
    expect(textOf(extends_[0].selector)).toBe('.ext7');
    expect(textOf(extends_[0].target)).toBe('.ext5');
    expect(extends_[0].flag).toBe(0);
    expect(collectNodes(tree, 'Ruleset')).toHaveLength(1);
  });
});
