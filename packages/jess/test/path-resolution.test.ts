import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

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
});
