/**
 * Less 5 modules, source → CSS through the public compiler: `@use` script/data
 * modules and `@compose` stylesheet modules, including member access through the
 * module namespace (ledger A8) and `with`/`set` configuration (spec R6 Part E).
 *
 * A configured module's members are its outer-scope bindings AFTER configuration
 * (R6 §E.1), so a namespace read sees exactly what the module's own CSS sees.
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

  it('rejects a conflicting shared configuration', async () => {
    const { errors } = await render('@compose "./theme.less" set { @primary: red; }\n@compose "./theme.less" as t2 set { @primary: green; }');
    expect(errors).toEqual(['Module "./theme.less" is already configured with a different set of values; a module can only be configured once.']);
  });

  it('has no member functions: a value-position call on a compose namespace is an error', async () => {
    expect((await render('@compose "./theme.less";\n.a { v: @theme.scale(4); }')).errors)
      .toEqual(['Symbol "scale" is undefined in this scope.']);
  });

  it('reports an unknown member', async () => {
    expect((await render('@compose "./theme.less";\n.a { v: @theme.nope; }')).errors)
      .toEqual(['Symbol "nope" is undefined in this scope.']);
  });
});
