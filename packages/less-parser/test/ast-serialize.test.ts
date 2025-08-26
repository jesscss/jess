import { Parser } from '../src';
import { serializeTypes } from '@jesscss/core';

const parser = new Parser();

describe('serializeTypes coverage', () => {
  test('variable declaration', () => {
    const { tree } = parser.parse('@color: red;');
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 
          (any [role=ident] 'color')
        value: 
          (any 'red')
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
              (any 'red')
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
                      (any 'red')
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
        source: '.{}-button'
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
      (Declaration
        name: 
          (Interpolated [role=ident]
            source: '{}'
            replacements:
            [
              (Reference [role=ident]
                key: 'prop'
              )
            ]
          )
        value: 
          (any 'red')
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
                  (any 'red')
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

  test('import with url', () => {
    const { tree } = parser.parse('@import url("file.less");');
    expect(serializeTypes(tree)).toContainString(`
      (StyleImport
        path: 
          (Quoted
            (any [role=urlvalue] '')
          )
      )
    `);
  });

  test('import with string', () => {
    const { tree } = parser.parse('@import "file.less";');
    expect(serializeTypes(tree)).toContainString(`
      (StyleImport
        path: 
          (Quoted
            (any [role=urlvalue] 'file.less')
          )
      )
    `);
  });
});
