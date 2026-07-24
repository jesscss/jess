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
      '$items: red, blue; $for ($item, $key, $counter of $items) { .item-$[key]-$[counter] { color: $item; } } $for ($i of 1 to <3) { .range-$[i] { order: $i; } }',
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

  it('loads a `.jess` entry file through Context plugin resolution', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-jess-'));
    const entry = path.join(directory, 'entry.jess');
    fs.writeFileSync(entry, '.entry { color: red; }');

    await expect(new Compiler().render(entry)).resolves.toContain('color: red');
  });

  it('reports unresolved Jess interpolation through the public structured diagnostic route', async () => {
    const filePath = '/proj/missing-path.jess';
    const source = '@import url($[path]); $path: "images/icon.svg";';
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
    expect(result.errors[0]?.lines?.[1]).toContain('$[path]');
  });
});
