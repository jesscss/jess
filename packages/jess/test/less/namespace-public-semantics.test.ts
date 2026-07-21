import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function parseAndRender(source: string): Promise<string> {
  const compiler = new Compiler({ output: { collapseNesting: true } });
  const context = compiler.createContext('entry.less');
  const parsed = await context.parseString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });

  expect(parsed.node.type).toBe('Stylesheet');
  expect(context.document).toBe(parsed.node);
  return compiler.renderString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });
}

describe('Less namespace semantic contracts through the public AST route', () => {
  it('renders ordered property merge references', async () => {
    await expect(parseAndRender(`
      .out {
        box-shadow+: inset 0 0 1px red;
        box-shadow+: 0 0 2px blue;
        background+: red;
        background+: blue;
      }
    `)).resolves.toBe(
      '.out {\n  box-shadow: inset 0 0 1px red, 0 0 2px blue;\n  background: red, blue;\n}\n'
    );
  });

  it('dispatches every matching guarded namespace definition in source order', async () => {
    await expect(parseAndRender(`
      @namespaceGuard: 1;
      #guarded when (@namespaceGuard > 0) { #deeper { .mixin() { guarded: namespace; } } }
      #guarded() when (@namespaceGuard > 0) { #deeper { .mixin() { silent: namespace; } } }
      #guarded(@variable: default) when (@namespaceGuard > 0) { #deeper { .mixin() { guarded: with default; } } }
      #guarded-caller { #guarded > #deeper > .mixin(); }
    `)).resolves.toBe(
      '#guarded-caller {\n  guarded: namespace;\n  silent: namespace;\n  guarded: with default;\n}\n'
    );
  });

  it('dispatches nested and compound namespace paths', async () => {
    await expect(parseAndRender(`
      #theme { .dark { .colors() { color: cyan; } } }
      #panel.dark.navbar { .colors() { background: red; } }
      #ns() { .leaf() { width: 1px; } }
      .parameterized { color: ruleset; }
      .parameterized(@color) { color: @color; }
      .a { #theme > .dark > .colors(); }
      .b { #panel > .dark > .navbar > .colors(); }
      .c { #ns > .leaf(); }
      .d { .parameterized(blue); }
    `)).resolves.toBe(
      '.parameterized {\n  color: ruleset;\n}\n.a {\n  color: cyan;\n}\n.b {\n  background: red;\n}\n.c {\n  width: 1px;\n}\n.d {\n  color: blue;\n}\n'
    );
  });

  it('keeps only a namespaced terminal ruleset out of parameterized dispatch', async () => {
    await expect(parseAndRender(`
      #theme {
        .dark {
          .button { color: ruleset; }
          .button(@color) { color: @color; }
        }
      }
      .entry { #theme > .dark > .button(red); }
    `)).resolves.toBe(
      '#theme .dark .button {\n  color: ruleset;\n}\n.entry {\n  color: red;\n}\n'
    );
  });

  it('still uses an outer namespaced ruleset as a container before terminal dispatch', async () => {
    await expect(parseAndRender(`
      #theme {
        .button { color: ruleset; }
        .button(@color) { color: @color; }
      }
      .entry { #theme > .button(red); }
    `)).resolves.toBe(
      '#theme .button {\n  color: ruleset;\n}\n.entry {\n  color: red;\n}\n'
    );
  });

  it('keeps interpolated namespace paths and sibling collapsed rulesets distinct', async () => {
    await expect(parseAndRender(`
      @a1: foo;
      @a2: ~".foo";
      @a4: ~"#foo";
      .b .bb {
        &.@{a1}-xxx .yyy-@{a1}@{a4} { & @{a2}.bbb { b: 1; } }
      }
      mi-test-b { .b.bb.foo-xxx.yyy-foo#foo.foo.bbb(); }
      @c1: @a1;
      @c2: bar;
      @c3: baz;
      #@{c1}-foo { > .@{c2} { .@{c3} { c: c; } } }
      mi-test-c {
        &-1 { #foo-foo(); }
        &-2 { #foo-foo > .bar(); }
        &-3 { #foo-foo > .bar.baz(); }
      }
      .Person(@name, @gender_) {
        .@{name} {
          @gender: @gender_;
          .sayGender() { gender: @gender; }
        }
      }
      mi-test-d { .Person(person, "Male"); .person.sayGender(); }
    `)).resolves.toBe(
      '.b .bb.foo-xxx .yyy-foo#foo .foo.bbb {\n  b: 1;\n}\n'
      + 'mi-test-b {\n  b: 1;\n}\n'
      + '#foo-foo > .bar .baz {\n  c: c;\n}\n'
      + 'mi-test-c-1 > .bar .baz {\n  c: c;\n}\n'
      + 'mi-test-c-2 .baz {\n  c: c;\n}\n'
      + 'mi-test-c-3 {\n  c: c;\n}\n'
      + 'mi-test-d {\n  gender: "Male";\n}\n'
    );
  });

  it('keeps interpolated rules published by separate mixin calls in their own call frames', async () => {
    await expect(parseAndRender(`
      .make(@name, @tone) {
        .generated-@{name} {
          @local-tone: @tone;
          .emit() { color: @local-tone; }
        }
      }
      .first { .make(first, red); .generated-first.emit(); }
      .second { .make(second, blue); .generated-second.emit(); }
    `)).resolves.toBe(
      '.first {\n  color: red;\n}\n.second {\n  color: blue;\n}\n'
    );
  });
});
