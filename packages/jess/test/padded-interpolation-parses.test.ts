import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Well-formed input parses in every dialect (ledger P45). Each source below is
 * balanced and tokenizes; each stopped the parse.
 */
type Extension = '.css' | '.scss' | '.jess';

const render = async (source: string, extension: Extension): Promise<string> =>
  new Compiler({}).renderString(source, { extension });

describe('scss: whitespace inside an interpolation or a paren list', () => {
  /* Dart Sass 1.101.7 writes each of these. */
  it.each([
    ['glued to text on both sides', '$dir: Up;\n.a { animation-name: fade#{ $dir }In; }', '.a {\n  animation-name: fadeUpIn;\n}\n'],
    ['inside a string', '$label: Close;\n.a { content: "#{ $label }"; }', '.a {\n  content: "Close";\n}\n']
  ])('%s', async (_label, source, css) => {
    await expect(render(source, '.scss')).resolves.toBe(css);
  });

  /* Padding inside the parentheses or brackets and before the comma changes nothing. */
  it.each([
    ['($sans, $fallback)', '( $sans , $fallback )'],
    ['[$sans, $fallback]', '[ $sans , $fallback ]']
  ])('a comma list written %s and %s', async (unpadded, padded) => {
    const variables = '$sans: Helvetica;\n$fallback: sans-serif;\n';
    const css = await render(`${variables}.a { font-family: ${unpadded}; }`, '.scss');
    await expect(render(`${variables}.a { font-family: ${padded}; }`, '.scss')).resolves.toBe(css);
  });

  /* A string keeps its spaces next to an interpolation wherever it stands. */
  it('a string with two interpolations in an attribute selector', async () => {
    await expect(render('$state: is open;\n$part: menu;\n[data-v="#{$state} #{$part}"] { b: c; }', '.scss'))
      .resolves.toBe('[data-v="is open menu"] {\n  b: c;\n}\n');
  });

  /* A quoted value in a container feature is a value, not an operator. */
  it('a quoted value in a container feature', async () => {
    await expect(render('$f: font-family;\n@container (#{$f}: "Inter") { .a { b: c; } }', '.scss'))
      .resolves.toBe('@container (font-family: "Inter") {\n  .a {\n    b: c;\n  }\n}\n');
  });
});

describe('.jess: a supports selector() and an interpolated pseudo argument', () => {
  it('a quoted `)` in a supports selector()', async () => {
    const css = await render('@supports selector([data-state=")"]) { .a { b: c; } }', '.css');
    await expect(render('@supports selector([data-state=")"]) { .a { b: c; } }', '.jess')).resolves.toBe(css);
  });

  /* A `<general-enclosed>` function is written as authored (ledger N14); scss and `.jess` dropped the padding after its `(`. */
  it.each(['.scss', '.jess'] as const)('%s: a padded supports selector() is written as `.css` writes it', async (extension) => {
    const source = '$part: title;\n@supports selector( .card > .card-${part} ) { .a { b: c; } }';
    const css = await render('@supports selector( .card > .card-title ) { .a { b: c; } }', '.css');
    await expect(render(extension === '.scss' ? source.replace('${part}', '#{$part}') : source, extension)).resolves.toBe(css);
  });

  /* A padded general-enclosed group is written as `.css` writes it. */
  it.each(['.scss', '.jess'] as const)('%s: a padded supports group', async (extension) => {
    const css = await render('@supports ( --fancy: 1 ) or ( font-tech: color-colrv1 ) { .a { b: c; } }', '.css');
    await expect(render('@supports ( --fancy: 1 ) or ( font-tech: color-colrv1 ) { .a { b: c; } }', extension)).resolves.toBe(css);
  });

  /* A `//` comment in a `:not()` list is trivia, as anywhere in a `.jess` selector. */
  it('a line comment in a :not() list', async () => {
    const css = await render('.btn:not(.is-disabled, .is-busy) { b: c; }', '.jess');
    await expect(render('.btn:not(.is-disabled // never clickable\n, .is-busy) { b: c; }', '.jess')).resolves.toBe(css);
  });

  /* Ledger P21: an interpolated member of a selector pseudo's argument writes what its resolved spelling writes. */
  it.each([
    ['the whole argument', '.btn:not(button) { b: c; }', '$tag: button;\n.btn:not(${tag}) { b: c; }'],
    ['a class member', '.btn:not(.is-disabled) { b: c; }', '$state: is-disabled;\n.btn:not(.${state}) { b: c; }'],
    ['after a combinator', '.card:has(> .card-title) { b: c; }', '$part: title;\n.card:has(> .card-${part}) { b: c; }']
  ])('%s', async (_label, literal, interpolated) => {
    const css = await render(literal, '.jess');
    await expect(render(interpolated, '.jess')).resolves.toBe(css);
  });
});

describe('.jess: padding inside `${…}`', () => {
  /* Padding inside the braces changes nothing, wherever `${…}` stands. */
  it.each([
    ['a selector', '$size: lg;\n.btn-${size} { b: c; }', '$size: lg;\n.btn-${ size } { b: c; }'],
    ['a property name', '$property: display;\n.a { ${property}: grid; }', '$property: display;\n.a { ${ property }: grid; }'],
    ['a string', '$label: Close;\n.a { content: "${label}"; }', '$label: Close;\n.a { content: "${ label }"; }'],
    ['a custom property value', '$size: 2rem;\n.a { --gap: ${size}; }', '$size: 2rem;\n.a { --gap: ${ size }; }'],
    ['a query feature name', '$dimension: width;\n@media (min-${dimension}: 600px) { .a { b: c; } }', '$dimension: width;\n@media (min-${ dimension }: 600px) { .a { b: c; } }'],
    ['a computed key', '$key: label;\n$label: Close;\n.a { content: "${[$key]}"; }', '$key: label;\n$label: Close;\n.a { content: "${ [$key] }"; }'],
    ['a comment', '$size: lg;\n.btn-${size} { b: c; }', '$size: lg;\n.btn-${ /* lg or sm */ size } { b: c; }']
  ])('in %s', async (_label, unpadded, padded) => {
    const css = await render(unpadded, '.jess');
    await expect(render(padded, '.jess')).resolves.toBe(css);
  });
});

describe('scss: a CSS import condition and a comment in a paren list', () => {
  /* An interpolated name writes what the literal name writes (Dart Sass 1.101.7 agrees). */
  it('an interpolated declaration name in an import supports()', async () => {
    const css = await render('@import "a.css" supports(display: grid);', '.scss');
    await expect(render('$property: display;\n@import "a.css" supports(#{$property}: grid);', '.scss')).resolves.toBe(css);
  });

  /* A starred name is well-formed and still parses (ledger P45), written as authored. */
  it('a starred declaration name in an import supports()', async () => {
    await expect(render('@import "a.css" supports(*zoom: 1);', '.scss')).resolves.toBe('@import "a.css" supports(*zoom: 1);\n');
  });

  /* A comment before a list comma is trivia, as css reads it there (Dart Sass 1.101.7 agrees). */
  it('a block comment before a comma in parentheses', async () => {
    const variables = '$sans: Helvetica;\n$fallback: sans-serif;\n';
    const css = await render(`${variables}.a { font-family: ($sans, $fallback); }`, '.scss');
    await expect(render(`${variables}.a { font-family: ( $sans /* primary */ , $fallback ); }`, '.scss')).resolves.toBe(css);
  });
});
