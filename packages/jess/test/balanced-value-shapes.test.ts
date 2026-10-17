import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/*
 * Well-formed values SCSS and `.jess` used to stop on now parse (ledger P45,
 * owner 2026-10-09), and the compile reports what the dialect rejects or
 * cannot give meaning to (owner 2026-10-16: "the point of parsing valid CSS
 * isn't that we're obligated to actually accept everything. Jess/Less apply
 * diagnostics like a linter / syntax checker"); an error fails the compile.
 */
type Dialect = 'css' | 'scss' | 'jess';

async function compile(dialect: Dialect, source: string) {
  return new Compiler({}).renderToResult({ source, filePath: `/proj/values.${dialect}` }, { suppressWarnings: true });
}

/* A `*` or `/` with nothing on its left is a punctuation-led value (ledger P33), reported where it starts. */
describe('a value led by a separator fails the compile', () => {
  it.each([
    ['scss', '.x {\n  a: *[.a, .b];\n}\n', 6, '*'],
    ['jess', '.x {\n  a: *[.a, .b];\n}\n', 6, '*'],
    ['scss', '$t: * [.notice];\n.x { a: $t; }\n', 5, '*'],
    ['jess', '$t: * [.notice];\n.x { a: $t; }\n', 5, '*'],
    ['scss', '.x {\n  background: /img/icon.svg;\n}\n', 15, '/'],
    ['jess', '.x {\n  background: /img/icon.svg;\n}\n', 15, '/']
  ] as const)('%s: %j', async (dialect, source, column, operator) => {
    const result = await compile(dialect, source);
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.phase, error.column, error.message])).toEqual([
      ['parse/leading-separator-value', 'parse', column, `A value cannot start with "${operator}".`]
    ]);
  });
});

/* Outside `$( … )` a `*` is no operator in `.jess`: a delim between two values, written as css writes it. */
it('jess: a `*` between two values is written as css writes it', async () => {
  const source = 'a {\n  x: a * b;\n  y: 2 * 3;\n  z: 2*[3];\n}\n';
  const [jess, css] = await Promise.all([compile('jess', source), compile('css', source)]);
  expect(jess.errors).toEqual([]);
  expect(jess.css).toBe(css.css);
  expect(jess.css).toContain('z: 2 * [3];');
});

/* Sass reads `&` in a value as the parent selector; Jess has no value for it, so it is an error there. */
it.each([
  '.btn {\n  content: &;\n}\n',
  '.btn {\n  content: selector-append(&, "-b");\n}\n'
])('scss: the parent selector in a value fails the compile: %j', async (source) => {
  const result = await compile('scss', source);
  expect(result.css).toBe('');
  expect(result.errors.map(error => [error.code, error.line])).toEqual([['parse/unsupported-parent-selector-value', 2]]);
});
