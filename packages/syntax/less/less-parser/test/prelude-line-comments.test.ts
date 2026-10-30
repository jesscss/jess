import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/less-parser';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { triviaMapOf } from '../../../../core/src/ast/provenance.js';

/*
 * A Less `//` line comment is trivia in a `@supports selector(...)` argument,
 * which is a selector, so it never reaches the CSS. Other general-enclosed
 * content keeps a `//` as written: a custom property's `//` is value text
 * (ledger F13). An address is never a comment: the argument of `url(` and of
 * the `@document` URL-matching functions `url-prefix(` and `domain(`.
 */
describe('Less line comments in at-rule preludes', () => {
  it('keeps a line comment inside `@supports selector(...)` out of the output', () => {
    const source = '@supports selector(\n  :focus-visible // *"a"\n) { a { color: red; } }';
    const document = parse(source);
    const comments = triviaMapOf(document)
      ?.commentRuns()
      .map(run => source.slice(run.start, run.end));
    const rendered = serialize(document).css;

    expect(comments).toContain('// *"a"');
    expect(rendered).not.toContain('//');
    expect(rendered).toContain('@supports selector(\n  :focus-visible \n)');
  });

  it('keeps a `//` as written in other general-enclosed content', () => {
    const source = [
      '@supports (--x: //c) { .a { b: c; } }',
      '@supports font(url(//cdn.example.com/a.woff)) { .b { c: d; } }'
    ].join('\n');
    const rendered = serialize(parse(source)).css;

    expect(rendered).toContain('@supports (--x: //c)');
    expect(rendered).toContain('@supports font(url(//cdn.example.com/a.woff))');
  });

  it('reads the `@document` URL-matching functions\' argument as an address', () => {
    const source = [
      '@document url-prefix(http://example.com/) { .a { color: green; } }',
      '@-moz-document domain(example.com), url(http://example.com/b), url-prefix("http://example.com/c") { .b { color: green; } }',
      '@-moz-document url-prefix() { .c { color: green; } }'
    ].join('\n');
    const rendered = serialize(parse(source)).css;

    expect(rendered).toContain('@document url-prefix(http://example.com/) {');
    expect(rendered).toContain('@-moz-document domain(example.com), url(http://example.com/b), url-prefix("http://example.com/c") {');
    expect(rendered).toContain('@-moz-document url-prefix() {');
  });
});
