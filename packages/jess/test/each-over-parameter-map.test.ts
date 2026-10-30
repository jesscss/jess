import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * A map that reaches `@each` / `each()` / `$for` through a mixin or function
 * parameter iterates its entries, as the same map read directly does. A
 * parameter binds an eager snapshot of its argument, and a variable read of one
 * takes the map the snapshot carries (core `snapshot-binding.ts`). SCSS
 * expectations are Dart Sass 1.101.7's output (Jess writes no blank line
 * between rules).
 */
const render = async (source: string, extension: '.scss' | '.less' | '.jess'): Promise<string> =>
  new Compiler().renderString(source, { extension });

const scss = (source: string): Promise<string> => render(source, '.scss');

describe('scss: @each over a parameter map', () => {
  it('two names over a mixin parameter', async () => {
    await expect(scss('@mixin m($map) { @each $k, $v in $map { #{$k}: $v; } }\nx { @include m((foo: bar, baz: qux)); }\n'))
      .resolves.toBe('x {\n  foo: bar;\n  baz: qux;\n}\n');
  });

  it('two names over a mixin parameter bound to a map variable', async () => {
    await expect(scss('$m: (foo: bar, baz: qux);\n@mixin m($map) { @each $k, $v in $map { #{$k}: $v; } }\nx { @include m($m); }\n'))
      .resolves.toBe('x {\n  foo: bar;\n  baz: qux;\n}\n');
  });

  it('one name iterates once per entry, as the map read directly does', async () => {
    const direct = await scss('x { @each $v in (foo: bar, baz: qux) { a: $v; } }\n');
    await expect(scss('@mixin m($map) { @each $v in $map { a: $v; } }\nx { @include m((foo: bar, baz: qux)); }\n'))
      .resolves.toBe(direct);
  });

  /* One name over any map binds the entry's value, not its `key value` pair. */
  it.fails('one name binds each entry as its key value pair', async () => {
    await expect(scss('@mixin m($map) { @each $v in $map { a: $v; } }\nx { @include m((foo: bar, baz: qux)); }\n'))
      .resolves.toBe('x {\n  a: foo bar;\n  a: baz qux;\n}\n');
  });

  it('two names in a @function with @return (sass-spec libsass-closed-issues/issue_577)', async () => {
    await expect(scss('@use "sass:list";\n@function map-each($map) { $values: (); @each $key, $value in $map { $values: list.append($values, $value); } @return $values; }\n$map: (foo: bar);\n.foo { content: map-each($map); }\n'))
      .resolves.toBe('.foo {\n  content: bar;\n}\n');
  });

  it('keys of a literal map argument in a @function', async () => {
    await expect(scss('@use "sass:list";\n@function keys-of($map) { $r: (); @each $k, $v in $map { $r: list.append($r, $k); } @return $r; }\nx { a: keys-of((foo: bar, baz: qux)); }\n'))
      .resolves.toBe('x {\n  a: foo baz;\n}\n');
  });

  it('a list parameter iterates its items', async () => {
    await expect(scss('$x: 1px;\n@mixin m($list) { @each $v in $list { a: $v; } }\nx { @include m($x 2px); }\ny { @include m((a, b, c)); }\n'))
      .resolves.toBe('x {\n  a: 1px;\n  a: 2px;\n}\ny {\n  a: a;\n  a: b;\n  a: c;\n}\n');
  });

  it('a map passed through two levels of mixin', async () => {
    await expect(scss('@mixin inner($map) { @each $k, $v in $map { #{$k}: $v; } }\n@mixin outer($map) { @include inner($map); }\nx { @include outer((foo: bar, baz: qux)); }\n'))
      .resolves.toBe('x {\n  foo: bar;\n  baz: qux;\n}\n');
  });

  it('a map.merge(...) argument, to a mixin and to a @function', async () => {
    await expect(scss('@use "sass:list";\n@use "sass:map";\n$base: (foo: bar);\n'
      + '@mixin m($map) { @each $k, $v in $map { #{$k}: $v; } }\n'
      + '@function keys-of($map) { $r: (); @each $k, $v in $map { $r: list.append($r, $k); } @return $r; }\n'
      + 'x { @include m(map.merge($base, (baz: qux))); }\ny { a: keys-of(map.merge($base, (baz: qux))); }\n'))
      .resolves.toBe('x {\n  foo: bar;\n  baz: qux;\n}\ny {\n  a: foo baz;\n}\n');
  });

  it('a function receives the parameter as the map', async () => {
    await expect(scss('@use "sass:list";\n@use "sass:map";\n@mixin m($map) { n: list.length($map); k: map.keys($map); }\nx { @include m((foo: bar, baz: qux)); }\n'))
      .resolves.toBe('x {\n  n: 2;\n  k: foo, baz;\n}\n');
  });
});

describe('less: each() over a mixin parameter', () => {
  it('a detached ruleset, inline or through a variable and two levels of mixin', async () => {
    await expect(render('.m(@rules) { each(@rules, { @{key}: @value; }); }\n@map: { foo: bar; baz: qux; }\n'
      + 'x { .m({ foo: bar; baz: qux; }); }\ny { .m(@map); }\n.outer(@r) { .m(@r); }\nz { .outer(@map); }\n', '.less'))
      .resolves.toBe('x {\n  foo: bar;\n  baz: qux;\n}\ny {\n  foo: bar;\n  baz: qux;\n}\nz {\n  foo: bar;\n  baz: qux;\n}\n');
  });
});

describe('.jess: $for over a collection parameter', () => {
  it('value and key names, through a variable and inline', async () => {
    await expect(render('.m($map) { $for ($v, $k of $map) { .k-${k} { v: $v; } } }\n$m: #{ foo: bar; baz: qux; };\n'
      + '.x { $ > .m($m); }\n.y { $ > .m(#{ foo: bar; baz: qux; }); }\n', '.jess'))
      .resolves.toBe('.x {\n  .k-foo {\n    v: bar;\n  }\n  .k-baz {\n    v: qux;\n  }\n}\n'
        + '.y {\n  .k-foo {\n    v: bar;\n  }\n  .k-baz {\n    v: qux;\n  }\n}\n');
  });

  it('a value name', async () => {
    await expect(render('.one($map) { $for ($v of $map) { .v { v: $v; } } }\n.z { $ > .one(#{ foo: bar; baz: qux; }); }\n', '.jess'))
      .resolves.toBe('.z {\n  .v {\n    v: bar;\n  }\n  .v {\n    v: qux;\n  }\n}\n');
  });
});
