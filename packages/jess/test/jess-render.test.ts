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
      'paint() { color: red; } .entry { $if (true) { $apply paint; } }',
      { filePath: 'entry.jess', extension: '.jess' },
    );

    expect(css).toBe('.entry {\n  color: red;\n}\n');
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
