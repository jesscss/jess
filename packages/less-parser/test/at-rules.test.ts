import { Context, serializeTypes } from '@jesscss/core';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;
const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe('importAtRule', () => {
  it('should parse @import with url', () => {
    const { errors } = parse('@import "file.css";', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @import with url() function', () => {
    const { errors } = parse('@import url("file.css");', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @import with options', () => {
    const { errors } = parse('@import (reference) "file.less";', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('innerAtRule', () => {
  it('should parse @media inside rule', () => {
    const { errors } = parse('.test { @media screen { color: red; } }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @supports inside rule', () => {
    const { errors } = parse('.test { @supports (display: flex) { color: red; } }', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('layerName', () => {
  it('should parse @layer with name', () => {
    const { errors } = parse('@layer theme { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @layer with variable in name', () => {
    const { errors } = parse('@layer @var { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('keyframesName', () => {
  it('should parse @keyframes with identifier', () => {
    const { errors } = parse('@keyframes name { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @keyframes with variable in name', () => {
    const { errors } = parse('@keyframes @var { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('mediaInParens', () => {
  it('should parse media query in parentheses', () => {
    const { errors } = parse('@media (min-width: 500px) { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse escaped string in media query', () => {
    const { errors } = parse('@media ~"screen" { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse variable media query at top level', () => {
    const { errors, tree } = parse('@media @breakpoint, print { }', 'stylesheet');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (AtRule
          nestable: true
        name: 
          (Any [role=atkeyword]
              role: 'atkeyword'
            '@media'
          )
        prelude: 
          (List
            [
              (Reference [role=ident]
                  type: 'index'
                  role: 'ident'
                key: 'breakpoint'
              )
              (QueryCondition
      `);
  });

  it('should parse namespaced reference media query at top level', () => {
    const { errors, tree } = parse('@media #ns.breakpoint(.valToGet[])[@max] { }', 'stylesheet');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (AtRule
          nestable: true
        name: 
          (Any [role=atkeyword]
              role: 'atkeyword'
            '@media'
          )
        prelude: 
          (Expression
            (Reference
                type: 'variable'
              target: 
                (Call
                  name: 
                    (Reference [role=name]
                        type: 'mixin-ruleset'
                        role: 'name'
                      key:
                        ['#ns', '.breakpoint']
                      rawKey: '#ns > .breakpoint'
                    )
      `);
  });

  it('should parse simple bare variable media query at top level as indexed reference', () => {
    const { errors, tree } = parse('@media @breakpoint { }', 'stylesheet');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (AtRule
          nestable: true
        name: 
          (Any [role=atkeyword]
              role: 'atkeyword'
            '@media'
          )
        prelude: 
          (Reference [role=ident]
              type: 'index'
              role: 'ident'
            key: 'breakpoint'
          )
      `);
  });
});

describe('mfValue', () => {
  it('should parse media feature value', () => {
    const { errors } = parse('@media (width: 500px) { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('at-rule prelude comments', () => {
  it('preserves authored comments in evaluated @media and @import preludes', async () => {
    const source = `@media screen /* comment */, print /* another */, handheld {
  body {
    font-size: 12pt;
  }
}

@import "test.css" screen /* comment */, print;
`;

    const { errors, tree } = parse(source, 'stylesheet');

    expect(errors.length).toBe(0);
    expect(tree.toString()).toContain('screen /* comment */, print /* another */, handheld');
    expect(tree.toString()).toContain('@import "test.css" screen /* comment */, print;');

    const context = new Context();
    const evald = await tree.eval(context);

    expect(evald.toString({ context })).toBeString(`
      @import "test.css" screen /* comment */, print;
      @media screen /* comment */, print /* another */, handheld {
        body {
          font-size: 12pt;
        }
      }
    `);
  });

  it('keeps the Less fixture comments after evaluation', async () => {
    const fixture = path.join(testData, 'tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less');
    const expected = readFileSync(
      path.join(testData, 'tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.css'),
      'utf8'
    );
    const source = readFileSync(fixture, 'utf8');
    const { errors, tree } = parse(source, 'stylesheet');

    expect(errors.length).toBe(0);

    const context = new Context();
    const evald = await tree.eval(context);

    expect(evald.toString({ context })).toBe(expected);
  });
});

describe('exportAtRule', () => {
  it('should parse @-export with path', () => {
    const { errors } = parse('@-export "./theme.jess";', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @-export with namespace', () => {
    const { errors } = parse('@-export "./theme.jess" as theme;', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @-export with url()', () => {
    const { errors } = parse('@-export url("./theme.jess");', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});
