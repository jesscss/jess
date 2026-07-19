import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Context } from '@jesscss/core';
import { NodeModulesPlugin } from '../src/index.js';

describe('NodeModulesPlugin Context resolver protocol', () => {
  it('resolves a bare JSON package import through Context without a core fallback', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jess-node-modules-context-'));
    const packageDir = path.join(root, 'node_modules', 'bare-context-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(path.join(packageDir, 'tokens.json'), '{"color":"red"}', 'utf8');

    const context = new Context({}, [new NodeModulesPlugin({ basePath: root })]);

    await expect(context.getModule('bare-context-package/tokens.json')).resolves.toMatchObject({
      resolvedPath: realpathSync(path.join(packageDir, 'tokens.json')),
      module: { color: 'red' }
    });
  });

  it('owns Less-extension probing for extensionless bare specifiers', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jess-node-modules-less-'));
    const packageDir = path.join(root, 'node_modules', 'bare-less-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(path.join(packageDir, 'theme.less'), '.theme { color: red; }', 'utf8');

    const plugin = new NodeModulesPlugin({ basePath: root });

    expect(plugin.resolve('bare-less-package/theme', root, [])).toEqual([
      realpathSync(path.join(packageDir, 'theme.less'))
    ]);
  });
});
