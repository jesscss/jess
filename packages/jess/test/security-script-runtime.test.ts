import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

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
});
