import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

const tempDirs: string[] = [];

function tempProject(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-modules-'));
  tempDirs.push(directory);
  return directory;
}

function write(directory: string, name: string, source: string): string {
  const file = path.join(directory, name);
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('public module imports', () => {
  it('binds Jess JSON data under an explicit namespace and consumes the directive', async () => {
    const directory = tempProject();
    write(directory, 'tokens.json', JSON.stringify({ color: 'rebeccapurple', scale: { compact: 4 } }));
    const entry = write(directory, 'entry.jess', [
      '@-use "./tokens.json" as tokens;',
      '.entry { color: $tokens.color; gap: $tokens.scale.compact; }'
    ].join('\n'));

    await expect(new Compiler().render(entry)).resolves.toBe(
      '.entry {\n  color: rebeccapurple;\n  gap: 4;\n}\n'
    );
  });

  it('executes Jess @-from and Less @use script functions through plugin-js', async () => {
    const directory = tempProject();
    write(directory, 'functions.js', 'export const inc = (value) => value + 1;');
    const jessEntry = write(directory, 'entry.jess', [
      '@-from "./functions.js" import (inc as next);',
      '.jess { value: next(2); }'
    ].join('\n'));
    const lessEntry = write(directory, 'entry.less', [
      '@use "./functions.js";',
      '.less { value: @functions.inc(4); }'
    ].join('\n'));

    const compiler = new Compiler();
    await expect(compiler.render(jessEntry)).resolves.toBe('.jess {\n  value: 3;\n}\n');
    await expect(compiler.render(lessEntry)).resolves.toBe('.less {\n  value: 5;\n}\n');
    compiler.dispose();
  });

  it('loads trusted Sass function modules without plugin-js', async () => {
    const compiler = new Compiler();
    compiler['createJsPluginProxy'] = () => undefined;

    await expect(compiler.renderString(
      '@use "sass:math"; .entry { value: math.abs(-2); }',
      { filePath: 'entry.scss', extension: '.scss' }
    )).resolves.toBe('.entry {\n  value: 2;\n}\n');
  });

  it('loads trusted Less functions without plugin-js', async () => {
    const compiler = new Compiler();
    compiler['createJsPluginProxy'] = () => undefined;

    await expect(compiler.renderString(
      '@-from "#less" import (mix); .entry { color: mix(#ff0000, #0000ff, 50%); }',
      { filePath: 'entry.jess', extension: '.jess' }
    )).resolves.toBe('.entry {\n  color: #800080;\n}\n');
  });

  it('binds a named-colour argument through the trusted Less functions', async () => {
    /*
     * `#less` loads the package's CommonJS build, so this is the one route that
     * exercises @jesscss/core's CJS named-colour table: `red` binds a `Color`
     * parameter only if that table resolves it (jess#271).
     */
    const compiler = new Compiler();
    compiler['createJsPluginProxy'] = () => undefined;

    await expect(compiler.renderString(
      '@-from "#less" import (mix, lighten); .entry { a: mix(red, blue, 50%); b: lighten(blue, 10%); }',
      { filePath: 'entry.jess', extension: '.jess' }
    )).resolves.toBe('.entry {\n  a: #800080;\n  b: #3333ff;\n}\n');
  });

  it('reports the optional script runtime when a local script module needs it', async () => {
    const directory = tempProject();
    write(directory, 'functions.js', 'export const identity = (value) => value;');
    const entry = write(directory, 'entry.jess', [
      '@-from "./functions.js" import (identity);',
      '.entry { value: identity(2); }'
    ].join('\n'));
    const compiler = new Compiler();
    compiler['createJsPluginProxy'] = () => undefined;

    await expect(compiler.render(entry)).rejects.toThrow(
      'Install @jesscss/plugin-js to enable script execution features'
    );
  });
});
