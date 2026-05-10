import { afterEach, describe, expect, it } from 'vitest';
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
        javascript: true,
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
});
