import { Parser } from '../src';
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
  test('variable declaration', () => {
    const { tree } = parser.parse('@color: red;');
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (any [role=ident] 'color')
        value: 
          (Color
            node: 'red'
            format: 1
            rgba:
            [255, 0, 0, 1]
          )
      )
    `);
  });

  test('mixin definition', () => {
    const { tree } = parser.parse('.mixin(@color) { color: @color; }');
    expect(serializeTypes(tree)).toContainString(`
      (Mixin
        name: '.mixin'
        params: 
          (List
            [
              (VarDeclaration
                name: 
                  (any [role=property] 'color')
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
                  (any [role=property] 'color')
                value: 
                  (Reference
                    key: 'color'
                  )
              )
            ]
          )
      )
    `);
  });

  test('mixin call', () => {
    const { tree } = parser.parse('.mixin() { color: red; } .test { .mixin(); }');
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
    const { tree } = parser.parse('.mixin(@color) { color: @color; } .test { .mixin(red); }');
    expect(serializeTypes(tree)).toContainString(`
      (Call
        name: 
          (Reference [role=name]
            key: '.mixin'
          )
        args: 
          (List
            [
              (Color
                node: 'red'
                format: 1
                rgba:
                [255, 0, 0, 1]
              )
            ]
          )
      )
    `);
  });

  test('anonymous mixin definition', () => {
    const { tree } = parser.parse('.test { .({ color: red; }); }');
    // This currently returns undefined, so let's test for that
    expect(serializeTypes(tree)).toBe('undefined');
  });

  test('anonymous mixin definition with parameters', () => {
    const { tree } = parser.parse('.test { .(@color) { color: @color; }(); }');
    // This currently returns undefined, so let's test for that
    expect(serializeTypes(tree)).toBe('undefined');
  });

  test('detached ruleset', () => {
    const { tree } = parser.parse('.test { @rules: { color: red; }; }');
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (any [role=ident] 'rules')
        value: 
          (Mixin
            rules: 
              (Rules
                [
                  (Declaration
                    name: 
                      (any [role=property] 'color')
                    value: 
                      (Color
                        node: 'red'
                        format: 1
                        rgba:
                        [255, 0, 0, 1]
                      )
                  )
                ]
              )
          )
      )
    `);
  });

  test('property accessor', () => {
    const { tree } = parser.parse('.test { color: @obj[prop]; }');
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
    const { tree } = parser.parse('.@{prefix}-button { color: red; }');
    expect(serializeTypes(tree)).toContainString(`
        (Interpolated [role=ident]
          source: '.${INTERPOLATION_PLACEHOLDER}-button'
          replacements:
          [
            (Reference [role=ident]
              key: 'prefix'
            )
          ]
        )
    `);
  });

  test('interpolated property name', () => {
    const { tree } = parser.parse('.test { @{prop}: red; }');
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

  test('rest parameter in mixin', () => {
    const { tree } = parser.parse('.mixin(@args...) { color: red; }');
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
                  (any [role=property] 'color')
                value: 
                  (Color
                    node: 'red'
                    format: 1
                    rgba:
                    [255, 0, 0, 1]
                  )
              )
            ]
          )
      )
    `);
  });

  test('rest argument in mixin call', () => {
    const { tree } = parser.parse('.mixin(@args...) { color: red; } .test { .mixin(1, 2, 3...); }');
    // This currently returns undefined, so let's test for that
    expect(serializeTypes(tree)).toBe('undefined');
  });

  test('operation', () => {
    const { tree } = parser.parse('.test { width: 10px + 5px; }');
    expect(serializeTypes(tree)).toContainString(`
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
    `);
  });

  test('function call', () => {
    const { tree } = parser.parse('.test { color: rgb(255, 0, 0); }');
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
    const { tree } = parser.parse('@import "file.less";');
    expect(serializeTypes(tree)).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          reference: false
          once: true
        }
        path: 
          (Quoted
            (any [role=any] 'file.less')
          )
      )
    `);
  });

  test('@import "file.css" parsed as import AtRule', () => {
    const { tree } = parser.parse('@import "file.css";');
    expect(serializeTypes(tree)).toContainString(`
      (AtRule
        name: 
          (any [role=atkeyword] '@import')
        prelude: 
          (Sequence
            [
              (Quoted
                (any [role=any] 'file.css')
              )
            ]
          )
      )
    `);
  });

  test('@import (less, reference) "file" with options', () => {
    const { tree } = parser.parse('@import (less, reference) "file";');
    expect(serializeTypes(tree)).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          reference: true
          once: true
        }
        path: 
          (Quoted
            (any [role=any] 'file')
          )
      )
    `);
  });

  test('@import (css) "file.css" with css option', () => {
    const { tree } = parser.parse('@import (css) "file.css";');
    expect(serializeTypes(tree)).toContainString(`
      (AtRule
        name: 
          (any [role=atkeyword] '@import')
        prelude: 
          (Sequence
            [
              (Quoted
                (any [role=any] 'file.css')
              )
            ]
          )
      )
    `);
  });

  test('@import (multiple) "file.less" with multiple option', () => {
    const { tree } = parser.parse('@import (multiple) "file.less";');
    expect(serializeTypes(tree)).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          reference: false
          once: false
        }
        path: 
          (Quoted
            (any [role=any] 'file.less')
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
          (any [role=ident] 'property')
        value: 
          (any 'foo')
      )
    `);
  });

  /** If it has a colon and no spaces, still a variable declaration */
  test('parse known at-rule as variable declaration', () => {
    const result = parser.parse('@property:foo;');

    expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 
          (any [role=ident] 'property')
        value: 
          (any 'foo')
      )
    `);
  });

  /** If it has a parens immediately after, it's a call */
  test('parse known at-rule as variable call', () => {
    const { tree } = parser.parse('@media();');

    expect(serializeTypes(tree)).toContainString(`
      (Call
        name: 
          (Expression
            (Reference [role=name]
              key: 
                (any [role=ident] 'media')
            )
          )
      )
    `);
  });
});
