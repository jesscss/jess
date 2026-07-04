import { Context, serializeTypes, N, isNode, type Node } from '@jesscss/core';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Parser } from '../src/index.js';
import { resolveLessTestDataRoot } from './test-data.js';

function atRulePrelude(n: Node | string | undefined): any {
  if (!isNode(n, N.AtRule)) {
    throw new Error('Expected an at-rule');
  }
  return n.prelude;
}

const parser = new Parser();
const parse = parser.parse;
const testData = resolveLessTestDataRoot();

describe('importAtRule', () => {
  it('should parse @import with url', () => {
    const { errors } = parse('@import "file.css";', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @import with url() function', () => {
    const { errors } = parse('@import url("file.css");', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @import with options', () => {
    const { errors } = parse('@import (reference) "file.less";', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('keeps a CSS @import media-query tail (not just the path)', () => {
    const { errors, tree } = parse('@import "test.css" screen, print;', 'Stylesheet');
    expect(errors.length).toBe(0);
    expect(tree.toString()).toBe('@import "test.css" screen, print;\n');
  });
});

describe('innerAtRule', () => {
  it('should parse @media inside rule', () => {
    const { errors } = parse('.test { @media screen { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @supports inside rule', () => {
    const { errors } = parse('.test { @supports (display: flex) { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('layerName', () => {
  it('should parse @layer with name', () => {
    const { errors } = parse('@layer theme { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @layer with variable in name', () => {
    const { errors } = parse('@layer @var { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('keyframesName', () => {
  it('should parse @keyframes with identifier', () => {
    const { errors } = parse('@keyframes name { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @keyframes with variable in name', () => {
    const { errors } = parse('@keyframes @var { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('mediaInParens', () => {
  it('should parse media query in parentheses', () => {
    const { errors } = parse('@media (min-width: 500px) { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse escaped string in media query', () => {
    const { errors } = parse('@media ~"screen" { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('unwraps an escaped-string media query to its literal content on eval', async () => {
    const { errors, tree } = parse('@media ~"screen" { a { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('@media screen {');
    expect(String(evald)).not.toContain('~"screen"');
  });

  it('keeps an escaped-string media query atomic across embedded spaces/parens', async () => {
    const { errors, tree } = parse(
      '@media ~"screen and (min-width: 400px)" { a { color: red; } }',
      'Stylesheet'
    );
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('@media screen and (min-width: 400px) {');
  });

  it('should parse variable media query at top level', () => {
    const { errors, tree } = parse('@media @breakpoint, print { }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(AtRule\n          nestable: true');
    expect(out).toContainString('\'@media\'');
    expect(out).toContainString('\'@media\'');
    expect(out).toContainString('(List\n            value:');
    expect(out).toContainString('(Reference [role=ident]');
    expect(out).toContainString('type: \'index\'');
    expect(out).toContainString('role: \'ident\'');
    expect(out).toContainString('key: \'breakpoint\'');
    expect(out).toContainString('(QueryCondition');
  });

  it('should parse namespaced reference media query at top level', () => {
    const { errors, tree } = parse('@media #ns.breakpoint(.valToGet[])[@max] { }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(AtRule\n          nestable: true');
    expect(out).toContainString('(Expression\n            value:');
    expect(out).toContainString('(Reference\n                  type: \'variable\'');
    expect(out).toContainString('(Call\n                    name:');
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('role: \'name\'');
    expect(out).toContainString('key:\n                          [\'#ns\', \'.breakpoint\']');
    expect(atRulePrelude(tree.rules[0])?.value?.target?.name?.rawKey?.toString()).toBe('#ns.breakpoint');
  });

  it('should parse simple bare variable media query at top level as indexed reference', () => {
    const { errors, tree } = parse('@media @breakpoint { }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(AtRule');
    expect(out).toContainString('nestable: true');
    expect(out).toContainString('\'@media\'');
    expect(out).toContainString('\'@media\'');
    expect(out).toContainString('(Reference [role=ident]');
    expect(out).toContainString('type: \'index\'');
    expect(out).toContainString('key: \'breakpoint\'');
  });
});

describe('mfValue', () => {
  it('should parse media feature value', () => {
    const { errors } = parse('@media (width: 500px) { }', 'Stylesheet');
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

    const { errors, tree } = parse(source, 'Stylesheet');

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
    const { errors, tree } = parse(source, 'Stylesheet');

    expect(errors.length).toBe(0);

    const context = new Context();
    const evald = await tree.eval(context);

    expect(evald.toString({ context })).toBe(expected);
  });
});

describe('exportAtRule', () => {
  it('should parse @-export with path', () => {
    const { errors } = parse('@-export "./theme.jess";', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @-export with namespace', () => {
    const { errors } = parse('@-export "./theme.jess" as theme;', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @-export with url()', () => {
    const { errors } = parse('@-export url("./theme.jess");', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});
