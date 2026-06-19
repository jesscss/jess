import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('safeParse-only parser plugins', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-safe-parse-only-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps safeParse-only parser plugins on the default file render path', async () => {
    const testFile = path.join(tempDir, 'safe-only.safe');
    fs.writeFileSync(testFile, '.safe { color: red; }');
    const delegate = lessPlugin();
    const safeOnlyPlugin = {
      name: 'safe-only',
      supportedExtensions: ['.safe'],
      safeParse: vi.fn(delegate.safeParse.bind(delegate))
    };
    const compiler = new Compiler({
      compile: {
        plugins: [safeOnlyPlugin]
      }
    });

    const css = await compiler.render(testFile);

    expect(css).toContain('.safe');
    expect(css).toContain('color: red');
    expect(safeOnlyPlugin.safeParse).toHaveBeenCalledTimes(1);
    expect('parse' in safeOnlyPlugin).toBe(false);
    expect('structuralActivation' in safeOnlyPlugin).toBe(false);
  });
});
