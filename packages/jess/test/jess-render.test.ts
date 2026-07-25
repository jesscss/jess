import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../src/index.js';

describe('Jess parser plugin render-through', () => {
  it('routes `.jess` through Context into the AST-v2 serializer', async () => {
    const compiler = new Compiler();
    const context = compiler.createContext('entry.jess');
    const parsed = await context.parseString('.entry { color: red; }', {
      filePath: 'entry.jess',
      extension: '.jess',
    });

    expect(parsed.node.type).toBe('Stylesheet');
    expect(context.document).toBe(parsed.node);
    await expect(compiler.renderString('.entry { color: red; }', {
      filePath: 'entry.jess',
      extension: '.jess',
    })).resolves.toContain('color: red');
  });

  it('renders bare-truth $if bodies and $apply through the public AST route', async () => {
    const css = await new Compiler().renderString(
      '.paint { color: red; } .entry { $if (true) { $apply .paint; } }',
      { filePath: 'entry.jess', extension: '.jess' },
    );

    expect(css).toBe('.paint {\n  color: red;\n}\n.entry {\n  color: red;\n}\n');
  });

  it('preserves repeated output from the core $apply operation', async () => {
    const css = await new Compiler().renderString(
      '.paint { color: red; } .entry { $apply .paint; $apply .paint; }',
      { filePath: 'entry.jess', extension: '.jess' },
    );

    expect(css).toBe('.paint {\n  color: red;\n}\n.entry {\n  color: red;\n  color: red;\n}\n');
  });

  it('merges every matching plain ruleset without entering parameterized mixin dispatch', async () => {
    const css = await new Compiler().renderString(
      '.paint { color: red; } .paint { background: blue; } paint() { border: 1px solid; } .entry { $apply .paint; $apply paint; }',
      { filePath: 'entry.jess', extension: '.jess' },
    );

    expect(css).toBe(
      '.paint {\n  color: red;\n}\n.paint {\n  background: blue;\n}\n.entry {\n  color: red;\n  background: blue;\n}\n',
    );
  });

  it('renders documented $for bindings and exclusive ranges through the Jess plugin', async () => {
    const css = await new Compiler().renderString(
      '$items: red, blue; $for ($item, $key, $counter of $items) { .item-${key}-${counter} { color: $item; } } $for ($i of 1 to <3) { .range-${i} { order: $i; } }',
      { filePath: 'entry.jess', extension: '.jess' },
    );

    expect(css).toBe(
      '.item-1-1 {\n  color: red;\n}\n.item-2-2 {\n  color: blue;\n}\n.range-1 {\n  order: 1;\n}\n.range-2 {\n  order: 2;\n}\n'
    );
  });

  it('renders documented collection member and list-index references through the Jess plugin', async () => {
    const css = await new Compiler().renderString(
      '$theme: { colors: { primary: #06c; }; }; $sizes: 10px, 20px, 30px; .entry { color: $theme.colors.primary; first: $sizes[0]; padding: $sizes[-1]; }',
      { filePath: 'entry.jess', extension: '.jess' },
    );

    expect(css).toBe('.entry {\n  color: #06c;\n  first: 10px;\n  padding: 30px;\n}\n');
  });

  // A stylesheet-defined function is a value-position lambda bound to a `$name`.
  // Argument binding is the SAME path a named mixin call uses (positional, named,
  // defaults, arity), and the yielded value is the FINAL `result:` assignment.
  it('renders stylesheet-defined functions through the public Jess route', async () => {
    const render = async (source: string): Promise<string> =>
      new Compiler().renderString(source, { filePath: 'entry.jess', extension: '.jess' });

    // The documented shape, verbatim.
    expect(await render('$foo: @($arg1, $arg2) > {\n  result: bar;\n}\n\n.box {\n  output: $foo(1, 2);\n}'))
      .toBe('.box {\n  output: bar;\n}\n');
    // Positional binding, then the same call by NAME, then a param default.
    expect(await render('$add: @($a, $b) > { result: $($a + $b); } .box { w: $add(1px, 2px); }'))
      .toBe('.box {\n  w: 3px;\n}\n');
    expect(await render('$add: @($a, $b) > { result: $($a + $b); } .box { w: $add($b: 2px, $a: 1px); }'))
      .toBe('.box {\n  w: 3px;\n}\n');
    expect(await render('$add: @($a, $b: 10px) > { result: $($a + $b); } .box { w: $add(1px); }'))
      .toBe('.box {\n  w: 11px;\n}\n');
    // The single-expression body.
    expect(await render('$f: @() > $(1 + 2); .box { v: $f(); }')).toBe('.box {\n  v: 3;\n}\n');
    // No early return: the LAST `result:` assignment wins.
    expect(await render('$f: @() > {\n  $if(true) {\n    result: one;\n  }\n  result: two;\n}\n.box { v: $f(); }'))
      .toBe('.box {\n  v: two;\n}\n');
  });

  // A function is an ordinary value, so it can be passed to another function and
  // called there — the arg binds BY REFERENCE rather than byte-flattening.
  it('passes a function as a value and calls it', async () => {
    const render = async (source: string): Promise<string> =>
      new Compiler().renderString(source, { filePath: 'entry.jess', extension: '.jess' });

    expect(await render('$twice: @($fn, $v) > { result: $fn($fn($v)); }\n$inc: @($n) > { result: $($n + 1); }\n.box { v: $twice($inc, 1); }'))
      .toBe('.box {\n  v: 3;\n}\n');
    // A bare `$name` is just a variable that happens to hold a function.
    expect(await render('$inc: @($n) > { result: $($n + 1); }\n$alias: $inc;\n.box { v: $alias(1); }'))
      .toBe('.box {\n  v: 2;\n}\n');
  });

  it('reports an arity mismatch on a function call rather than emitting the raw call', async () => {
    await expect(new Compiler().renderString(
      '$f: @($a, $b) > { result: 1; } .box { v: $f(1); }',
      { filePath: 'entry.jess', extension: '.jess' },
    )).rejects.toThrow(/arity/i);
  });

  describe('parent selector', () => {
    const nested = async (source: string): Promise<string> =>
      new Compiler().renderString(source, { filePath: 'entry.jess', extension: '.jess' });
    const flat = async (source: string): Promise<string> =>
      new Compiler({ output: { collapseNesting: true } })
        .renderString(source, { filePath: 'entry.jess', extension: '.jess' });

    it('resolves selector-reference `&` exactly as the CSS Nesting spec does', async () => {
      expect(await flat('.a { & { color: red; } }')).toBe('.a {\n  color: red;\n}\n');
      expect(await flat('.a { &:hover { color: red; } }')).toBe('.a:hover {\n  color: red;\n}\n');
      expect(await flat('.a { &.mod { color: red; } }')).toBe('.a.mod {\n  color: red;\n}\n');
      expect(await flat('.a { & + & { color: red; } }')).toBe('.a + .a {\n  color: red;\n}\n');
      expect(await flat('.a { & > .b { color: red; } }')).toBe('.a > .b {\n  color: red;\n}\n');
      expect(await flat('.a { .b & { color: red; } }')).toBe('.b .a {\n  color: red;\n}\n');
      expect(await flat('.a { [foo]& { color: red; } }')).toBe('[foo].a {\n  color: red;\n}\n');
      expect(await flat('.a { :not(&) { color: red; } }')).toBe(':not(.a) {\n  color: red;\n}\n');
      // An omitted `&` is the descendant relation, same as an authored `& .b`.
      expect(await flat('.a { .b { color: red; } }')).toBe('.a .b {\n  color: red;\n}\n');
    });

    it('wraps a comma-list parent in `:is()` wherever `&` is a selector reference', async () => {
      // `:is()` takes the max specificity of its arguments, which is why the
      // whole parent list is wrapped ONCE rather than distributed per branch.
      expect(await flat('.a, #b { & .c { color: red; } }')).toBe(':is(.a, #b) .c {\n  color: red;\n}\n');
      expect(await flat('.a, #b { & + & { color: red; } }')).toBe(':is(.a, #b) + :is(.a, #b) {\n  color: red;\n}\n');
      expect(await flat('.a, #b { &.c { color: red; } }')).toBe(':is(.a, #b).c {\n  color: red;\n}\n');
      expect(await flat('.a, #b { .c & { color: red; } }')).toBe('.c :is(.a, #b) {\n  color: red;\n}\n');
      // A `:not(…)` argument recurses instead: the parent list goes in BARE, so
      // the result is not the De-Morgan-wrong `:not(.a), :not(#b)`.
      expect(await flat('.a, #b { :not(&) { color: red; } }')).toBe(':not(.a, #b) {\n  color: red;\n}\n');
      // A whole-branch `&` substitutes bare, so the parent list is preserved.
      expect(await flat('.a, #b { & { color: red; } }')).toBe('.a,\n#b {\n  color: red;\n}\n');
    });

    it('concatenates the parent NAME for a glued identifier suffix and its `&(X)` spelling', async () => {
      expect(await flat('.block { &__el { color: red; } }')).toBe('.block__el {\n  color: red;\n}\n');
      expect(await flat('.block { &--mod { color: red; } }')).toBe('.block--mod {\n  color: red;\n}\n');
      expect(await flat('.button { &-primary { color: red; } }')).toBe('.button-primary {\n  color: red;\n}\n');
      // `&(X)` is the explicit spelling of the same append: `&(-1)` renders what
      // Less's `&-1` renders, which `.jess` rejects because `-1` is no identifier.
      expect(await flat('.button { &(-1) { color: red; } }')).toBe('.button-1 {\n  color: red;\n}\n');
      expect(await flat('.button { &(1) { color: red; } }')).toBe('.button1 {\n  color: red;\n}\n');
      // A name concatenation DISTRIBUTES per parent — it never wraps in `:is()`.
      expect(await flat('.a, .b { &(-1) { color: red; } }')).toBe('.a-1,\n.b-1 {\n  color: red;\n}\n');
      expect(await flat('.a, .b { &__el { color: red; } }')).toBe('.a__el,\n.b__el {\n  color: red;\n}\n');
      // A glued `${…}` template is one atom, so it distributes too.
      expect(await flat('$t: primary; .a, .b { &-${t} { color: red; } }'))
        .toBe('.a-primary,\n.b-primary {\n  color: red;\n}\n');
    });

    it('rejects a `&` suffix that is not an identifier, and the at-root template', async () => {
      for (const source of ['.a { &-1 { color: red; } }', '.a { &1 { color: red; } }', '.a { &() { color: red; } }', '.a { &(\'\') { color: red; } }', '.a { &(nil) { color: red; } }']) {
        await expect(new Compiler().renderString(source, { filePath: 'entry.jess', extension: '.jess' }))
          .rejects.toThrow(/Jess parser error/);
      }
    });

    it('preserves `&` verbatim in the default nested output until a boundary collapses', async () => {
      // `.jess` output is nested by DEFAULT. `&` only resolves where a boundary
      // is collapsed, so the authored form survives to the emitted CSS.
      expect(await nested('.a { &:hover { color: red; } }'))
        .toBe('.a {\n  &:hover {\n    color: red;\n  }\n}\n');
      expect(await nested('.a, #b { & + & { color: red; } }'))
        .toBe('.a,\n#b {\n  & + & {\n    color: red;\n  }\n}\n');
      expect(await nested('.a { :not(&) { color: red; } }'))
        .toBe('.a {\n  :not(&) {\n    color: red;\n  }\n}\n');
      expect(await nested('.block { &__el { color: red; } }'))
        .toBe('.block {\n  &__el {\n    color: red;\n  }\n}\n');
      // The `&(X)` spelling normalizes to the fused form it is sugar for.
      expect(await nested('.button { &(-1) { color: red; } }'))
        .toBe('.button {\n  &-1 {\n    color: red;\n  }\n}\n');
      // A `${…}` template still evaluates; only the parent reference is deferred.
      expect(await nested('$t: primary; .a { &-${t} { color: red; } }'))
        .toBe('.a {\n  &-primary {\n    color: red;\n  }\n}\n');
    });

    it('hoists `&` per collapsed boundary rather than per document', async () => {
      // Two nesting levels with only the inner boundary collapsible: the outer
      // `&` stays authored while the inner one resolves against its own parent.
      expect(await nested('.a { .b { &:hover { color: red; } } }'))
        .toBe('.a {\n  .b {\n    &:hover {\n      color: red;\n    }\n  }\n}\n');
      expect(await flat('.a { .b { &:hover { color: red; } } }'))
        .toBe('.a .b:hover {\n  color: red;\n}\n');
      expect(await flat('.a { &-x { &-y { color: red; } } }'))
        .toBe('.a-x-y {\n  color: red;\n}\n');
    });

    it('accepts `&` and its append spelling as $extend and $apply targets', async () => {
      // The direct route matches the CST route, which has always admitted `&`
      // here. Resolving a parent reference in a lookup target is an EVAL gap
      // both routes share: like Less's `:extend(&)`, the target matches nothing
      // today. These pin that the forms render without error, not that gap.
      expect(await flat('.a { color: red; } .b { .c { $extend &; } }'))
        .toBe('.a {\n  color: red;\n}\n');
      expect(await flat('.a-1 { color: red; } .a { .b { $apply &(-1); } }'))
        .toBe('.a-1 {\n  color: red;\n}\n');
    });
  });

  it('loads a `.jess` entry file through Context plugin resolution', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-jess-'));
    const entry = path.join(directory, 'entry.jess');
    fs.writeFileSync(entry, '.entry { color: red; }');

    await expect(new Compiler().render(entry)).resolves.toContain('color: red');
  });

  it('reports unresolved Jess interpolation through the public structured diagnostic route', async () => {
    const filePath = '/proj/missing-path.jess';
    const source = '@import url(${path}); $path: "images/icon.svg";';
    const result = await new Compiler().renderToResult(
      { source, filePath, extension: '.jess' },
      { suppressWarnings: true },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'resolve/name-not-found',
      phase: 'resolve',
      filePath,
      line: 1,
      column: 13,
    });
    expect(result.errors[0]?.lines?.[1]).toContain('${path}');
  });
});
