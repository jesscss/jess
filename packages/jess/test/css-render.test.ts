import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../src/index.js';

describe('CSS parser plugin render-through', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('routes `.css` source through Context into the direct AST-v2 serializer', async () => {
    const compiler = new Compiler();
    const context = compiler.createContext('entry.css');
    const parsed = await context.parseString('.entry { color: red; }', {
      filePath: 'entry.css',
      extension: '.css'
    });

    expect(parsed.node.type).toBe('Stylesheet');
    expect(context.document).toBe(parsed.node);
    await expect(compiler.renderString('.entry { color: red; }', {
      filePath: 'entry.css',
      extension: '.css'
    })).resolves.toBe('.entry {\n  color: red;\n}\n');
  });

  it('routes explicit CSS language selection through a safeParse-only plugin', async () => {
    await expect(new Compiler().renderString('.entry { color: red; }', {
      filePath: 'entry.css',
      language: 'css'
    })).resolves.toBe('.entry {\n  color: red;\n}\n');
  });

  it('loads a `.css` entry file through Context plugin resolution', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-css-'));
    temporaryDirectories.push(directory);
    const entry = path.join(directory, 'entry.css');
    fs.writeFileSync(entry, '.entry { color: red; }');

    await expect(new Compiler().render(entry)).resolves.toBe('.entry {\n  color: red;\n}\n');
  });
});
