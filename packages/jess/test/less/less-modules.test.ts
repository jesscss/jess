/**
 * Less 5 modules, source → CSS through the public compiler: `@use` script/data
 * modules and `@compose` stylesheet modules, including member access through the
 * module namespace (ledger A8) and `with`/`set` configuration (spec R6 Part E).
 *
 * A configured module's members are its outer-scope bindings AFTER configuration
 * (R6 §E.1), so a namespace read sees exactly what the module's own CSS sees.
 * A shared module (plain or `set`) evaluates once per compilation; every compose
 * edge still binds its own namespace to that one evaluation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';

const THEME = [
  '@primary: blue;',
  '@accent: darken(@primary, 10%);',
  '@spacing: {',
  '  compact: 4px;',
  '  normal: 8px;',
  '}',
  '.theme-base {',
  '  color: @primary;',
  '  border-color: @accent;',
  '}'
].join('\n');

const tempDirs: string[] = [];

type SourceFile = readonly [name: string, source: string];

function project(files: readonly SourceFile[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-less-modules-'));
  tempDirs.push(directory);
  for (const [name, source] of files) {
    fs.writeFileSync(path.join(directory, name), source, 'utf8');
  }
  return directory;
}

async function render(entry: string, files: readonly SourceFile[] = []): Promise<{ css: string; errors: string[] }> {
  const directory = project([['theme.less', THEME], ...files, ['entry.less', entry]]);
  const compiler = new Compiler();
  try {
    const result = await compiler.renderToResult(path.join(directory, 'entry.less'));
    const errors = ((result as { errors?: { reason?: string }[] }).errors ?? []).map(error => error.reason ?? '');
    return { css: result.css, errors };
  } finally {
    compiler.dispose();
  }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Less @use script and data modules', () => {
  const functions: SourceFile[] = [['fns.js', 'export const double = (value) => value * 2;\nexport const label = "hello";\n']];

  it('calls an exported function through the file-derived namespace', async () => {
    expect((await render('@use "./fns.js";\n.a { v: @fns.double(3); }', functions)).css)
      .toBe('.a {\n  v: 6;\n}\n');
  });

  it('accepts the dashed @-use spelling', async () => {
    expect((await render('@-use "./fns.js";\n.a { v: @fns.double(3); }', functions)).css)
      .toBe('.a {\n  v: 6;\n}\n');
  });

  it('reads an exported value with a dot or a bracket key', async () => {
    expect((await render('@use "./fns.js";\n.a { b: @fns.label; c: @fns[label]; }', functions)).css)
      .toBe('.a {\n  b: hello;\n  c: hello;\n}\n');
  });

  it('reads JSON data members, nested members included', async () => {
    const files: SourceFile[] = [['tokens.json', '{ "color": "rebeccapurple", "scale": { "compact": 4 } }']];
    expect((await render('@use "./tokens.json";\n.a { c: @tokens[color]; d: @tokens.color; g: @tokens.scale.compact; }', files)).css)
      .toBe('.a {\n  c: rebeccapurple;\n  d: rebeccapurple;\n  g: 4;\n}\n');
  });

  it('reports a missing export', async () => {
    const { errors } = await render('@use "./fns.js";\n.a { v: @fns.nope(1); }', functions);
    expect(errors).toEqual(['Symbol "nope" is undefined in this scope.']);
  });
});

describe('Less @compose stylesheet modules', () => {
  it('reads members through the derived namespace: dot, bracket, chained, derived', async () => {
    const { css } = await render([
      '@compose "./theme.less";',
      '.a { c: @theme.primary; d: @theme[@primary]; p: @theme.spacing.normal; q: @theme[@spacing][compact]; e: @theme.accent; }'
    ].join('\n'));
    expect(css).toBe([
      '.theme-base {\n  color: blue;\n  border-color: #0000cc;\n}',
      '.a {\n  c: blue;\n  d: blue;\n  p: 8px;\n  q: 4px;\n  e: #0000cc;\n}\n'
    ].join('\n'));
  });

  it('isolates the module from the importer scope', async () => {
    const { errors } = await render('@primary: green;\n@compose "./iso.less";\n', [['iso.less', '.iso { c: @primary; }\n']]);
    expect(errors).toEqual(['Symbol "@primary" is undefined in this scope.']);
  });

  it('a per-edge `with` configures the module output AND its namespace members', async () => {
    const { css } = await render('@compose "./theme.less" with { @primary: red; }\n.a { c: @theme.primary; d: @theme[@primary]; e: @theme.accent; }');
    expect(css).toBe([
      '.theme-base {\n  color: red;\n  border-color: #cc0000;\n}',
      '.a {\n  c: red;\n  d: red;\n  e: #cc0000;\n}\n'
    ].join('\n'));
  });

  it('evaluates a configuration value in the importer scope', async () => {
    const { css } = await render('@brand: green;\n@compose "./theme.less" with { @primary: @brand; }\n.a { c: @theme.primary; }');
    expect(css).toBe('.theme-base {\n  color: green;\n  border-color: #004d00;\n}\n.a {\n  c: green;\n}\n');
  });

  it('`as *` exposes the configured members unqualified', async () => {
    const { css } = await render('@compose "./theme.less" as * with { @primary: red; }\n.a { c: @primary; e: @accent; }');
    expect(css).toBe('.theme-base {\n  color: red;\n  border-color: #cc0000;\n}\n.a {\n  c: red;\n  e: #cc0000;\n}\n');
  });

  it('emits a shared module once and each per-edge `with` once per edge', async () => {
    expect((await render('@compose "./theme.less";\n@compose "./theme.less" as again;')).css)
      .toBe('.theme-base {\n  color: blue;\n  border-color: #0000cc;\n}\n');
    expect((await render('@compose "./theme.less" with { @primary: red; }\n@compose "./theme.less" as t2 with { @primary: green; }')).css)
      .toBe('.theme-base {\n  color: red;\n  border-color: #cc0000;\n}\n.theme-base {\n  color: green;\n  border-color: #004d00;\n}\n');
  });

  it('a later compose of a shared module binds its own namespace to the one evaluation', async () => {
    const { css } = await render('@compose "./theme.less" set { @primary: red; }\n@compose "./theme.less" as again;\n.a { c: @again.primary; e: @again.accent; }');
    expect(css).toBe('.theme-base {\n  color: red;\n  border-color: #cc0000;\n}\n.a {\n  c: red;\n  e: #cc0000;\n}\n');
  });

  it('a module composed by a dependency is still reachable from the entry namespace', async () => {
    const button: SourceFile = ['button.less', '@compose "./theme.less";\n.btn { color: @theme.primary; }\n'];
    const { css, errors } = await render('@compose "./button.less";\n@compose "./theme.less";\n.x { c: @theme.primary; }', [button]);
    expect(errors).toEqual([]);
    expect(css).toBe('.theme-base {\n  color: blue;\n  border-color: #0000cc;\n}\n.btn {\n  color: blue;\n}\n.x {\n  c: blue;\n}\n');
  });

  it('rejects a conflicting shared configuration', async () => {
    const { errors } = await render('@compose "./theme.less" set { @primary: red; }\n@compose "./theme.less" as t2 set { @primary: green; }');
    expect(errors).toEqual(['Module "./theme.less" is already configured with a different set of values; a module can only be configured once.']);
  });

  it('has no member functions: a value-position call on any compose member is an error', async () => {
    const memberCall = (name: string) => `"${name}" cannot be called as a value: a @compose stylesheet module has no member functions `
      + '(its `.name()` is a mixin call, a statement); functions come from @use script modules.';
    const scale: SourceFile = ['scale.less', '@scale: 2;\n@box: { width: 1px; }\n.grow(@n) { width: @n; }\n'];
    for (const member of ['scale', 'box', 'grow']) {
      const { css, errors } = await render(`@compose "./scale.less";\n.a { v: @scale.${member}(4); }`, [scale]);
      expect(errors).toEqual([memberCall(member)]);
      expect(css).toBe('');
    }
  });

  /*
   * Ledger A8: `.name(args)` on a @compose namespace is a MIXIN call in statement
   * position, dispatched in the module's own activation.
   */
  it('calls a mixin through the compose namespace in statement position', async () => {
    const elevate: SourceFile = ['elevate.less', '@depth: black;\n.lift(@d) { box-shadow: 0 @d 0 @depth; }\n'];
    const { css, errors } = await render('@compose "./elevate.less";\n.a { @elevate.lift(3px); }', [elevate]);
    expect(errors).toEqual([]);
    expect(css).toBe('.a {\n  box-shadow: 0 3px 0 black;\n}\n');
  });

  it('reports a failed member mixin call at its call site', async () => {
    const elevate: SourceFile = ['elevate.less', '.lift(@d) { box-shadow: 0 @d 0 black; }\n'];
    const directory = project([elevate, ['entry.less', '@compose "./elevate.less";\n.a {\n  @elevate.lift(1px, 2px, 3px);\n}\n']]);
    const compiler = new Compiler();
    try {
      const result = await compiler.renderToResult(path.join(directory, 'entry.less'));
      const errors = (result as { errors?: { reason?: string; line?: number; column?: number }[] }).errors ?? [];
      expect(errors.map(error => [error.reason, error.line, error.column]))
        .toEqual([['Symbol ".lift()" is undefined in this scope.', 3, 3]]);
    } finally {
      compiler.dispose();
    }
  });

  it('keeps a spaced `@name .member(…);` an at-rule, and an unknown member an error', async () => {
    const elevate: SourceFile = ['elevate.less', '.lift(@d) { box-shadow: 0 @d 0 black; }\n'];
    expect((await render('@compose "./elevate.less";\n.a { @elevate.sink(3px); }', [elevate])).errors)
      .toEqual(['Symbol "sink" is undefined in this scope.']);
    expect((await render('.a { @elevate .lift(3px); }')).css)
      .toBe('.a {\n  @elevate .lift(3px);\n}\n');
  });

  it('a namespace member is the module binding its own CSS sees, nested @import included', async () => {
    const files: SourceFile[] = [
      ['m.less', '@x: 1;\n@y: @x;\n@import "./lib.less";\n.m { x: @x; y: @y; }\n'],
      ['lib.less', '@x: 2;\n']
    ];
    expect((await render('@compose "./m.less";\n.a { x: @m.x; y: @m.y; }', files)).css)
      .toBe('.m {\n  x: 2;\n  y: 2;\n}\n.a {\n  x: 2;\n  y: 2;\n}\n');
  });

  it('rejects a `set` on a module that was already loaded without one', async () => {
    const { errors } = await render('@compose "./theme.less";\n@compose "./theme.less" as t2 set { @primary: red; }\n.a { c: @t2.primary; }');
    expect(errors).toEqual(['Module "./theme.less" was already loaded without configuration; only the first import of a module can configure it with "set".']);
  });

  it('rejects composing a module that @import already folded into the stylesheet', async () => {
    const { errors } = await render('@import "./theme.less";\n@compose "./theme.less";\n.a { c: @theme.primary; }');
    expect(errors).toEqual(['Module "./theme.less" was already loaded by @import, which folds it into the importing scope; it cannot also be composed as an isolated module.']);
  });

  it('a namespace read before its @compose is an unresolved name, not verbatim text', async () => {
    const { css, errors } = await render('.a { c: @theme.primary; }\n@compose "./theme.less" with { @primary: red; }');
    expect(errors).toEqual(['Symbol "@theme" is undefined in this scope.']);
    expect(css).not.toContain('@theme.primary');
  });

  it('reports an unknown member', async () => {
    expect((await render('@compose "./theme.less";\n.a { v: @theme.nope; }')).errors)
      .toEqual(['Symbol "nope" is undefined in this scope.']);
  });
});
