import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import lessPlugin from '@jesscss/plugin-less';

describe('Less path resolution', () => {
  let tempDir: string;
  let includeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-path-resolution-'));
    includeDir = path.join(tempDir, 'include');
    projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(includeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves imports relative to the importing file before Less include paths', async () => {
    fs.writeFileSync(path.join(includeDir, 'tokens.less'), '@tone: blue;');
    fs.writeFileSync(path.join(projectDir, 'tokens.less'), '@tone: red;');
    const entryFile = path.join(projectDir, 'entry.less');
    fs.writeFileSync(entryFile, '@import "tokens";\n.entry { color: @tone; }');

    const css = await new Compiler().render(entryFile, {
      language: {
        less: {
          paths: [includeDir]
        }
      }
    });

    expect(css).toContain('color: red');
    expect(css).not.toContain('color: blue');
  });

  it('falls back to Less include paths when the current directory has no match', async () => {
    fs.writeFileSync(path.join(includeDir, 'tokens.less'), '@tone: blue;');
    const entryFile = path.join(projectDir, 'entry.less');
    fs.writeFileSync(entryFile, '@import "tokens";\n.entry { color: @tone; }');

    const css = await new Compiler().render(entryFile, {
      language: {
        less: {
          paths: [includeDir]
        }
      }
    });

    expect(css).toContain('color: blue');
  });

  it('registers Node package resolution through the normal Context resolver pipeline', async () => {
    const context = new Compiler().createContext();

    await expect(context.resolveImportPath('lodash-es')).resolves.toMatchObject({
      resolvedPath: expect.stringContaining('lodash-es')
    });
  });

  it('uses renderString filePath as the import base directory', async () => {
    fs.writeFileSync(path.join(includeDir, 'tokens.less'), '@tone: blue;');
    const virtualFile = path.join(projectDir, 'virtual.less');

    const css = await new Compiler().renderString('@import "tokens";\n.entry { color: @tone; }', {
      filePath: virtualFile,
      language: 'less',
      extension: '.less',
      config: {
        language: {
          less: {
            paths: [includeDir]
          }
        }
      }
    });

    expect(css).toContain('color: blue');
  });

  it('restores each imported AST document as the base for its nested imports', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import "a";\n.entry { color: @tone; border-color: @accent; }');
    fs.writeFileSync(path.join(tempDir, 'a.less'), '@import "nested/b";\n@accent: blue;');
    fs.writeFileSync(path.join(nestedDir, 'b.less'), '@tone: red;');

    const css = await new Compiler().render(path.join(tempDir, 'entry.less'));

    expect(css).toContain('color: red;');
    expect(css).toContain('border-color: blue;');
  });

  it('uses the imported document directory for a nested inline import', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import "nested/a.less";');
    fs.writeFileSync(path.join(nestedDir, 'a.less'), '@import (inline) "payload.css";');
    fs.writeFileSync(path.join(nestedDir, 'payload.css'), '.from-adjacent-file { color: green; }');

    const css = await new Compiler({ output: { collapseNesting: true } }).render(path.join(tempDir, 'entry.less'));

    expect(css).toContain('.from-adjacent-file { color: green; }');
  });

  it('keeps that nested inline-import base while extend planning preloads imports', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import "nested/a.less";\n.extension:extend(.target) {}');
    fs.writeFileSync(path.join(nestedDir, 'a.less'), '@import (inline) "payload.css";\n.target { color: blue; }');
    fs.writeFileSync(path.join(nestedDir, 'payload.css'), '.from-adjacent-file { color: green; }');

    const css = await new Compiler({ output: { collapseNesting: true } }).render(path.join(tempDir, 'entry.less'));

    expect(css).toContain('.from-adjacent-file { color: green; }');
  });

  it('uses the second imported document as the base for its nested inline import', async () => {
    const firstDir = path.join(tempDir, 'first');
    const secondDir = path.join(firstDir, 'second');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import "first/a.less";\n.extension:extend(.target) {}');
    fs.writeFileSync(path.join(firstDir, 'a.less'), '@import "second/b.less";');
    fs.writeFileSync(path.join(secondDir, 'b.less'), '@import (inline) "payload.css";\n.target { color: blue; }');
    fs.writeFileSync(path.join(secondDir, 'payload.css'), '.from-second-document { color: green; }');

    const css = await new Compiler({ output: { collapseNesting: true } }).render(path.join(tempDir, 'entry.less'));

    expect(css).toContain('.from-second-document { color: green; }');
  });

  it('keeps a second document base through reference-url imports and inline multiple', async () => {
    const firstDir = path.join(tempDir, 'first');
    const secondDir = path.join(firstDir, 'second');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import (reference) url("first/a.less");\n.extension:extend(.target) {}');
    fs.writeFileSync(path.join(firstDir, 'a.less'), '@import (reference) url("second/b.less");');
    fs.writeFileSync(path.join(secondDir, 'b.less'), '@import (inline, multiple) "payload.css";\n.target { color: blue; }');
    fs.writeFileSync(path.join(secondDir, 'payload.css'), '.from-reference-url { color: green; }');

    const css = await new Compiler({ output: { collapseNesting: true } }).render(path.join(tempDir, 'entry.less'));

    /*
     * The reference-url chain resolves through both nested bases: `.extension`
     * extends `.target` (from second/b.less), so it inherits `color: blue`. A
     * (reference) import suppresses its whole subtree from output, the nested
     * (inline) payload included — matches lessc 4.x (verified 4.6.3).
     */
    expect(css).toContain('.extension');
    expect(css).toContain('color: blue');
    expect(css).not.toContain('.from-reference-url');
  });

  it('preserves that base when legacy compatibility hooks are also configured', async () => {
    const firstDir = path.join(tempDir, 'first');
    const secondDir = path.join(firstDir, 'second');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import (reference) url("first/a.less");\n.extension:extend(.target) {}');
    fs.writeFileSync(path.join(firstDir, 'a.less'), '@import (reference) url("second/b.less");');
    fs.writeFileSync(path.join(secondDir, 'b.less'), '@import (inline, multiple) "payload.css";\n.target { color: blue; }');
    fs.writeFileSync(path.join(secondDir, 'payload.css'), '.from-compat-context { color: green; }');

    const css = await new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
    }).render(path.join(tempDir, 'entry.less'));

    /*
     * Same reference-url chain resolution as above, with the legacy compat
     * plugin also loaded — the extend still resolves and the (inline) payload
     * stays suppressed under the ancestor (reference).
     */
    expect(css).toContain('.extension');
    expect(css).toContain('color: blue');
    expect(css).not.toContain('.from-compat-context');
  });

  it('restores an imported mixin document scope for its deferred inline import without leaking it', async () => {
    const importedDir = path.join(tempDir, 'imported');
    fs.mkdirSync(importedDir);
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import "imported/mixins.less";\n.run();\n@import (inline) "root.css";');
    fs.writeFileSync(path.join(importedDir, 'mixins.less'), '.run() { @import (inline) "payload.css"; }');
    fs.writeFileSync(path.join(importedDir, 'payload.css'), '.from-imported-mixin { color: green; }');
    fs.writeFileSync(path.join(tempDir, 'root.css'), '.from-root { color: blue; }');

    const css = await new Compiler({ output: { collapseNesting: true } }).render(path.join(tempDir, 'entry.less'));

    expect(css).toContain('.from-imported-mixin { color: green; }');
    expect(css).toContain('.from-root { color: blue; }');
  });

  it('restores an imported ruleset-mixin document scope for its deferred inline import without leaking it', async () => {
    const importedDir = path.join(tempDir, 'imported');
    fs.mkdirSync(importedDir);
    fs.writeFileSync(path.join(tempDir, 'entry.less'), '@import "imported/ruleset.less";\n.run();\n@import (inline) "root.css";');
    fs.writeFileSync(path.join(importedDir, 'ruleset.less'), '.run { @import (inline) "payload.css"; }');
    fs.writeFileSync(path.join(importedDir, 'payload.css'), '.from-imported-ruleset { color: green; }');
    fs.writeFileSync(path.join(tempDir, 'root.css'), '.from-root { color: blue; }');

    const css = await new Compiler({ output: { collapseNesting: true } }).render(path.join(tempDir, 'entry.less'));

    expect(css).toContain('.from-imported-ruleset { color: green; }');
    expect(css).toContain('.from-root { color: blue; }');
  });

  it('hands async Context-resolved asset reads to AST IO functions', async () => {
    const assetDir = path.join(includeDir, 'assets');
    fs.mkdirSync(assetDir);
    fs.writeFileSync(path.join(assetDir, 'note.txt'), 'hello world');
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(17, 16);
    png.writeUInt32BE(9, 20);
    fs.writeFileSync(path.join(assetDir, 'icon.png'), png);
    const entryFile = path.join(projectDir, 'entry.less');
    fs.writeFileSync(entryFile, '.asset { uri: data-uri("assets/note.txt"); size: image-size("assets/icon.png"); width: image-width("assets/icon.png"); height: image-height("assets/icon.png"); }');

    let asyncResolverCalls = 0;
    const resolvedAssets = new Set<string>();
    const css = await new Compiler({
      compile: {
        plugins: [{
          name: 'async-resolution-observer',
          resolve: async (candidates: string | string[]) => {
            asyncResolverCalls++;
            await Promise.resolve();
            const paths = Array.isArray(candidates) ? candidates : [candidates];
            for (const candidate of paths) {
              if (candidate.endsWith(`${path.sep}assets${path.sep}note.txt`)) {
                resolvedAssets.add('note.txt');
              }
              if (candidate.endsWith(`${path.sep}assets${path.sep}icon.png`)) {
                resolvedAssets.add('icon.png');
              }
            }
            return paths;
          }
        }]
      },
      language: { less: { paths: [includeDir] } }
    }).render(entryFile);

    expect(asyncResolverCalls).toBeGreaterThan(0);
    // These are only requested by the AST IO built-ins through Context.readBinary;
    // root parsing never resolves either asset path.
    expect(resolvedAssets).toEqual(new Set(['note.txt', 'icon.png']));
    expect(css).toContain('url("data:text/plain,hello%20world")');
    expect(css).toContain('17px 9px');
    expect(css).toContain('width: 17px');
    expect(css).toContain('height: 9px');
  });
});
