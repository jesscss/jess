import { describe, expect, it } from 'vitest';
import { Parser } from '../src/index.js';

const parser = new Parser();

type ParseCase = {
  name: string;
  src: string;
};

function expectParseOk({ src }: ParseCase) {
  const result = parser.parse(src);
  expect(result.lexerResult.errors.map(error => error.message)).toEqual([]);
  expect(result.errors.map(error => error.message)).toEqual([]);
  expect(result.tree).toBeDefined();
}

const cases: ParseCase[] = [
  { name: 'basic CSS', src: '.a { color: red; }' },
  { name: 'class selector', src: '.foo { color: red; }' },
  { name: 'compound selector', src: '.foo.bar { color: red; }' },
  { name: 'nested ruleset', src: '.parent { color: red; .child { color: blue; } }' },
  { name: 'ampersand parent selector', src: '.a { &:hover { color: red; } }' },
  { name: 'hex color value', src: '.a { color: #ff0000; }' },
  { name: 'quoted string', src: '.a { content: "hello"; }' },
  { name: 'function call value', src: '.a { background: rgb(255, 0, 0); }' },
  { name: 'var() value', src: '.a { color: var(--primary); }' },
  { name: 'custom property declaration', src: '.a { --color: #333; }' },
  { name: 'calc() value', src: '.a { width: calc(100% - 2px); }' },
  { name: '$(expr) arithmetic expression', src: '.a { width: $(1 + 2); }' },
  { name: '@media rule', src: '@media (min-width: 768px) { .a { color: red; } }' },
  { name: '@supports rule', src: '@supports (display: grid) { .a { display: grid; } }' },
  { name: '$var declaration', src: '$color: red;' },
  { name: '$var declaration with dimension', src: '$size: 16px;' },
  { name: '$var used as CSS value', src: '.a { color: $primary; }' },
  { name: '$var property access', src: '.a { color: $theme.primary; }' },
  { name: '$var index access', src: '.a { color: $colors[0]; }' },
  { name: '$var method call', src: '.a { color: $map.get(primary, secondary); }' },
  { name: 'bare $var statement at root', src: '$foo;' },
  { name: 'mixin definition', src: 'clearfix() { overflow: hidden; }' },
  { name: 'mixin with parameters', src: 'button($bg, $color) { background: $bg; color: $color; }' },
  { name: 'mixin with default parameter value', src: 'mixin($x: 1px, $y: blue) { width: $x; color: $y; }' },
  { name: 'dot-prefixed mixin name', src: '.clearfix() { overflow: hidden; }' },
  { name: 'nested mixin definition inside ruleset', src: '.ns { .mixin() { color: red; } }' },
  { name: 'mixin with guard', src: 'size($n) when ($n > 0) { width: $(n)px; }' },
  { name: 'mixin call', src: '$ > .clearfix();' },
  { name: 'chained mixin call', src: '$ > #ns > .mixin();' },
  { name: 'mixin call with arguments', src: '$ > .button(red, white);' },
  { name: '@-compose import', src: '@-compose "./base.jess";' },
  { name: '@-compose import with namespace', src: '@-compose "./theme.jess" as theme;' },
  { name: '@-export import', src: '@-export "./mixins.jess";' },
  { name: '@-from namespace import', src: '@-from "./tokens.js" import * as tokens;' },
  { name: '@-from named imports (parens)', src: '@-from "./tokens.js" import ( primary, secondary );' },
  { name: '@-from named imports (braces)', src: '@-from "./tokens.js" import { primary, secondary };' },
  { name: '$if condition', src: '$if ($theme = dark) { .a { color: white; } }' },
  { name: '$if / $else', src: '$if ($x > 0) { .a { color: red; } } $else { .a { color: blue; } }' },
  { name: '$for loop', src: '$for ($i in $items) { .item { color: red; } }' },
  { name: 'collection literal', src: '$colors: { primary: #333; secondary: #666; };' },
  { name: 'collection with multiple entries', src: '$theme: { primary: red; secondary: blue; accent: green; };' }
];

describe('jess-parser (parse only)', () => {
  for (const testCase of cases) {
    it(`parses ${testCase.name}`, () => {
      expectParseOk(testCase);
    });
  }
});
