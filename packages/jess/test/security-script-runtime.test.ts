import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const tempDirs: string[] = [];

const makeTmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-security-'));
  tempDirs.push(dir);
  return dir;
};

describe('Jess restricted script runtime integration', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects Less inline backtick JavaScript at parse time', async () => {
    const root = makeTmpDir();
    const styleFile = path.join(root, 'main.less');
    fs.writeFileSync(styleFile, '.a { js: `1 + 1`; }', 'utf8');
    const compiler = new Compiler({
      compile: {
        plugins: [lessPlugin()]
      },
      language: {
        less: {
          javascriptEnabled: true
        }
      }
    });
    const context = compiler.createContext(styleFile);
    await expect(context.getTree(styleFile)).rejects.toThrow();
  });

  it('@plugin-registered function runs and accesses process when in Node (pluginRegistry path)', async () => {
    // Uses pluginRegistry to bypass file-based @plugin loading (which requires plugin-js/Deno).
    // In Node (Vitest), the function runs in-process and can access process.env → LEAKED.
    // When @plugin file loading runs in Deno (via plugin-js), it would return DENIED.
    const evilPlugin = {
      install(_less: unknown, _manager: unknown, functions: { add: (name: string, fn: () => string) => void }) {
        functions.add('evil', function() {
          try {
            const p =
              typeof process !== 'undefined' && process.env ? process.env.HOME : null;
            return p ?? 'LEAKED';
          } catch {
            return 'DENIED';
          }
        });
      }
    };

    const root = makeTmpDir();
    const lessPath = path.join(root, 'main.less');
    fs.writeFileSync(
      lessPath,
      ['@plugin "evil-plugin";', '.x { value: evil(); }'].join('\n'),
      'utf8'
    );
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- Less @plugin path must match registry key
            pluginRegistry: { 'evil-plugin': evilPlugin }
          })
        ]
      }
    });
    const { css } = await compiler.renderToResult(lessPath);
    // In Node (Vitest): process.env.HOME is available → LEAKED or actual path
    // In Deno: process undefined → DENIED
    expect(css).toMatch(/value: (LEAKED|DENIED|\/[^\s]+)/);
    expect(css).not.toContain('value: evil();');
  });

  it('loads file-based Less @plugin scripts through Deno when plugin-js is lazy-loaded', async () => {
    const root = makeTmpDir();
    const pluginPath = path.join(root, 'evil-plugin.js');
    const lessPath = path.join(root, 'main.less');
    fs.writeFileSync(
      pluginPath,
      [
        'registerPlugin({',
        '  install: function(_less, _manager, functions) {',
        '    functions.add("probe", function() {',
        '      return typeof process === "undefined" ? "DENIED" : "LEAKED";',
        '    });',
        '    functions.add("sixpx", function() {',
        '      return new tree.Dimension(6, "px");',
        '    });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      lessPath,
      [
        '@plugin "./evil-plugin.js";',
        '.x {',
        '  value: probe();',
        '  width: sixpx();',
        '}'
      ].join('\n'),
      'utf8'
    );

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          '@jesscss/plugin-js',
          lessPlugin(),
          lessCompatPlugin()
        ]
      }
    });

    const { css, warnings, errors } = await compiler.renderToResult(lessPath, {
      suppressWarnings: true
    });
    expect(errors).toEqual([]);
    expect(css).toContain('value: DENIED;');
    expect(css).toContain('width: 6px;');
    expect(warnings.some(warning => warning.code === 'eval/deprecated')).toBe(true);
  });

  it('blocks file-based Less @plugin scripts outside the script sandbox root', async () => {
    const entryRoot = makeTmpDir();
    const outsideRoot = makeTmpDir();
    const pluginPath = path.join(outsideRoot, 'escape-plugin.js');
    const lessPath = path.join(entryRoot, 'main.less');
    fs.writeFileSync(
      pluginPath,
      [
        'registerPlugin({',
        '  install: function(_less, _manager, functions) {',
        '    functions.add("escape", function() { return "SHOULD_NOT_RUN"; });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      lessPath,
      [`@plugin "${pluginPath}";`, '.x { value: escape(); }'].join('\n'),
      'utf8'
    );

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          '@jesscss/plugin-js',
          lessPlugin(),
          lessCompatPlugin()
        ]
      }
    });

    const { css, errors } = await compiler.renderToResult(lessPath, {
      suppressWarnings: true
    });
    expect(css).toBe('');
    expect(errors.some(error =>
      error.message.includes('outside jsReadRoot')
      && error.message.includes(pluginPath)
    )).toBe(true);
  });

  it('does not keep Node alive after file-based Less @plugin execution', () => {
    const script = [
      'import fs from "node:fs";',
      'import os from "node:os";',
      'import path from "node:path";',
      'import { Compiler } from "./packages/jess/lib/index.js";',
      'import lessPlugin from "./packages/jess-plugin-less/lib/index.js";',
      'import { lessCompatPlugin } from "./packages/jess-plugin-less-compat/lib/index.js";',
      'const root = fs.mkdtempSync(path.join(os.tmpdir(), "jess-less-plugin-exit-"));',
      'const pluginPath = path.join(root, "plugin.js");',
      'const lessPath = path.join(root, "main.less");',
      'fs.writeFileSync(pluginPath, [',
      '  "registerPlugin({",',
      '  "  install: function(_less, _manager, functions) {",',
      '  "    functions.add(\\"probe\\", function() { return \\"ok\\"; });",',
      '  "  }",',
      '  "});"',
      '].join("\\n"), "utf8");',
      'fs.writeFileSync(lessPath, "@plugin \\"./plugin.js\\"; .x { value: probe(); }", "utf8");',
      'const compiler = new Compiler({',
      '  output: { collapseNesting: true },',
      '  compile: { plugins: ["@jesscss/plugin-js", lessPlugin(), lessCompatPlugin()] }',
      '});',
      'const result = await compiler.renderToResult(lessPath, { suppressWarnings: true });',
      'if (!result.css.includes("value: ok")) throw new Error(result.css);',
      'fs.rmSync(root, { recursive: true, force: true });',
      'console.log("rendered");'
    ].join('\n');

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.resolve(process.cwd(), '../..'),
      encoding: 'utf8',
      timeout: 3000
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('rendered');
  });

  it('blocks Less @plugin when disableScriptModules is set even with plugin-js configured', async () => {
    const root = makeTmpDir();
    const pluginPath = path.join(root, 'blocked-plugin.js');
    const lessPath = path.join(root, 'main.less');
    fs.writeFileSync(
      pluginPath,
      [
        'registerPlugin({',
        '  install: function(_less, _manager, functions) {',
        '    functions.add("blocked", function() { return "SHOULD_NOT_RUN"; });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      lessPath,
      ['@plugin "./blocked-plugin.js";', '.x { value: blocked(); }'].join('\n'),
      'utf8'
    );

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        disableScriptModules: true,
        plugins: [
          '@jesscss/plugin-js',
          lessPlugin(),
          lessCompatPlugin()
        ]
      }
    });

    const { css, errors } = await compiler.renderToResult(lessPath, {
      suppressWarnings: true
    });
    expect(css).toBe('');
    expect(errors.some(error => error.message === 'Less @plugin is disabled by disableScriptModules.')).toBe(true);
  });

  it('treats disablePluginRule as a deprecated alias for disableScriptModules for Less @plugin', async () => {
    const root = makeTmpDir();
    const pluginPath = path.join(root, 'blocked-plugin.js');
    const lessPath = path.join(root, 'main.less');
    fs.writeFileSync(
      pluginPath,
      [
        'registerPlugin({',
        '  install: function(_less, _manager, functions) {',
        '    functions.add("blocked", function() { return "SHOULD_NOT_RUN"; });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      lessPath,
      ['@plugin "./blocked-plugin.js";', '.x { value: blocked(); }'].join('\n'),
      'utf8'
    );

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        disablePluginRule: true,
        plugins: [
          '@jesscss/plugin-js',
          lessPlugin(),
          lessCompatPlugin()
        ]
      }
    });

    const { css, errors } = await compiler.renderToResult(lessPath, {
      suppressWarnings: true
    });
    expect(css).toBe('');
    expect(errors.some(error => error.message === 'Less @plugin is disabled by disableScriptModules.')).toBe(true);
  });
});
